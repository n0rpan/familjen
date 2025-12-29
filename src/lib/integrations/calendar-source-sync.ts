/**
 * Calendar Source Sync
 *
 * Handles syncing external calendar sources (HTML pages, ICS feeds, PDFs)
 * with proper update/delete detection and removal notifications.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { extractEventsFromHtml } from './document-extraction'
import type { ExtractedEvent } from './document-extraction'
import { isUrlAllowed, truncate, sanitizeString, sanitizeTime } from '@/lib/sanitize'
import { deduplicateEvents } from './event-deduplication'

export interface CalendarSource {
  id: string
  household_id: string
  url: string
  display_name: string
  url_type: 'calendar_page' | 'pdf' | 'ics'
  child_id: string | null
  auto_sync: boolean
  last_sync_at: string | null
}

export interface SyncResult {
  success: boolean
  eventsFound: number
  eventsCreated: number
  eventsUpdated: number
  eventsRemoved: number
  notificationsCreated: number
  duplicatesAutoMerged: number
  duplicateSuggestionsCreated: number
  error?: string
  debug?: {
    contentLength?: number
    model?: string
  }
}

interface ExternalEvent {
  id: string
  source_url_id: string
  source_event_hash: string
  title: string
  event_date: string
  end_date: string | null
  event_time: string | null
  event_type: string | null
  description: string | null
  child_id: string | null
  linked_task_id: string | null
}

interface LinkedTask {
  id: string
  title: string
  task_type: string
}

/**
 * Generate a stable hash for an event based on its key properties.
 * This allows us to identify the same event across syncs even if details change slightly.
 */
export function generateEventHash(
  sourceUrlId: string,
  date: string,
  title: string
): string {
  // Normalize title: lowercase, remove extra spaces, normalize common terms
  const normalizedTitle = title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    // Normalize common Norwegian word variations (e.g., "Vinterferie" → "ferie")
    .replace(/\w*ferie\b/gi, 'ferie')
    .replace(/\w*fri\b/gi, 'fri')

  const input = `${sourceUrlId}:${date}:${normalizedTitle}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

/**
 * Sync a calendar source, handling updates and deletions properly.
 */
export async function syncCalendarSource(
  supabase: SupabaseClient,
  source: CalendarSource,
  options: {
    model?: string
    fetchContent?: () => Promise<string>  // Optional override for testing
  } = {}
): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    eventsFound: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    eventsRemoved: 0,
    notificationsCreated: 0,
    duplicatesAutoMerged: 0,
    duplicateSuggestionsCreated: 0,
  }

  // Track newly created event IDs for deduplication
  const newEventIds: string[] = []

  try {
    // 1. Fetch content from source
    let content: string
    if (options.fetchContent) {
      content = await options.fetchContent()
    } else {
      // SSRF protection: validate URL before fetching
      if (!isUrlAllowed(source.url)) {
        throw new Error('URL not allowed: blocked domain or protocol')
      }

      const response = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      content = await response.text()
      console.log(`[CalendarSourceSync] Fetched ${content.length} chars from ${source.url}`)
    }

    // 2. Extract events using AI
    const model = options.model || 'google/gemini-2.5-flash-lite'
    console.log(`[CalendarSourceSync] Using model: ${model}`)

    // Get child name if linked
    let childName: string | undefined
    if (source.child_id) {
      const { data: child } = await supabase
        .from('children')
        .select('name')
        .eq('id', source.child_id)
        .single()
      childName = child?.name
    }

    const extractedEvents = await extractEventsFromHtml(content, {
      childName,
      schoolName: source.display_name,
      model,
    })

    console.log(`[CalendarSourceSync] extractEventsFromHtml returned ${extractedEvents.length} events`)
    if (extractedEvents.length > 0) {
      console.log(`[CalendarSourceSync] First event: ${JSON.stringify(extractedEvents[0])}`)
    }

    result.eventsFound = extractedEvents.length
    result.debug = {
      contentLength: content.length,
      model,
    }

    // 3. Get existing events for this source
    const { data: existingEvents } = await supabase
      .from('external_events')
      .select('id, source_event_hash, title, event_date, end_date, event_time, event_type, description, child_id, linked_task_id')
      .eq('source_url_id', source.id)

    const existingByHash = new Map<string, ExternalEvent>()
    for (const event of (existingEvents || [])) {
      if (event.source_event_hash) {
        existingByHash.set(event.source_event_hash, event as ExternalEvent)
      }
    }

    // 4. Process extracted events - upsert
    const processedHashes = new Set<string>()

    for (const event of extractedEvents) {
      const hash = generateEventHash(source.id, event.date, event.title)
      processedHashes.add(hash)

      const existing = existingByHash.get(hash)

      // Sanitize event data before inserting
      const eventData = {
        source_url_id: source.id,
        source_event_hash: hash,
        external_id: `source_${source.id}_${hash}`,
        title: truncate(sanitizeString(event.title), 200),
        event_date: event.date,
        end_date: event.endDate || null,
        event_time: sanitizeTime(event.time),
        event_type: event.eventType,
        description: truncate(sanitizeString(event.description), 2000),
        child_id: source.child_id,
        raw_data: { confidence: event.confidence, extracted_at: new Date().toISOString() },
      }

      if (existing) {
        // Update existing event
        const { error } = await supabase
          .from('external_events')
          .update(eventData)
          .eq('id', existing.id)

        if (!error) {
          result.eventsUpdated++
        }
      } else {
        // Insert new event and capture the ID for deduplication
        const { data: insertedEvent, error } = await supabase
          .from('external_events')
          .insert(eventData)
          .select('id')
          .single()

        if (!error && insertedEvent) {
          result.eventsCreated++
          newEventIds.push(insertedEvent.id)
        }
      }
    }

    // 5. Find removed events (in DB but not in current extraction)
    const removedEvents: ExternalEvent[] = []
    for (const [hash, event] of existingByHash) {
      if (!processedHashes.has(hash)) {
        // Only consider removal if event is in the future (don't notify about past events)
        const eventDate = new Date(event.event_date)
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        if (eventDate >= today) {
          removedEvents.push(event)
        }
      }
    }

    // 6. Handle removed events - create notifications and delete
    for (const event of removedEvents) {
      // Get linked task info if any
      let linkedTask: LinkedTask | null = null
      if (event.linked_task_id) {
        const { data } = await supabase
          .from('child_tasks')
          .select('id, title, task_type')
          .eq('id', event.linked_task_id)
          .single()
        linkedTask = data as LinkedTask | null
      }

      // Get child name for notification
      let childName: string | null = null
      if (event.child_id) {
        const { data: child } = await supabase
          .from('children')
          .select('name')
          .eq('id', event.child_id)
          .single()
        childName = child?.name || null
      }

      // Create removal notification
      const { error: notifError } = await supabase
        .from('event_change_notifications')
        .insert({
          household_id: source.household_id,
          change_type: 'removed',
          source_url_id: source.id,
          source_name: source.display_name,
          original_title: event.title,
          original_date: event.event_date,
          original_end_date: event.end_date,
          original_time: event.event_time,
          original_description: event.description,
          child_id: event.child_id,
          child_name: childName,
          deleted_task_id: linkedTask?.id || null,
          deleted_task_type: linkedTask?.task_type || null,
          deleted_task_title: linkedTask?.title || null,
          status: 'unread',
        })

      if (!notifError) {
        result.notificationsCreated++
      }

      // Delete linked task if any
      if (linkedTask) {
        await supabase
          .from('child_tasks')
          .delete()
          .eq('id', linkedTask.id)
      }

      // Delete the event
      await supabase
        .from('external_events')
        .delete()
        .eq('id', event.id)

      result.eventsRemoved++
    }

    // 7. Update sync status
    await supabase
      .from('external_source_urls')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'ok',
        last_sync_error: null,
      })
      .eq('id', source.id)

    // 8. Run deduplication on newly created events
    if (newEventIds.length > 0) {
      const dedupeResult = await deduplicateEvents(supabase, source.household_id, newEventIds)
      result.duplicatesAutoMerged = dedupeResult.autoMerged
      result.duplicateSuggestionsCreated = dedupeResult.suggestionsCreated
    }

    result.success = true
    console.log(`[CalendarSourceSync] Sync complete:`, JSON.stringify(result))
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Update sync status with error
    await supabase
      .from('external_source_urls')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_error: errorMessage,
      })
      .eq('id', source.id)

    result.error = errorMessage
    return result
  }
}

/**
 * Sync all calendar sources for a household.
 */
export async function syncAllCalendarSources(
  supabase: SupabaseClient,
  householdId: string,
  options: { model?: string } = {}
): Promise<{ sources: Array<{ id: string; name: string; result: SyncResult }> }> {
  // Get all sources for household with auto_sync enabled
  const { data: sources, error } = await supabase
    .from('external_source_urls')
    .select('*')
    .eq('household_id', householdId)
    .eq('auto_sync', true)

  if (error || !sources) {
    return { sources: [] }
  }

  const results: Array<{ id: string; name: string; result: SyncResult }> = []

  for (const source of sources) {
    console.log(`[CalendarSourceSync] Syncing ${source.display_name}`)

    const result = await syncCalendarSource(supabase, source as CalendarSource, options)

    results.push({
      id: source.id,
      name: source.display_name,
      result,
    })

    console.log(
      `[CalendarSourceSync] ${source.display_name}: ` +
        `${result.eventsFound} found, ${result.eventsCreated} created, ` +
        `${result.eventsUpdated} updated, ${result.eventsRemoved} removed, ` +
        `${result.duplicatesAutoMerged} auto-merged, ${result.duplicateSuggestionsCreated} suggestions`
    )
  }

  return { sources: results }
}

/**
 * Convert an external event to a child task (when user accepts a suggestion).
 */
export async function acceptCalendarEvent(
  supabase: SupabaseClient,
  eventId: string,
  options: {
    overrideTitle?: string
    overrideDate?: string
    taskType?: 'bring' | 'appointment' | 'reminder' | 'other'
  } = {}
): Promise<{ taskId: string | null; error?: string }> {
  // Get the event
  const { data: event, error: eventError } = await supabase
    .from('external_events')
    .select('*, source_url:external_source_urls(household_id)')
    .eq('id', eventId)
    .single()

  if (eventError || !event) {
    return { taskId: null, error: 'Event not found' }
  }

  const householdId = (event.source_url as { household_id: string })?.household_id
  if (!householdId) {
    return { taskId: null, error: 'Household not found' }
  }

  // Create child task
  const { data: task, error: taskError } = await supabase
    .from('child_tasks')
    .insert({
      household_id: householdId,
      child_id: event.child_id,
      date: options.overrideDate || event.event_date,
      time: event.event_time,
      task_type: options.taskType || 'reminder',
      title: options.overrideTitle || event.title,
      notes: event.description,
      status: 'open',
    })
    .select('id')
    .single()

  if (taskError || !task) {
    return { taskId: null, error: taskError?.message || 'Failed to create task' }
  }

  // Link the event to the task
  await supabase
    .from('external_events')
    .update({ linked_task_id: task.id })
    .eq('id', eventId)

  return { taskId: task.id }
}
