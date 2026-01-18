import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUserAdmin, validateOrigin } from '@/lib/config'
import {
  fetchCalendarInvitesFromGmail,
  mapGmailInviteToMemberEvent,
  ParsedCalendarInvite,
} from '@/lib/google-calendar'
import { formatDateISO, addDays } from '@/lib/utils'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { maskEmail } from '@/lib/email-mask'
import { ApiErrors, handleApiError } from '@/lib/api-errors'
import type { UnmatchedCalendarInvite } from '@/lib/types'

// POST /api/calendar/sync - Sync events from Gmail calendar invites
export async function POST(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()

    // Check if user is admin via JWT claims
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !isUserAdmin(user)) {
      return ApiErrors.adminRequired()
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'calendarSync')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.calendarSync)
    if (rateLimit.limited) {
      return ApiErrors.rateLimit(rateLimit.retryAfter!)
    }

    // Get stored tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('google_calendar_tokens_decrypted')
      .select('*')
      .limit(1)
      .single()

    if (tokenError || !tokenData) {
      return ApiErrors.validation('Google Kalender er ikke koblet til. Koble til først i Innstillinger.')
    }

    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    }

    // Fetch calendar invites from Gmail (last 30 days)
    const today = new Date()
    const thirtyDaysAgo = addDays(today, -30)

    const gmailInvites = await fetchCalendarInvitesFromGmail(tokens, {
      afterDate: formatDateISO(thirtyDaysAgo),
      maxResults: 100,
    })

    // Get all household members with their emails
    const { data: members, error: membersError } = await supabase
      .from('household_members')
      .select('id, household_id, email, work_email')

    if (membersError) {
      return ApiErrors.internal({
        internalMessage: `Error fetching members: ${membersError.message}`,
      })
    }

    // Build email to member lookup
    const emailToMember = new Map<string, { id: string; household_id: string }>()
    if (process.env.NODE_ENV === 'development') {
      console.log(`Found ${members?.length || 0} household members`)
    }
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

    // Get existing events synced from Google (to track what we've seen)
    const { data: existingEvents } = await supabase
      .from('member_events')
      .select('id, google_event_id')
      .eq('source', 'google_calendar')
      .not('google_event_id', 'is', null)

    const existingEventIds = new Set(existingEvents?.map((e) => e.google_event_id) || [])
    const gmailEventIds = new Set<string>()

    // Process Gmail invites
    const eventsToUpsert: Array<ReturnType<typeof mapGmailInviteToMemberEvent>> = []
    const unmatchedInvites: UnmatchedCalendarInvite[] = []
    const now = new Date()
    const expiresAt = addDays(now, 7) // Unmatched invites expire after 7 days

    for (const invite of gmailInvites) {
      gmailEventIds.add(invite.uid)

      // Skip events in the past
      if (invite.startDate < formatDateISO(today)) {
        continue
      }

      // Find matching member by organizer email
      const member = emailToMember.get(invite.organizerEmail.toLowerCase())
      if (!member) {
        // Organizer email doesn't match any member - add to unmatched
        unmatchedInvites.push({
          id: invite.uid,
          title: invite.summary,
          date: invite.startDate,
          endDate: invite.endDate,
          organizerEmail: invite.organizerEmail,
          maskedEmail: maskEmail(invite.organizerEmail),
          receivedAt: now.toISOString(),
          expiresAt: formatDateISO(expiresAt),
        })
        continue
      }

      // Map to our format
      const memberEvent = mapGmailInviteToMemberEvent(invite, member.id, member.household_id)
      eventsToUpsert.push(memberEvent)
    }

    // Upsert matched events
    let upsertedCount = 0
    const affectedHouseholds = new Set<string>()
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
          affectedHouseholds.add(event.household_id)
        }
      }
    }

    // Note: We don't auto-delete events since Gmail retains emails
    // Users can manually delete events they don't want

    return NextResponse.json({
      success: true,
      synced: upsertedCount,
      deleted: 0,
      unmatched: unmatchedInvites.length,
      unmatchedInvites: unmatchedInvites.slice(0, 20), // Show first 20 with masked emails
      totalInvitesFound: gmailInvites.length,
    })
  } catch (error) {
    return handleApiError(error, 'calendar sync')
  }
}

// GET /api/calendar/sync - Get sync status
export async function GET() {
  try {
    const supabase = await createClient()

    // Check if user is admin via JWT claims
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !isUserAdmin(user)) {
      return ApiErrors.adminRequired()
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
    return handleApiError(error, 'calendar status')
  }
}
