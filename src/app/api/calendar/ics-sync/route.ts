import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { validateOrigin } from '@/lib/config'
import { fetchAndParseICS, type ICSEvent } from '@/lib/ics-parser'
import { formatDateISO, addDays } from '@/lib/utils'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

// Sync window: 90 days ahead
const SYNC_DAYS_AHEAD = 90

interface SyncResult {
  memberId: string
  memberName: string
  success: boolean
  eventsCount: number
  error?: string
}

/**
 * POST /api/calendar/ics-sync
 *
 * Sync ICS calendar events for members.
 * Can sync a specific member or all members (for cron).
 */
export async function POST(request: Request) {
  try {
    // Check if this is a cron request (uses timing-safe comparison)
    const { verifyCronRequest } = await import('@/lib/cron-auth')
    const isCronRequest = verifyCronRequest(request)

    if (isCronRequest) {
      // Cron: sync all members with ICS URLs
      return syncAllMembers()
    }

    // User request: validate origin and auth
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return ApiErrors.unauthorized()
    }

    // Get user's household
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return ApiErrors.notFound('Husstanden')
    }

    // Parse request body for optional member filter
    const body = await request.json().catch(() => ({}))
    const { memberId } = body as { memberId?: string }

    // Get members with ICS URLs to sync
    let membersQuery = supabase
      .from('household_members')
      .select('id, name, ics_calendar_url, household_id')
      .eq('household_id', membership.household_id)
      .not('ics_calendar_url', 'is', null)

    if (memberId) {
      membersQuery = membersQuery.eq('id', memberId)
    }

    const { data: members, error: membersError } = await membersQuery

    if (membersError) {
      console.error('Error fetching members:', membersError)
      return ApiErrors.internal({ internalMessage: 'Failed to fetch members' })
    }

    if (!members || members.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No members with ICS calendars to sync',
        results: [],
      })
    }

    // Sync each member
    const results: SyncResult[] = []
    for (const member of members) {
      const result = await syncMemberICS(supabase, member)
      results.push(result)
    }

    const successCount = results.filter((r) => r.success).length
    const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)

    return NextResponse.json({
      success: results.every((r) => r.success),
      results,
      summary: {
        membersTotal: members.length,
        membersSuccess: successCount,
        membersFailed: members.length - successCount,
        eventsTotal: totalEvents,
      },
    })
  } catch (error) {
    return handleApiError(error, 'ICS sync')
  }
}

/**
 * Sync all members with ICS URLs (for cron job).
 */
async function syncAllMembers(): Promise<NextResponse> {
  console.log('[ICS Cron] Starting scheduled ICS calendar sync')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[ICS Cron] Missing Supabase configuration')
    return ApiErrors.internal({ internalMessage: 'Missing Supabase configuration' })
  }

  const supabase = createServiceClient(supabaseUrl, serviceRoleKey)

  // Get all members with ICS URLs
  const { data: members, error: membersError } = await supabase
    .from('household_members')
    .select('id, name, ics_calendar_url, household_id')
    .not('ics_calendar_url', 'is', null)

  if (membersError) {
    console.error('[ICS Cron] Error fetching members:', membersError)
    return ApiErrors.internal({ internalMessage: 'Failed to fetch members' })
  }

  if (!members || members.length === 0) {
    console.log('[ICS Cron] No members with ICS calendars')
    return NextResponse.json({
      success: true,
      message: 'No members with ICS calendars to sync',
      membersProcessed: 0,
    })
  }

  console.log(`[ICS Cron] Found ${members.length} members with ICS calendars`)

  // Sync each member
  const results: SyncResult[] = []
  for (const member of members) {
    const result = await syncMemberICS(supabase, member)
    results.push(result)
    // Small delay between syncs to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  const successCount = results.filter((r) => r.success).length
  const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)

  console.log(`[ICS Cron] Sync complete: ${successCount}/${members.length} success, ${totalEvents} events`)

  return NextResponse.json({
    success: true,
    membersProcessed: members.length,
    membersSuccess: successCount,
    membersFailed: members.length - successCount,
    eventsTotal: totalEvents,
  })
}

/**
 * Sync ICS calendar for a single member.
 */
async function syncMemberICS(
  supabase: any,
  member: {
    id: string
    name: string
    ics_calendar_url: string
    household_id: string
  }
): Promise<SyncResult> {
  const result: SyncResult = {
    memberId: member.id,
    memberName: member.name,
    success: false,
    eventsCount: 0,
  }

  try {
    // Calculate date range
    const startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    const endDate = addDays(startDate, SYNC_DAYS_AHEAD)

    // Fetch and parse ICS
    const events = await fetchAndParseICS(member.ics_calendar_url, startDate, endDate)

    // Convert to member_events format
    const eventsToUpsert = events.map((event) => {
      // Format time as HH:MM:SS if not an all-day event
      let eventTime: string | null = null
      if (!event.isAllDay) {
        const hours = event.startDate.getHours().toString().padStart(2, '0')
        const minutes = event.startDate.getMinutes().toString().padStart(2, '0')
        eventTime = `${hours}:${minutes}:00`
      }

      return {
        household_id: member.household_id,
        member_id: member.id,
        date: formatDateISO(event.startDate),
        end_date: event.endDate.toDateString() !== event.startDate.toDateString()
          ? formatDateISO(event.endDate)
          : null,
        title: event.summary.substring(0, 200), // Truncate long titles
        event_type: inferEventType(event),
        event_time: eventTime,
        source: 'ics_calendar' as const,
        source_email: null,
        google_event_id: null,
        ics_uid: event.uid,
      }
    })

    // Delete old ICS events for this member that are no longer in the feed
    // Only delete events within our sync window
    const currentUIDs = new Set(eventsToUpsert.map((e) => e.ics_uid))

    const { data: existingEvents } = await supabase
      .from('member_events')
      .select('id, ics_uid, date')
      .eq('member_id', member.id)
      .eq('source', 'ics_calendar')
      .gte('date', formatDateISO(startDate))
      .lte('date', formatDateISO(endDate))

    if (existingEvents) {
      const eventsToDelete = existingEvents.filter(
        (e: { ics_uid: string }) => e.ics_uid && !currentUIDs.has(e.ics_uid)
      )
      if (eventsToDelete.length > 0) {
        await supabase
          .from('member_events')
          .delete()
          .in('id', eventsToDelete.map((e: { id: string }) => e.id))
      }
    }

    // Upsert events
    if (eventsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('member_events')
        .upsert(eventsToUpsert, {
          onConflict: 'household_id,member_id,date,ics_uid',
          ignoreDuplicates: false,
        })

      if (upsertError) {
        throw new Error(`Failed to upsert events: ${upsertError.message}`)
      }
    }

    // Update sync status
    await supabase
      .from('household_members')
      .update({
        ics_last_sync_at: new Date().toISOString(),
        ics_sync_error: null,
      })
      .eq('id', member.id)

    result.success = true
    result.eventsCount = eventsToUpsert.length

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[ICS] Sync failed for ${member.name}:`, errorMessage)

    // Update sync error
    await supabase
      .from('household_members')
      .update({
        ics_sync_error: errorMessage.substring(0, 500),
      })
      .eq('id', member.id)

    result.error = errorMessage
  }

  return result
}

/**
 * Infer event type from ICS event content.
 */
function inferEventType(event: ICSEvent): 'work' | 'travel' | 'family' | 'other' {
  const text = `${event.summary} ${event.description || ''} ${event.location || ''}`.toLowerCase()

  // Check for travel-related keywords
  if (
    text.includes('flight') ||
    text.includes('fly') ||
    text.includes('reise') ||
    text.includes('travel') ||
    text.includes('trip') ||
    text.includes('airport') ||
    text.includes('hotel')
  ) {
    return 'travel'
  }

  // Check for family-related keywords
  if (
    text.includes('family') ||
    text.includes('familie') ||
    text.includes('birthday') ||
    text.includes('bursdag') ||
    text.includes('wedding') ||
    text.includes('bryllup')
  ) {
    return 'family'
  }

  // Default to work (most ICS calendar events are work-related)
  return 'work'
}

/**
 * GET /api/calendar/ics-sync
 *
 * Get ICS sync status for current user.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return ApiErrors.unauthorized()
    }

    // Get user's member record with ICS status
    const { data: member, error } = await supabase
      .from('household_members')
      .select('id, name, ics_calendar_url, ics_last_sync_at, ics_sync_error')
      .eq('user_id', user.id)
      .single()

    if (error || !member) {
      return ApiErrors.notFound('Medlemmet')
    }

    return NextResponse.json({
      hasICSCalendar: !!member.ics_calendar_url,
      lastSyncAt: member.ics_last_sync_at,
      syncError: member.ics_sync_error,
    })
  } catch (error) {
    return handleApiError(error, 'ICS status')
  }
}
