import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUserAdmin } from '@/lib/config'
import {
  fetchCalendarEvents,
  getEventSenderEmail,
  isEventCancelled,
  mapGoogleEventToMemberEvent,
} from '@/lib/google-calendar'
import { formatDateISO, addDays } from '@/lib/utils'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'

// POST /api/calendar/sync - Sync events from Google Calendar
export async function POST() {
  try {
    const supabase = await createClient()

    // Check if user is admin via JWT claims
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !isUserAdmin(user)) {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      )
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'calendarSync')
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.calendarSync)
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `For mange forespørsler. Prøv igjen om ${rateLimit.retryAfter} sekunder.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Get stored tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('google_calendar_tokens_decrypted')
      .select('*')
      .limit(1)
      .single()

    if (tokenError || !tokenData) {
      return NextResponse.json(
        { error: 'Google Calendar not connected. Please connect first.' },
        { status: 400 }
      )
    }

    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    }

    // Fetch events from Google Calendar (next 30 days)
    const today = new Date()
    const thirtyDaysFromNow = addDays(today, 30)

    const googleEvents = await fetchCalendarEvents(tokens, {
      timeMin: formatDateISO(today),
      timeMax: formatDateISO(thirtyDaysFromNow),
      maxResults: 100,
    })

    // Get all household members with their emails
    const { data: members, error: membersError } = await supabase
      .from('household_members')
      .select('id, household_id, email, work_email')

    if (membersError) {
      console.error('Error fetching members:', membersError)
      return NextResponse.json(
        { error: 'Failed to fetch household members' },
        { status: 500 }
      )
    }

    // Build email to member lookup
    const emailToMember = new Map<string, { id: string; household_id: string }>()
    members?.forEach((member) => {
      if (member.email) {
        emailToMember.set(member.email.toLowerCase(), {
          id: member.id,
          household_id: member.household_id,
        })
      }
      if (member.work_email) {
        emailToMember.set(member.work_email.toLowerCase(), {
          id: member.id,
          household_id: member.household_id,
        })
      }
    })

    // Get existing events synced from Google (to handle updates/deletes)
    const { data: existingEvents } = await supabase
      .from('member_events')
      .select('id, google_event_id')
      .eq('source', 'google_calendar')
      .not('google_event_id', 'is', null)

    const existingEventIds = new Set(existingEvents?.map((e) => e.google_event_id) || [])
    const googleEventIds = new Set<string>()

    // Process Google events
    const eventsToUpsert: Array<ReturnType<typeof mapGoogleEventToMemberEvent>> = []
    const unmatchedEvents: string[] = []

    for (const event of googleEvents) {
      if (!event.id) continue

      googleEventIds.add(event.id)

      // Skip cancelled events
      if (isEventCancelled(event)) {
        continue
      }

      // Get sender email and find matching member
      const senderEmail = getEventSenderEmail(event)
      if (!senderEmail) {
        unmatchedEvents.push(event.summary || 'Unknown event')
        continue
      }

      const member = emailToMember.get(senderEmail.toLowerCase())
      if (!member) {
        // Sender email doesn't match any member - ignore
        unmatchedEvents.push(`${event.summary || 'Unknown'} (from ${senderEmail})`)
        continue
      }

      // Map to our format
      const memberEvent = mapGoogleEventToMemberEvent(event, member.id, member.household_id)
      eventsToUpsert.push(memberEvent)
    }

    // Upsert matched events
    let upsertedCount = 0
    if (eventsToUpsert.length > 0) {
      // Upsert one by one to handle the unique constraint properly
      for (const event of eventsToUpsert) {
        const { error: upsertError } = await supabase
          .from('member_events')
          .upsert(event, {
            onConflict: 'household_id,member_id,date,google_event_id',
          })

        if (upsertError) {
          console.error('Error upserting event:', upsertError, event)
        } else {
          upsertedCount++
        }
      }
    }

    // Delete events that were removed or cancelled in Google Calendar
    const eventsToDelete = existingEvents?.filter(
      (e) => e.google_event_id && !googleEventIds.has(e.google_event_id)
    )

    let deletedCount = 0
    if (eventsToDelete && eventsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('member_events')
        .delete()
        .in(
          'id',
          eventsToDelete.map((e) => e.id)
        )

      if (deleteError) {
        console.error('Error deleting events:', deleteError)
      } else {
        deletedCount = eventsToDelete.length
      }
    }

    return NextResponse.json({
      success: true,
      synced: upsertedCount,
      deleted: deletedCount,
      unmatched: unmatchedEvents.length,
      unmatchedEvents: unmatchedEvents.slice(0, 10), // Show first 10
    })
  } catch (error) {
    console.error('Calendar sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync calendar' },
      { status: 500 }
    )
  }
}

// GET /api/calendar/sync - Get sync status
export async function GET() {
  try {
    const supabase = await createClient()

    // Check if user is admin via JWT claims
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !isUserAdmin(user)) {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      )
    }

    // Get stored tokens
    const { data: tokenData } = await supabase
      .from('google_calendar_tokens_decrypted')
      .select('email, created_at, updated_at')
      .limit(1)
      .single()

    // Get count of synced events
    const { count: syncedCount } = await supabase
      .from('member_events')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'google_calendar')

    return NextResponse.json({
      connected: !!tokenData,
      email: tokenData?.email || null,
      connectedAt: tokenData?.created_at || null,
      lastSync: tokenData?.updated_at || null,
      syncedEvents: syncedCount || 0,
    })
  } catch (error) {
    console.error('Calendar status error:', error)
    return NextResponse.json(
      { error: 'Failed to get calendar status' },
      { status: 500 }
    )
  }
}
