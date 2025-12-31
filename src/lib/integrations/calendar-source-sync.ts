/**
 * Calendar Source Sync
 *
 * Handles syncing external calendar sources (HTML pages, ICS feeds, PDFs)
 * with proper update/delete detection and removal notifications.
 *
 * Key insight: AI extraction is non-deterministic. The same event can be
 * extracted with slightly different titles between syncs. We use LLM-based
 * semantic matching for ALL event matching - not just removal verification.
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
    matchingMethod?: 'llm' | 'hash'
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
 * Used as fallback when LLM matching is unavailable.
 */
export function generateEventHash(
  sourceUrlId: string,
  date: string,
  title: string
): string {
  const normalizedTitle = title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\w*ferie\b/gi, 'ferie')
    .replace(/\w*fri\b/gi, 'fri')

  const input = `${sourceUrlId}:${date}:${normalizedTitle}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

interface EventMatch {
  extractedIndex: number
  existingId: string
  confidence: number
}

interface MatchingResult {
  matches: EventMatch[]
  unmatchedExtractedIndices: number[]
  unmatchedExistingIds: string[]
}

/**
 * Use LLM to semantically match extracted events to existing events.
 * This handles AI extraction variation like "Fri (Helligdag)" vs "Helligdag".
 */
async function matchEventsWithLLM(
  extractedEvents: ExtractedEvent[],
  existingEvents: ExternalEvent[],
  model: string
): Promise<MatchingResult> {
  const result: MatchingResult = {
    matches: [],
    unmatchedExtractedIndices: [],
    unmatchedExistingIds: [],
  }

  if (extractedEvents.length === 0) {
    result.unmatchedExistingIds = existingEvents.map(e => e.id)
    return result
  }

  if (existingEvents.length === 0) {
    result.unmatchedExtractedIndices = extractedEvents.map((_, i) => i)
    return result
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.warn('[CalendarSourceSync] No OPENROUTER_API_KEY, falling back to hash matching')
    return fallbackToHashMatching(extractedEvents, existingEvents)
  }

  // Build event descriptions for LLM
  const extractedDesc = extractedEvents.map((e, i) =>
    `E${i + 1}: "${e.title}" on ${e.date}${e.endDate ? ` to ${e.endDate}` : ''}${e.time ? ` at ${e.time}` : ''}`
  ).join('\n')

  const existingDesc = existingEvents.map((e, i) =>
    `D${i + 1}: "${e.title}" on ${e.event_date}${e.end_date ? ` to ${e.end_date}` : ''}${e.event_time ? ` at ${e.event_time}` : ''} [ID: ${e.id}]`
  ).join('\n')

  const systemPrompt = `Du er ekspert på å matche kalenderhendelser fra norske skoler og barnehager.

Oppgaven din er å finne hvilke nylig ekstraherte hendelser (E1, E2, ...) som matcher eksisterende hendelser i databasen (D1, D2, ...).

TO HENDELSER MATCHER HVIS:
- De er på samme dato (eller innenfor 1-2 dager hvis det er en feil)
- De beskriver samme ting, selv med ulik formulering:
  • "Fri (Helligdag)" = "Helligdag" = "Fridag"
  • "Påskeferie" = "Påske ferie" = "Ferie (påske)"
  • "Vinterferie" = "Ferie uke 8" = "Vinterferieuke"
  • "Planleggingsdag" = "Planl.dag" = "Kursdag for lærere"
  • "SFO stengt" = "Stengt SFO" = "Ingen SFO"
  • "Foreldremøte" = "Møte for foreldre"

VIKTIG:
- Hver ekstrahert hendelse kan kun matche ÉN eksisterende hendelse
- Hver eksisterende hendelse kan kun matches av ÉN ekstrahert hendelse
- Hvis du er usikker, ikke match (la den være umatched)`

  const userPrompt = `Match disse hendelsene:

NYLIG EKSTRAHERT FRA NETTSIDE:
${extractedDesc}

EKSISTERENDE I DATABASE:
${existingDesc}

Returner JSON med matches. For hver match, oppgi:
- extractedIndex: tallet fra E (1, 2, 3...)
- existingIndex: tallet fra D (1, 2, 3...)
- confidence: 0.0-1.0

Returner KUN JSON-array, ingen annen tekst:
[{"extractedIndex": 1, "existingIndex": 2, "confidence": 0.95}, ...]

Hvis ingen matcher, returner tom array: []`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://familjen.eu',
        'X-Title': 'Familjen Event Matching',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      console.error('[CalendarSourceSync] LLM matching error:', response.status)
      return fallbackToHashMatching(extractedEvents, existingEvents)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      console.error('[CalendarSourceSync] No content in LLM response')
      return fallbackToHashMatching(extractedEvents, existingEvents)
    }

    // Parse JSON
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    let llmMatches: Array<{ extractedIndex: number; existingIndex: number; confidence: number }>
    try {
      const parsed = JSON.parse(jsonStr)
      if (!Array.isArray(parsed)) {
        console.error('[CalendarSourceSync] LLM response is not an array')
        return fallbackToHashMatching(extractedEvents, existingEvents)
      }
      llmMatches = parsed
    } catch {
      console.error('[CalendarSourceSync] Failed to parse LLM response')
      return fallbackToHashMatching(extractedEvents, existingEvents)
    }

    // Process matches, ensuring 1:1 mapping
    const matchedExtractedIndices = new Set<number>()
    const matchedExistingIds = new Set<string>()

    // Sort by confidence descending to prioritize best matches
    llmMatches.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))

    for (const match of llmMatches) {
      const extractedIdx = match.extractedIndex - 1 // Convert to 0-indexed
      const existingIdx = match.existingIndex - 1

      // Validate indices
      if (extractedIdx < 0 || extractedIdx >= extractedEvents.length) continue
      if (existingIdx < 0 || existingIdx >= existingEvents.length) continue

      // Skip if already matched (1:1 constraint)
      if (matchedExtractedIndices.has(extractedIdx)) continue
      if (matchedExistingIds.has(existingEvents[existingIdx].id)) continue

      // Only accept high confidence matches
      if ((match.confidence || 0) >= 0.7) {
        result.matches.push({
          extractedIndex: extractedIdx,
          existingId: existingEvents[existingIdx].id,
          confidence: match.confidence,
        })
        matchedExtractedIndices.add(extractedIdx)
        matchedExistingIds.add(existingEvents[existingIdx].id)
      }
    }

    // Find unmatched
    for (let i = 0; i < extractedEvents.length; i++) {
      if (!matchedExtractedIndices.has(i)) {
        result.unmatchedExtractedIndices.push(i)
      }
    }

    for (const existing of existingEvents) {
      if (!matchedExistingIds.has(existing.id)) {
        result.unmatchedExistingIds.push(existing.id)
      }
    }

    console.log(`[CalendarSourceSync] LLM matching: ${result.matches.length} matches, ${result.unmatchedExtractedIndices.length} new, ${result.unmatchedExistingIds.length} potentially removed`)

    return result
  } catch (error) {
    console.error('[CalendarSourceSync] LLM matching exception:', error)
    return fallbackToHashMatching(extractedEvents, existingEvents)
  }
}

/**
 * Fallback to hash-based matching when LLM is unavailable.
 */
function fallbackToHashMatching(
  extractedEvents: ExtractedEvent[],
  existingEvents: ExternalEvent[]
): MatchingResult {
  const result: MatchingResult = {
    matches: [],
    unmatchedExtractedIndices: [],
    unmatchedExistingIds: [],
  }

  // Build hash map of existing events
  const existingByHash = new Map<string, ExternalEvent>()
  for (const event of existingEvents) {
    if (event.source_event_hash) {
      existingByHash.set(event.source_event_hash, event)
    }
  }

  const matchedExistingIds = new Set<string>()

  // Match extracted events by hash
  for (let i = 0; i < extractedEvents.length; i++) {
    const extracted = extractedEvents[i]
    // We need source_url_id for hash, but we don't have it here
    // Use a placeholder - this is why hash matching is inferior
    const hash = generateEventHash('temp', extracted.date, extracted.title)

    // Try to find by normalized title + date
    let found = false
    for (const existing of existingEvents) {
      if (matchedExistingIds.has(existing.id)) continue

      const existingHash = generateEventHash('temp', existing.event_date, existing.title)
      if (hash === existingHash) {
        result.matches.push({
          extractedIndex: i,
          existingId: existing.id,
          confidence: 1.0,
        })
        matchedExistingIds.add(existing.id)
        found = true
        break
      }
    }

    if (!found) {
      result.unmatchedExtractedIndices.push(i)
    }
  }

  // Find unmatched existing
  for (const existing of existingEvents) {
    if (!matchedExistingIds.has(existing.id)) {
      result.unmatchedExistingIds.push(existing.id)
    }
  }

  return result
}

/**
 * Sync a calendar source, handling updates and deletions properly.
 * Uses LLM-based semantic matching for robust event tracking.
 */
export async function syncCalendarSource(
  supabase: SupabaseClient,
  source: CalendarSource,
  options: {
    model?: string
    fetchContent?: () => Promise<string>
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

  const newEventIds: string[] = []

  try {
    // 1. Fetch content from source
    let content: string
    if (options.fetchContent) {
      content = await options.fetchContent()
    } else {
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

    // 3. Get ALL existing events for this source
    const { data: existingEvents } = await supabase
      .from('external_events')
      .select('id, source_url_id, source_event_hash, title, event_date, end_date, event_time, event_type, description, child_id, linked_task_id')
      .eq('source_url_id', source.id)

    const existingList = (existingEvents || []) as ExternalEvent[]

    // 4. Use LLM to match extracted events to existing events
    const matchingResult = await matchEventsWithLLM(extractedEvents, existingList, model)
    result.debug!.matchingMethod = process.env.OPENROUTER_API_KEY ? 'llm' : 'hash'

    // 5. Process matches - UPDATE existing events
    for (const match of matchingResult.matches) {
      const extracted = extractedEvents[match.extractedIndex]
      const hash = generateEventHash(source.id, extracted.date, extracted.title)

      const eventData = {
        source_event_hash: hash,
        title: truncate(sanitizeString(extracted.title), 200),
        event_date: extracted.date,
        end_date: extracted.endDate || null,
        event_time: sanitizeTime(extracted.time),
        event_type: extracted.eventType,
        description: truncate(sanitizeString(extracted.description), 2000),
        raw_data: { confidence: extracted.confidence, extracted_at: new Date().toISOString(), match_confidence: match.confidence },
      }

      const { error } = await supabase
        .from('external_events')
        .update(eventData)
        .eq('id', match.existingId)

      if (error) {
        console.error(`[CalendarSourceSync] Update error:`, error.message)
        if (!result.debug!.firstError) {
          result.debug!.firstError = `Update: ${error.message}`
        }
      } else {
        result.eventsUpdated++
      }
    }

    // 6. Process unmatched extracted events - INSERT as new
    for (const idx of matchingResult.unmatchedExtractedIndices) {
      const extracted = extractedEvents[idx]
      const hash = generateEventHash(source.id, extracted.date, extracted.title)

      const eventData = {
        source_url_id: source.id,
        source_event_hash: hash,
        external_id: `source_${source.id}_${hash}`,
        title: truncate(sanitizeString(extracted.title), 200),
        event_date: extracted.date,
        end_date: extracted.endDate || null,
        event_time: sanitizeTime(extracted.time),
        event_type: extracted.eventType,
        description: truncate(sanitizeString(extracted.description), 2000),
        child_id: source.child_id,
        raw_data: { confidence: extracted.confidence, extracted_at: new Date().toISOString() },
      }

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
      }
    }

    // 7. Process unmatched existing events - these are REMOVED
    // Only notify for future events
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (const existingId of matchingResult.unmatchedExistingIds) {
      const event = existingList.find(e => e.id === existingId)
      if (!event) continue

      const eventDate = new Date(event.event_date)
      if (eventDate < today) {
        // Past event - just delete silently
        await supabase.from('external_events').delete().eq('id', event.id)
        continue
      }

      // Future event - notify user and delete
      let linkedTask: LinkedTask | null = null
      if (event.linked_task_id) {
        const { data } = await supabase
          .from('child_tasks')
          .select('id, title, task_type')
          .eq('id', event.linked_task_id)
          .single()
        linkedTask = data as LinkedTask | null
      }

      let childNameForNotif: string | null = null
      if (event.child_id) {
        const { data: child } = await supabase
          .from('children')
          .select('name')
          .eq('id', event.child_id)
          .single()
        childNameForNotif = child?.name || null
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
          child_name: childNameForNotif,
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
        await supabase.from('child_tasks').delete().eq('id', linkedTask.id)
      }

      // Delete the event
      await supabase.from('external_events').delete().eq('id', event.id)
      result.eventsRemoved++
    }

    // 8. Update sync status
    await supabase
      .from('external_source_urls')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'ok',
        last_sync_error: null,
      })
      .eq('id', source.id)

    // 9. Run deduplication on newly created events
    if (newEventIds.length > 0) {
      try {
        const dedupeResult = await deduplicateEvents(supabase, source.household_id, newEventIds)
        result.duplicatesAutoMerged = dedupeResult.autoMerged
        result.duplicateSuggestionsCreated = dedupeResult.suggestionsCreated
      } catch (dedupeError) {
        console.error('[CalendarSourceSync] Deduplication failed (non-blocking):', dedupeError)
      }
    }

    result.success = true
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

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

  await supabase
    .from('external_events')
    .update({ linked_task_id: task.id })
    .eq('id', eventId)

  return { taskId: task.id }
}
