/**
 * Shared household ICS calendar sync logic.
 * Used by both the API route (user-triggered) and cron job.
 */
import { fetchAndParseICS } from '@/lib/ics-parser'
import { formatDateISO, addDays } from '@/lib/utils'

// Default sync window: 90 days ahead
const DEFAULT_SYNC_DAYS = 90

export interface HouseholdICSInput {
  id: string
  name: string
  ics_calendar_url: string
}

export interface HouseholdICSSyncResult {
  householdId: string
  householdName: string
  success: boolean
  eventsCount: number
  error?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

/**
 * Sync ICS calendar for a single household.
 * Fetches events from ICS URL, deletes removed events, and upserts new/updated events.
 */
export async function syncHouseholdICS(
  supabase: SupabaseClient,
  household: HouseholdICSInput,
  options: { syncDays?: number } = {}
): Promise<HouseholdICSSyncResult> {
  const syncDays = options.syncDays ?? DEFAULT_SYNC_DAYS

  const result: HouseholdICSSyncResult = {
    householdId: household.id,
    householdName: household.name,
    success: false,
    eventsCount: 0,
  }

  try {
    // Calculate date range
    const startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    const endDate = addDays(startDate, syncDays)

    // Fetch and parse ICS
    const events = await fetchAndParseICS(household.ics_calendar_url, startDate, endDate)

    // Convert to household_events format
    const eventsToUpsert = events.map((event) => {
      // Format time as HH:MM:SS if not an all-day event
      let eventTime: string | null = null
      let endTime: string | null = null

      if (!event.isAllDay) {
        const startHours = event.startDate.getHours().toString().padStart(2, '0')
        const startMinutes = event.startDate.getMinutes().toString().padStart(2, '0')
        eventTime = `${startHours}:${startMinutes}:00`

        const endHours = event.endDate.getHours().toString().padStart(2, '0')
        const endMinutes = event.endDate.getMinutes().toString().padStart(2, '0')
        endTime = `${endHours}:${endMinutes}:00`
      }

      return {
        household_id: household.id,
        title: event.summary.substring(0, 200), // Truncate long titles
        description: event.description ? event.description.substring(0, 1000) : null,
        event_date: formatDateISO(event.startDate),
        end_date:
          event.endDate.toDateString() !== event.startDate.toDateString()
            ? formatDateISO(event.endDate)
            : null,
        event_time: eventTime,
        end_time: endTime,
        location: event.location ? event.location.substring(0, 500) : null,
        source: 'ics_calendar' as const,
        ics_uid: event.uid,
        is_redistributed: false, // Will be set to true when AI suggests moving to a person
      }
    })

    // Delete old ICS events for this household that are no longer in the feed
    // Only delete events within our sync window
    const currentUIDs = new Set(eventsToUpsert.map((e) => e.ics_uid))

    const { data: existingEvents } = await supabase
      .from('household_events')
      .select('id, ics_uid, event_date')
      .eq('household_id', household.id)
      .eq('source', 'ics_calendar')
      .gte('event_date', formatDateISO(startDate))
      .lte('event_date', formatDateISO(endDate))

    if (existingEvents) {
      const eventsToDelete = existingEvents.filter(
        (e: { ics_uid: string }) => e.ics_uid && !currentUIDs.has(e.ics_uid)
      )
      if (eventsToDelete.length > 0) {
        await supabase
          .from('household_events')
          .delete()
          .in(
            'id',
            eventsToDelete.map((e: { id: string }) => e.id)
          )
      }
    }

    // Upsert events (use partial unique index on household_id, event_date, ics_uid)
    if (eventsToUpsert.length > 0) {
      for (const event of eventsToUpsert) {
        const { error: upsertError } = await supabase.from('household_events').upsert(event, {
          onConflict: 'household_id,event_date,ics_uid',
          ignoreDuplicates: false,
        })

        if (upsertError) {
          console.error(`[Household ICS] Upsert error for event:`, upsertError)
          // Continue with other events
        }
      }
    }

    // Update sync status
    await supabase
      .from('households')
      .update({
        ics_last_sync_at: new Date().toISOString(),
        ics_sync_error: null,
      })
      .eq('id', household.id)

    result.success = true
    result.eventsCount = eventsToUpsert.length
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Household ICS] Sync failed for ${household.name}:`, errorMessage)

    // Update sync error
    await supabase
      .from('households')
      .update({
        ics_sync_error: errorMessage.substring(0, 500),
      })
      .eq('id', household.id)

    result.error = errorMessage
  }

  return result
}
