/**
 * Calendar Source Sync
 *
 * Handles syncing external calendar sources (HTML pages, ICS feeds, PDFs)
 * with proper update/delete detection and removal notifications.
 *
 * Key insight: AI extraction is non-deterministic. The same event can be
 * extracted with slightly different titles between syncs. We use LLM verification
 * to check if "removed" events are actually still present with different wording.
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
    firstError?: string
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

interface RemovalVerification {
  removedEventId: string
  matchedNewEventId: string | null  // ID of the new event this "removal" actually matches
  isActuallyRemoved: boolean
  reason: string
}

/**
 * Use LLM to verify if "removed" events are actually removed or just extracted with different wording.
 * This prevents false positive removal notifications due to AI extraction variation.
 */
async function verifyRemovalsWithLLM(
  potentiallyRemovedEvents: ExternalEvent[],
  newlyCreatedEvents: Array<{ id: string; title: string; event_date: string; end_date: string | null }>,
  model: string
): Promise<RemovalVerification[]> {
  if (potentiallyRemovedEvents.length === 0) return []

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    // If no API key, assume all removals are real (conservative approach)
    console.warn('[CalendarSourceSync] No OPENROUTER_API_KEY, skipping removal verification')
    return potentiallyRemovedEvents.map(event => ({
      removedEventId: event.id,
      matchedNewEventId: null,
      isActuallyRemoved: true,
      reason: 'Ingen API-nøkkel for verifisering',
    }))
  }

  // Find potential matches based on date proximity (±3 days)
  const pairsToCheck: Array<{ removed: ExternalEvent; newEvent: typeof newlyCreatedEvents[0] }> = []

  for (const removed of potentiallyRemovedEvents) {
    const removedDate = new Date(removed.event_date)

    for (const newEvent of newlyCreatedEvents) {
      const newDate = new Date(newEvent.event_date)
      const daysDiff = Math.abs((removedDate.getTime() - newDate.getTime()) / (1000 * 60 * 60 * 24))

      if (daysDiff <= 3) {
        pairsToCheck.push({ removed, newEvent })
      }
    }
  }

  // If no pairs with date proximity, all removals are real
  if (pairsToCheck.length === 0) {
    return potentiallyRemovedEvents.map(event => ({
      removedEventId: event.id,
      matchedNewEventId: null,
      isActuallyRemoved: true,
      reason: 'Ingen liknende hendelser funnet',
    }))
  }

  // Build prompt for LLM
  const pairsDescription = pairsToCheck.map((pair, index) => {
    const r = pair.removed
    const n = pair.newEvent
    return `Pair ${index + 1}:
  OLD (might be removed): "${r.title}" on ${r.event_date}${r.end_date ? ` to ${r.end_date}` : ''}
  NEW (just extracted): "${n.title}" on ${n.event_date}${n.end_date ? ` to ${n.end_date}` : ''}`
  }).join('\n\n')

  const systemPrompt = `Du er ekspert på norske skolekalendere og barnehagerutiner.

Oppgaven din er å avgjøre om en "fjernet" hendelse faktisk er den samme som en ny hendelse, bare med litt annen formulering fra AI-ekstraksjon.

Vanlige varianter:
- "Fri (Helligdag)" og "Helligdag" er SAMME hendelse
- "Påskeferie" og "Påske ferie" er SAMME hendelse
- "Vinterferie" og "Ferie uke 8" er SAMME hendelse
- "Planleggingsdag" og "Planl.dag" er SAMME hendelse
- "Stengt SFO" og "SFO stengt" er SAMME hendelse

Svar med JSON for hvert par.`

  const userPrompt = `Sjekk om disse "fjernede" hendelsene faktisk matcher noen av de nye hendelsene:

${pairsDescription}

For hvert par, svar:
- pairIndex: tallet (1, 2, 3...)
- isSameEvent: true hvis de er samme hendelse med ulik formulering
- confidence: 0.0-1.0

Svar KUN med JSON-array:
[{"pairIndex": 1, "isSameEvent": true, "confidence": 0.95}, ...]`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://familjen.eu',
        'X-Title': 'Familjen Removal Verification',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    })

    if (!response.ok) {
      console.error('[CalendarSourceSync] LLM verification error:', response.status)
      // On error, assume all removals are real (conservative)
      return potentiallyRemovedEvents.map(event => ({
        removedEventId: event.id,
        matchedNewEventId: null,
        isActuallyRemoved: true,
        reason: 'Verifikasjon feilet',
      }))
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return potentiallyRemovedEvents.map(event => ({
        removedEventId: event.id,
        matchedNewEventId: null,
        isActuallyRemoved: true,
        reason: 'Ingen svar fra AI',
      }))
    }

    // Parse JSON
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    let llmResults: Array<{ pairIndex: number; isSameEvent: boolean; confidence: number }>
    try {
      llmResults = JSON.parse(jsonStr)
    } catch {
      return potentiallyRemovedEvents.map(event => ({
        removedEventId: event.id,
        matchedNewEventId: null,
        isActuallyRemoved: true,
        reason: 'Kunne ikke tolke AI-svar',
      }))
    }

    // Build result for each potentially removed event
    const matchedRemovedIds = new Map<string, string>() // removedId -> newEventId

    for (const llmResult of llmResults) {
      if (llmResult.isSameEvent && llmResult.confidence >= 0.8) {
        const pair = pairsToCheck[llmResult.pairIndex - 1]
        if (pair) {
          matchedRemovedIds.set(pair.removed.id, pair.newEvent.id)
        }
      }
    }

    return potentiallyRemovedEvents.map(event => {
      const matchedNewId = matchedRemovedIds.get(event.id)
      if (matchedNewId) {
        return {
          removedEventId: event.id,
          matchedNewEventId: matchedNewId,
          isActuallyRemoved: false,
          reason: 'Samme hendelse med ulik formulering',
        }
      }
      return {
        removedEventId: event.id,
        matchedNewEventId: null,
        isActuallyRemoved: true,
        reason: 'Hendelse fjernet fra kalenderkilde',
      }
    })
  } catch (error) {
    console.error('[CalendarSourceSync] LLM verification exception:', error)
    return potentiallyRemovedEvents.map(event => ({
      removedEventId: event.id,
      matchedNewEventId: null,
      isActuallyRemoved: true,
      reason: 'Verifikasjon feilet',
    }))
  }
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

  // Track newly created events for deduplication and removal verification
  const newEventIds: string[] = []
  const newlyCreatedEvents: Array<{ id: string; title: string; event_date: string; end_date: string | null }> = []

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
          'User-Agent': 'FamiljenBot/1.0 (https://familjen.eu)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      content = await response.text()
    }

    // 2. Extract events using AI
    const model = options.model || 'google/gemini-2.5-flash-lite'

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

        if (error) {
          console.error(`[CalendarSourceSync] Update error:`, error.message)
          if (!result.debug!.firstError) {
            result.debug!.firstError = `Update: ${error.message}`
          }
        } else {
          result.eventsUpdated++
        }
      } else {
        // Insert new event and capture the ID for deduplication
        const { data: insertedEvent, error } = await supabase
          .from('external_events')
          .insert(eventData)
          .select('id')
          .single()

        if (error) {
          console.error(`[CalendarSourceSync] Insert error:`, error.message)
          if (!result.debug!.firstError) {
            result.debug!.firstError = `Insert: ${error.message}`
          }
        } else if (insertedEvent) {
          result.eventsCreated++
          newEventIds.push(insertedEvent.id)
          newlyCreatedEvents.push({
            id: insertedEvent.id,
            title: eventData.title || event.title,  // Fallback to original if sanitization returned null
            event_date: eventData.event_date,
            end_date: eventData.end_date,
          })
        }
      }
    }

    // 5. Find potentially removed events (in DB but not in current extraction)
    const potentiallyRemovedEvents: ExternalEvent[] = []
    for (const [hash, event] of existingByHash) {
      if (!processedHashes.has(hash)) {
        // Only consider removal if event is in the future (don't notify about past events)
        const eventDate = new Date(event.event_date)
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        if (eventDate >= today) {
          potentiallyRemovedEvents.push(event)
        }
      }
    }

    // 5.5. Verify removals with LLM - this prevents false positives from AI extraction variation
    // (e.g., "Fri (Helligdag)" vs "Helligdag" are the same event, just extracted differently)
    let actuallyRemovedEvents: ExternalEvent[] = []

    if (potentiallyRemovedEvents.length > 0 && newlyCreatedEvents.length > 0) {
      // Use LLM to verify which events are actually removed vs just renamed
      const verificationResults = await verifyRemovalsWithLLM(
        potentiallyRemovedEvents,
        newlyCreatedEvents,
        model
      )

      // Process verification results
      for (const verification of verificationResults) {
        const event = potentiallyRemovedEvents.find(e => e.id === verification.removedEventId)
        if (!event) continue

        if (verification.isActuallyRemoved) {
          // Event is truly removed - add to list for notification
          actuallyRemovedEvents.push(event)
        } else {
          // Event is not actually removed - just extracted with different title
          // Delete the old event silently (the new event already exists with the new title)
          await supabase
            .from('external_events')
            .delete()
            .eq('id', event.id)

          console.log(`[CalendarSourceSync] Silently removed "${event.title}" - matched by new event`)
        }
      }
    } else {
      // No new events to compare with, or no potentially removed events
      // All potentially removed events are actually removed
      actuallyRemovedEvents = potentiallyRemovedEvents
    }

    // 6. Handle actually removed events - create notifications and delete
    for (const event of actuallyRemovedEvents) {
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

    // 8. Run deduplication on newly created events (non-blocking - don't fail sync if AI fails)
    if (newEventIds.length > 0) {
      try {
        const dedupeResult = await deduplicateEvents(supabase, source.household_id, newEventIds)
        result.duplicatesAutoMerged = dedupeResult.autoMerged
        result.duplicateSuggestionsCreated = dedupeResult.suggestionsCreated
      } catch (dedupeError) {
        // Log but don't fail the sync - events are already saved
        console.error('[CalendarSourceSync] Deduplication failed (non-blocking):', dedupeError)
      }
    }

    result.success = true
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
    const result = await syncCalendarSource(supabase, source as CalendarSource, options)
    results.push({
      id: source.id,
      name: source.display_name,
      result,
    })
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
