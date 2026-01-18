import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUserAdmin } from '@/lib/config'
import { ISkoleClient, ISkoleAuthError, ISkoleError } from '@/lib/integrations/iskole'
import { ApiErrors, handleApiError } from '@/lib/api-errors'
import { addDays } from '@/lib/utils'
import { handleSyncSetup, getSyncStartDate, HISTORICAL_SYNC_DAYS, FUTURE_SYNC_DAYS } from '@/lib/integrations/shared'
import { sendNewEventNotification } from '@/lib/integrations/shared/deletion-handler'
import { revalidateHouseholdCache } from '@/lib/data/server'

interface SyncResult {
  integrationId: string
  displayName: string
  success: boolean
  error?: string
  messagesCount: number
  eventsCount: number
  deletedEventsCount?: number
  newEventsCount?: number
}

/**
 * POST /api/integrations/iskole/sync
 *
 * Sync messages from iSkole for the user's household.
 */
export async function POST(request: Request) {
  try {
    // Common setup: CSRF, auth, rate limit, household check, get integrations
    const setup = await handleSyncSetup(request, {
      service: 'iskole',
      rateLimitKey: 'iskoleSync',
    })

    if (!setup.success) {
      return setup.response
    }

    const { supabase, householdId, integrations, isAdmin, fullSync } = setup

    // Sync each integration
    const results: SyncResult[] = []

    for (const integration of integrations) {
      const result = await syncIntegration(
        supabase,
        integration,
        householdId,
        isAdmin,
        fullSync
      )
      results.push(result)
    }

    // Calculate totals
    const totalMessages = results.reduce((sum, r) => sum + r.messagesCount, 0)
    const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)
    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length

    // Revalidate all household caches so fresh data shows on feed and week pages
    revalidateHouseholdCache(householdId)

    return NextResponse.json({
      success: failureCount === 0,
      results: isAdmin ? results : results.map((r) => ({ ...r, error: r.error ? 'Sync failed' : undefined })),
      summary: {
        integrationsTotal: integrations.length,
        integrationsSuccess: successCount,
        integrationsFailed: failureCount,
        messagesTotal: totalMessages,
        eventsTotal: totalEvents,
      },
    })
  } catch (error) {
    return handleApiError(error, 'iskole sync')
  }
}

/**
 * Sync a single iSkole integration.
 */
async function syncIntegration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  integration: {
    id: string
    display_name: string
    credentials_encrypted: string
    last_sync_at: string | null
  },
  householdId: string,
  isAdmin: boolean,
  fullSync: boolean
): Promise<SyncResult> {
  const result: SyncResult = {
    integrationId: integration.id,
    displayName: integration.display_name,
    success: false,
    messagesCount: 0,
    eventsCount: 0,
  }

  try {
    // Get decrypted credentials
    const { data: credentials, error: credError } = await supabase.rpc(
      'get_integration_credentials',
      { p_integration_id: integration.id }
    )

    if (credError || !credentials) {
      throw new Error('Failed to decrypt credentials')
    }

    const { username, password } = credentials as {
      username: string
      password: string
    }

    // Create iSkole client and login
    const client = new ISkoleClient({
      debug: process.env.NODE_ENV === 'development',
    })

    try {
      await client.login(username, password)
    } catch (error) {
      if (error instanceof ISkoleAuthError) {
        // Update status to auth_failed
        await supabase.rpc('update_integration_sync_status', {
          p_integration_id: integration.id,
          p_status: 'auth_failed',
          p_error: 'Invalid credentials',
        })
        result.error = isAdmin ? 'Authentication failed - check credentials' : 'Sync failed'
        return result
      }
      throw error
    }

    // Get children for mapping
    const { data: childMappings } = await supabase
      .from('external_integration_children')
      .select('child_id, external_group_id, external_group_name')
      .eq('integration_id', integration.id)

    // Build a map of external child IDs to our child IDs
    const childIdMap = new Map<string, string>()
    childMappings?.forEach((m) => {
      if (m.external_group_id && m.child_id) {
        childIdMap.set(m.external_group_id, m.child_id)
      }
    })

    // Calculate date range for messages
    // On first sync or fullSync, go back 1 year for rich historical context
    const isHistoricalSync = fullSync || !integration.last_sync_at
    const lastSync = getSyncStartDate(integration.last_sync_at, fullSync)

    if (isHistoricalSync) {
      console.log(`[iSkole] Historical sync: fetching ${HISTORICAL_SYNC_DAYS} days of data`)
    }
    console.log(`[iSkole] Message sync window: ${lastSync.toISOString()} to now`)

    const messagesToUpsert: Array<{
      integration_id: string
      child_id: string | null
      external_id: string
      external_group_id: string | null
      chat_id: string | null
      sender_name: string | null
      title: string | null
      body: string
      message_date: string
      source_type: string
      raw_data: unknown
    }> = []

    // Fetch children to get their school info
    const children = await client.getChildren()

    // Fetch all messages (uses elevnr=0 to get all children's messages)
    console.log(`[iSkole] Fetching messages for parent`)
    try {
      const messages = await client.getMessages(100, 0)
      console.log(`[iSkole] Fetched ${messages.length} messages`)

      for (const msg of messages) {
        const msgDate = new Date(msg.Mottatt)
        if (msgDate < lastSync) continue

        const senderName = [msg.Fname, msg.Lname].filter(Boolean).join(' ') || null
        // Message includes Elevnr to identify which child it's for
        const childIdStr = msg.Elevnr ? String(msg.Elevnr) : null
        const mappedChildId = childIdStr ? childIdMap.get(childIdStr) || null : null

        messagesToUpsert.push({
          integration_id: integration.id,
          child_id: mappedChildId,
          external_id: `iskole_msg_${msg.Meldingid}`,
          external_group_id: childIdStr,
          chat_id: null,
          sender_name: senderName,
          title: msg.Emne || null,
          body: msg.Tekst || '',
          message_date: msgDate.toISOString(),
          source_type: 'school_message',
          raw_data: msg,
        })
      }
    } catch (msgError) {
      console.error(`[iSkole] Error fetching messages:`, msgError)
    }

    // Upsert messages
    if (messagesToUpsert.length > 0) {
      const { error: messagesError } = await supabase
        .from('external_messages')
        .upsert(messagesToUpsert, {
          onConflict: 'integration_id,external_id',
          ignoreDuplicates: false,
        })

      if (messagesError) {
        console.error('Error upserting messages:', messagesError)
      } else {
        result.messagesCount = messagesToUpsert.length
      }
    }

    // Fetch and sync school calendar (FD = free day, PD = planning day)
    const eventsToUpsert: Array<{
      integration_id: string
      child_id: string | null
      external_id: string
      external_group_id: string | null
      title: string
      description: string | null
      event_date: string
      event_type: string
      raw_data: unknown
    }> = []

    // Track all calendar event IDs we're upserting (for cleanup of stale events)
    const validCalendarEventIds = new Set<string>()

    // Generate months to fetch for the next year (12 months ahead for long-term planning)
    const currentDate = new Date()
    const monthsToFetch: Array<{ month: number; year: number }> = []
    const monthsAhead = Math.ceil(FUTURE_SYNC_DAYS / 30) // ~12 months for 365 days

    for (let i = 0; i < monthsAhead; i++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1)
      monthsToFetch.push({
        month: date.getMonth() + 1, // 1-12
        year: date.getFullYear(),
      })
    }

    console.log(`[iSkole] Fetching calendar for ${monthsToFetch.length} months ahead`)

    // Weekday names for extracting specific days (the API returns day-of-month in these fields)
    const weekdays = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lordag', 'Sondag'] as const
    const weekdayTypes = ['SkoletypeMandag', 'SkoletypeTirsdag', 'SkoletypeOnsdag', 'SkoletypeTorsdag', 'SkoletypeFredag', 'SkoletypeLordag', 'SkoletypeSondag'] as const

    for (const child of children) {
      const childIdStr = String(child.Elevnr)
      const mappedChildId = childIdMap.get(childIdStr) || null

      for (const { month, year } of monthsToFetch) {
        try {
          const calendarDays = await client.getSchoolCalendar(
            month,
            child.Fylkeid,
            child.Planperi,
            child.Skoleid
          )

          // Process each week's data
          for (const week of calendarDays) {
            // Parse the base date to get year and month context
            const baseDateStr = week.Dato // "20250113" format
            const baseYear = parseInt(baseDateStr.substring(0, 4))
            const baseMonth = parseInt(baseDateStr.substring(4, 6)) - 1 // 0-indexed

            // Check each day of the week
            // The API returns day-of-month in weekday fields (e.g., Mandag: "5" means the 5th)
            // SkoletypeX contains the day type (FD=free, PD=planning, SD=school, null=no data)
            for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
              const dayTypeKey = weekdayTypes[dayIndex]
              const dayType = week[dayTypeKey]
              const dayName = weekdays[dayIndex]
              const dayOfMonth = week[dayName] // This is the actual day number (e.g., "5" for the 5th)

              // Skip if no day data or not a closure day
              // Only sync FD (free day) and PD (planning day) for WEEKDAYS
              // Skip weekends (Lordag=Saturday, Sondag=Sunday) as they're always free
              if (!dayOfMonth || !dayType) continue
              if (dayType !== 'FD' && dayType !== 'PD') continue
              if (dayName === 'Lordag' || dayName === 'Sondag') continue

              // Parse the day of month
              const dayNum = parseInt(dayOfMonth, 10)
              if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue

              // Construct the actual date
              const eventDate = new Date(baseYear, baseMonth, dayNum)
              const eventDateStr = eventDate.toISOString().split('T')[0]

              const title = dayType === 'FD' ? 'Skolefri' : 'Planleggingsdag'
              const externalId = `iskole_cal_${child.Elevnr}_${eventDateStr}`
              validCalendarEventIds.add(externalId)

              eventsToUpsert.push({
                integration_id: integration.id,
                child_id: mappedChildId,
                external_id: externalId,
                external_group_id: childIdStr,
                title,
                description: null,
                event_date: eventDateStr,
                event_type: 'school_closure',
                raw_data: { week, dayIndex, dayType, dayOfMonth },
              })
            }
          }
        } catch (calError) {
          console.error(`Error fetching calendar for child ${child.Elevnr} month ${month}:`, calError)
        }
      }
    }

    // Delete stale calendar events that are no longer in the API response
    // Only delete events in the current sync window (first and last month of monthsToFetch)
    const firstMonth = monthsToFetch[0]
    const lastMonth = monthsToFetch[monthsToFetch.length - 1]
    const syncWindowStart = new Date(firstMonth.year, firstMonth.month - 1, 1)
    const syncWindowEnd = new Date(lastMonth.year, lastMonth.month, 0) // Last day of last month
    const syncWindowStartStr = syncWindowStart.toISOString().split('T')[0]
    const syncWindowEndStr = syncWindowEnd.toISOString().split('T')[0]

    const { data: existingCalEvents } = await supabase
      .from('external_events')
      .select('id, external_id')
      .eq('integration_id', integration.id)
      .eq('event_type', 'school_closure')
      .gte('event_date', syncWindowStartStr)
      .lte('event_date', syncWindowEndStr)

    // Track existing event IDs for new event detection
    const existingEventIdSet = new Set(existingCalEvents?.map(e => e.external_id) || [])

    if (existingCalEvents) {
      const eventsToDelete = existingCalEvents.filter(
        (e) => e.external_id?.startsWith('iskole_cal_') && !validCalendarEventIds.has(e.external_id)
      )
      if (eventsToDelete.length > 0) {
        console.log(`[iSkole] Deleting ${eventsToDelete.length} stale calendar events`)

        // Create notifications for deleted future events
        const today = new Date().toISOString().split('T')[0]
        for (const event of eventsToDelete) {
          // Get full event data for notification
          const { data: fullEvent } = await supabase
            .from('external_events')
            .select('*')
            .eq('id', event.id)
            .single()

          if (fullEvent && fullEvent.event_date >= today) {
            await supabase.from('event_change_notifications').insert({
              household_id: householdId,
              change_type: 'removed',
              source_name: 'iSkole',
              original_title: fullEvent.title,
              original_date: fullEvent.event_date,
              child_id: fullEvent.child_id,
              status: 'unread',
              raw_event_data: { ...fullEvent, _source: 'external_integration', _integration_id: integration.id },
            })
          }
        }

        await supabase
          .from('external_events')
          .delete()
          .in('id', eventsToDelete.map((e) => e.id))

        result.deletedEventsCount = eventsToDelete.length
      }
    }

    // Upsert calendar events
    if (eventsToUpsert.length > 0) {
      const { error: eventsError } = await supabase
        .from('external_events')
        .upsert(eventsToUpsert, {
          onConflict: 'integration_id,external_id',
          ignoreDuplicates: false,
        })

      if (eventsError) {
        console.error('Error upserting calendar events:', eventsError)
      } else {
        result.eventsCount += eventsToUpsert.length

        // Send notifications for new events
        const newEvents = eventsToUpsert.filter(e => !existingEventIdSet.has(e.external_id))
        result.newEventsCount = newEvents.length

        // Limit notifications to avoid spam
        const today = new Date().toISOString().split('T')[0]
        const futureNewEvents = newEvents.filter(e => e.event_date >= today).slice(0, 3)
        for (const event of futureNewEvents) {
          await sendNewEventNotification(supabase, householdId, 'iSkole', event.title, event.event_date)
        }
      }
    }

    // Sync timetable (upcoming 2 weeks)
    const timetableToUpsert: Array<{
      integration_id: string
      child_id: string | null
      external_id: string
      external_group_id: string | null
      title: string
      description: string | null
      event_date: string
      event_time: string | null
      end_time: string | null
      event_type: string
      raw_data: unknown
    }> = []

    // Timetable: fetch 90 days ahead (schools don't typically publish further)
    const timetableEndDate = addDays(currentDate, 90)
    const fromDateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '')
    const toDateStr = timetableEndDate.toISOString().split('T')[0].replace(/-/g, '')

    for (const child of children) {
      const childIdStr = String(child.Elevnr)
      const mappedChildId = childIdMap.get(childIdStr) || null

      try {
        const timetable = await client.getTimetable(
          child.Elevnr,
          child.Fylkeid,
          child.Planperi,
          child.Skoleid,
          fromDateStr,
          toDateStr
        )

        console.log(`[iSkole] Child ${child.Elevnr}: ${timetable.length} timetable entries`)

        for (const entry of timetable) {
          // Skip if not a school day or no subject
          if (entry.Skoletype !== 'SD' || !entry.Fagnavn) continue

          // Parse the date from Fradato (ISO timestamp)
          const entryDate = new Date(entry.Fradato)
          const eventDateStr = entryDate.toISOString().split('T')[0]

          // Extract times
          const eventTime = entry.Fradato ? new Date(entry.Fradato).toTimeString().slice(0, 5) : null
          const endTime = entry.Tildato ? new Date(entry.Tildato).toTimeString().slice(0, 5) : null

          // Build description with room and teacher
          const descParts = []
          if (entry.Romnr) descParts.push(`Rom: ${entry.Romnr}`)
          if (entry.Faglaerer) descParts.push(`Lærer: ${entry.Faglaerer}`)
          if (entry.Merknad) descParts.push(entry.Merknad)
          const description = descParts.length > 0 ? descParts.join(' | ') : null

          timetableToUpsert.push({
            integration_id: integration.id,
            child_id: mappedChildId,
            external_id: `iskole_tt_${entry.Id}`,
            external_group_id: childIdStr,
            title: entry.Fagnavn,
            description,
            event_date: eventDateStr,
            event_time: eventTime,
            end_time: endTime,
            event_type: 'school_class',
            raw_data: entry,
          })
        }
      } catch (ttError) {
        console.error(`Error fetching timetable for child ${child.Elevnr}:`, ttError)
      }
    }

    // Upsert timetable events
    if (timetableToUpsert.length > 0) {
      const { error: ttError } = await supabase
        .from('external_events')
        .upsert(timetableToUpsert, {
          onConflict: 'integration_id,external_id',
          ignoreDuplicates: false,
        })

      if (ttError) {
        console.error('Error upserting timetable events:', ttError)
      } else {
        result.eventsCount += timetableToUpsert.length
        console.log(`[iSkole] Synced ${timetableToUpsert.length} timetable events`)
      }
    }

    // Sync absences (informational - show in Feed)
    const absencesToUpsert: Array<{
      integration_id: string
      child_id: string | null
      external_id: string
      external_group_id: string | null
      title: string
      description: string | null
      event_date: string
      event_type: string
      raw_data: unknown
    }> = []

    for (const child of children) {
      const childIdStr = String(child.Elevnr)
      const mappedChildId = childIdMap.get(childIdStr) || null

      try {
        const absences = await client.getAbsences(
          child.Elevnr,
          child.Fylkeid,
          child.Planperi,
          child.Skoleid
        )

        console.log(`[iSkole] Child ${child.Elevnr}: ${absences.length} absence records`)

        for (const absence of absences) {
          // Parse the date
          const absenceDate = new Date(absence.Dato)
          const eventDateStr = absenceDate.toISOString().split('T')[0]

          // Build title based on absence type
          const isFullDay = absence.Typefravaer === 'D'
          const title = isFullDay
            ? `Fravær: Hel dag`
            : `Fravær: Time ${absence.Timenr} (${absence.Fag})`

          // Build description
          const descParts = []
          if (absence.Minutter > 0) descParts.push(`${absence.Minutter} min`)
          if (absence.Dokumentasjonstypetekst) descParts.push(absence.Dokumentasjonstypetekst)
          if (absence.Merknad) descParts.push(absence.Merknad)
          const description = descParts.length > 0 ? descParts.join(' | ') : null

          absencesToUpsert.push({
            integration_id: integration.id,
            child_id: mappedChildId,
            external_id: `iskole_abs_${absence.Id}`,
            external_group_id: childIdStr,
            title,
            description,
            event_date: eventDateStr,
            event_type: 'school_absence',
            raw_data: absence,
          })
        }
      } catch (absError) {
        console.error(`Error fetching absences for child ${child.Elevnr}:`, absError)
      }
    }

    // Upsert absence events
    if (absencesToUpsert.length > 0) {
      const { error: absError } = await supabase
        .from('external_events')
        .upsert(absencesToUpsert, {
          onConflict: 'integration_id,external_id',
          ignoreDuplicates: false,
        })

      if (absError) {
        console.error('Error upserting absence events:', absError)
      } else {
        result.eventsCount += absencesToUpsert.length
        console.log(`[iSkole] Synced ${absencesToUpsert.length} absence events`)
      }
    }

    // Update sync status
    await supabase.rpc('update_integration_sync_status', {
      p_integration_id: integration.id,
      p_status: 'ok',
      p_error: null,
    })

    result.success = true
    return result
  } catch (error) {
    console.error(`Sync failed for integration ${integration.id}:`, error)

    // Update status to error
    const errorMessage = error instanceof ISkoleError ? error.message : 'Unknown error'
    await supabase.rpc('update_integration_sync_status', {
      p_integration_id: integration.id,
      p_status: 'error',
      p_error: errorMessage,
    })

    result.error = isAdmin ? errorMessage : 'Sync failed'
    return result
  }
}

/**
 * GET /api/integrations/iskole/sync
 *
 * Get sync status for all iSkole integrations.
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

    // Get integrations via RPC (handles RLS)
    const { data: integrations, error } = await supabase.rpc('get_household_integrations')

    if (error) {
      return ApiErrors.internal({ internalMessage: 'Failed to fetch integrations' })
    }

    // Filter to iSkole only
    const iskoleIntegrations = integrations?.filter(
      (i: { service: string }) => i.service === 'iskole'
    )

    const isAdmin = isUserAdmin(user)

    return NextResponse.json({
      integrations: iskoleIntegrations?.map((i: {
        id: string
        display_name: string
        account_email: string | null
        last_sync_at: string | null
        last_sync_status: string
        last_sync_error: string | null
      }) => ({
        id: i.id,
        displayName: i.display_name,
        accountEmail: i.account_email,
        lastSyncAt: i.last_sync_at,
        lastSyncStatus: i.last_sync_status,
        lastSyncError: isAdmin ? i.last_sync_error : null,
      })),
    })
  } catch (error) {
    return handleApiError(error, 'iskole sync status')
  }
}
