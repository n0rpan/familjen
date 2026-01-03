/**
 * Calendar Source Sync
 *
 * Handles syncing external calendar sources (HTML pages, ICS feeds, PDFs)
 * with proper update/delete detection and removal notifications.
 *
 * Key insights:
 * 1. AI extraction is non-deterministic - use LLM-based semantic matching
 * 2. Date/time changes are important - notify users when events move
 * 3. Extraction can have errors - validate with second LLM pass
 * 4. Notifications should be smart - explain what changed and why
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { extractEventsFromHtml } from './document-extraction'
import type { ExtractedEvent } from './document-extraction'
import { isUrlAllowed, truncate, sanitizeString, sanitizeTime } from '@/lib/sanitize'
import { deduplicateEvents } from './event-deduplication'
import { formatDateISO } from '@/lib/utils'

// Timeout for LLM API calls (30 seconds)
const LLM_TIMEOUT_MS = 30000

// Safety thresholds to prevent false deletions from extraction failures
// These mirror the thresholds in deletion-handler.ts for consistency
const MAX_DELETION_RATIO = 0.5 // Skip deletion if >50% of future events would be removed
const MAX_ABSOLUTE_DELETIONS = 10 // Skip deletion if >10 events would be removed

/**
 * Fetch with timeout to prevent hanging requests from blocking sync.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = LLM_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

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
  eventsChanged: number  // Events where date/time changed
  eventsRemoved: number
  notificationsCreated: number
  duplicatesAutoMerged: number
  duplicateSuggestionsCreated: number
  extractionIssues: string[]  // Issues found during validation
  error?: string
  debug?: {
    contentLength?: number
    model?: string
    firstError?: string
    matchingMethod?: 'llm' | 'hash'
    validationRan?: boolean
    deletionSkipped?: boolean
    wouldHaveDeleted?: number
    deletionRatio?: number
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
  dateChanged: boolean
  timeChanged: boolean
  oldDate?: string
  newDate?: string
  oldTime?: string | null
  newTime?: string | null
}

interface MatchingResult {
  matches: EventMatch[]
  unmatchedExtractedIndices: number[]
  unmatchedExistingIds: string[]
}

// ============================================================================
// IMPROVEMENT #1: Date/Time Change Detection
// ============================================================================

/**
 * Use LLM to semantically match extracted events to existing events.
 * Also detects if date/time changed for matched events.
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
    // SAFETY: If extraction returned no events, don't mark existing events for deletion.
    // This is likely an extraction failure, not actual removal of all events.
    console.warn(
      `[CalendarSourceSync] No events extracted - skipping deletion check to prevent false removals. ` +
      `${existingEvents.length} existing events preserved. Model: ${model}`
    )
    return result  // Return empty result - no matches, no unmatched
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
    `D${i + 1}: "${e.title}" on ${e.event_date}${e.end_date ? ` to ${e.end_date}` : ''}${e.event_time ? ` at ${e.event_time}` : ''}`
  ).join('\n')

  const systemPrompt = `Du er ekspert på å matche kalenderhendelser fra norske skoler og barnehager.

Oppgaven din er å finne hvilke nylig ekstraherte hendelser (E1, E2, ...) som matcher eksisterende hendelser i databasen (D1, D2, ...).

TO HENDELSER MATCHER HVIS de beskriver samme type hendelse, SELV OM DATOEN ER FORSKJELLIG:
- Samme type ferie/fridag kan ha blitt flyttet
- Planleggingsdager kan ha blitt flyttet
- Foreldremøter kan ha blitt flyttet til ny dato

Semantiske varianter som matcher:
• "Fri (Helligdag)" = "Helligdag" = "Fridag"
• "Påskeferie" = "Påske ferie" = "Ferie (påske)"
• "Vinterferie" = "Ferie uke 8" = "Vinterferieuke"
• "Planleggingsdag" = "Planl.dag" = "Kursdag for lærere"
• "SFO stengt" = "Stengt SFO" = "Ingen SFO"

VIKTIG:
- Hver ekstrahert hendelse kan kun matche ÉN eksisterende hendelse
- Hver eksisterende hendelse kan kun matches av ÉN ekstrahert hendelse
- Match hendelser selv om datoen endret seg (det er viktig å oppdage datoflytt)
- Hvis usikker, ikke match`

  const userPrompt = `Match disse hendelsene:

NYLIG EKSTRAHERT FRA NETTSIDE:
${extractedDesc}

EKSISTERENDE I DATABASE:
${existingDesc}

For hver match, oppgi:
- extractedIndex: E-tallet (1, 2, 3...)
- existingIndex: D-tallet (1, 2, 3...)
- confidence: 0.0-1.0
- dateChanged: true hvis datoen er forskjellig
- timeChanged: true hvis klokkeslettet er forskjellig

Returner KUN JSON-array:
[{"extractedIndex": 1, "existingIndex": 2, "confidence": 0.95, "dateChanged": false, "timeChanged": false}, ...]

Hvis ingen matcher, returner: []`

  try {
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
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

    let llmMatches: Array<{
      extractedIndex: number
      existingIndex: number
      confidence: number
      dateChanged?: boolean
      timeChanged?: boolean
    }>
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

    // Sort by confidence descending
    llmMatches.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))

    for (const match of llmMatches) {
      const extractedIdx = match.extractedIndex - 1
      const existingIdx = match.existingIndex - 1

      if (extractedIdx < 0 || extractedIdx >= extractedEvents.length) continue
      if (existingIdx < 0 || existingIdx >= existingEvents.length) continue
      if (matchedExtractedIndices.has(extractedIdx)) continue
      if (matchedExistingIds.has(existingEvents[existingIdx].id)) continue

      if ((match.confidence || 0) >= 0.7) {
        const extracted = extractedEvents[extractedIdx]
        const existing = existingEvents[existingIdx]

        // Detect actual changes by comparing values
        const dateChanged = match.dateChanged || extracted.date !== existing.event_date
        // Normalize both times to null for comparison (undefined/empty string → null)
        const extractedTime = extracted.time || null
        const existingTime = existing.event_time || null
        const timeChanged = match.timeChanged || extractedTime !== existingTime

        result.matches.push({
          extractedIndex: extractedIdx,
          existingId: existing.id,
          confidence: match.confidence,
          dateChanged,
          timeChanged,
          oldDate: existing.event_date,
          newDate: extracted.date,
          oldTime: existing.event_time,
          newTime: extracted.time || null,
        })
        matchedExtractedIndices.add(extractedIdx)
        matchedExistingIds.add(existing.id)
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

    const changedCount = result.matches.filter(m => m.dateChanged || m.timeChanged).length
    console.log(`[CalendarSourceSync] LLM matching: ${result.matches.length} matches (${changedCount} changed), ${result.unmatchedExtractedIndices.length} new, ${result.unmatchedExistingIds.length} potentially removed`)

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

  const matchedExistingIds = new Set<string>()

  for (let i = 0; i < extractedEvents.length; i++) {
    const extracted = extractedEvents[i]
    const hash = generateEventHash('temp', extracted.date, extracted.title)

    let found = false
    for (const existing of existingEvents) {
      if (matchedExistingIds.has(existing.id)) continue

      const existingHash = generateEventHash('temp', existing.event_date, existing.title)
      if (hash === existingHash) {
        result.matches.push({
          extractedIndex: i,
          existingId: existing.id,
          confidence: 1.0,
          dateChanged: false,
          timeChanged: false,
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

  for (const existing of existingEvents) {
    if (!matchedExistingIds.has(existing.id)) {
      result.unmatchedExistingIds.push(existing.id)
    }
  }

  return result
}

// ============================================================================
// IMPROVEMENT #2: Extraction Quality Validation
// ============================================================================

interface ValidationResult {
  isValid: boolean
  issues: string[]
  correctedEvents?: ExtractedEvent[]
}

/**
 * Validate extracted events using LLM to catch obvious errors.
 */
async function validateExtractedEvents(
  events: ExtractedEvent[],
  context: { schoolName: string; childName?: string },
  model: string
): Promise<ValidationResult> {
  if (events.length === 0) {
    return { isValid: true, issues: [] }
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return { isValid: true, issues: [] }
  }

  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  const schoolYearStart = currentMonth >= 7 ? currentYear : currentYear - 1
  const schoolYearEnd = schoolYearStart + 1

  const eventsDesc = events.map((e, i) =>
    `${i + 1}. "${e.title}" on ${e.date}${e.endDate ? ` to ${e.endDate}` : ''} (type: ${e.eventType}, confidence: ${e.confidence})`
  ).join('\n')

  const systemPrompt = `Du er ekspert på norske skolekalendere. Valider disse ekstraherte hendelsene og finn åpenbare feil.`

  const userPrompt = `Skole/barnehage: ${context.schoolName}
Skoleår: ${schoolYearStart}-${schoolYearEnd}
Dagens dato: ${formatDateISO(now)}

Ekstraherte hendelser:
${eventsDesc}

Sjekk for:
1. FEIL ÅRSTALL: Vinterferie i juli, påskeferie i september, etc.
2. DUPLIKATER: Samme hendelse listet flere ganger
3. UMULIGE DATOER: 30. februar, 31. april, etc.
4. FEIL TYPE: "Foreldremøte" markert som "holiday"
5. USANNSYNLIGE HENDELSER: Ferie midt i skoleåret uten grunn

Returner JSON:
{
  "isValid": true/false,
  "issues": ["Beskrivelse av problem 1", "Problem 2", ...],
  "corrections": [
    {"index": 1, "field": "date", "oldValue": "2025-07-15", "newValue": "2026-02-15", "reason": "Vinterferie er i februar"}
  ]
}

Hvis alt ser bra ut: {"isValid": true, "issues": [], "corrections": []}`

  try {
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://familjen.eu',
        'X-Title': 'Familjen Extraction Validation',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1500,
      }),
    })

    if (!response.ok) {
      console.error('[CalendarSourceSync] Validation LLM error:', response.status)
      return { isValid: true, issues: [] }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return { isValid: true, issues: [] }
    }

    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const validation = JSON.parse(jsonStr) as {
      isValid: boolean
      issues: string[]
      corrections?: Array<{ index: number; field: string; oldValue: string; newValue: string; reason: string }>
    }

    // Apply corrections if any
    let correctedEvents: ExtractedEvent[] | undefined
    if (validation.corrections && validation.corrections.length > 0) {
      correctedEvents = [...events]
      for (const correction of validation.corrections) {
        const idx = correction.index - 1
        if (idx >= 0 && idx < correctedEvents.length) {
          const event = { ...correctedEvents[idx] }
          if (correction.field === 'date' && correction.newValue) {
            event.date = correction.newValue
          } else if (correction.field === 'endDate' && correction.newValue) {
            event.endDate = correction.newValue
          } else if (correction.field === 'eventType' && correction.newValue) {
            event.eventType = correction.newValue as ExtractedEvent['eventType']
          }
          correctedEvents[idx] = event
          console.log(`[CalendarSourceSync] Corrected event ${idx + 1}: ${correction.field} "${correction.oldValue}" → "${correction.newValue}" (${correction.reason})`)
        }
      }
    }

    return {
      isValid: validation.isValid,
      issues: validation.issues || [],
      correctedEvents,
    }
  } catch (error) {
    console.error('[CalendarSourceSync] Validation exception:', error)
    return { isValid: true, issues: [] }
  }
}

// ============================================================================
// IMPROVEMENT #3: Smart Change Notifications
// ============================================================================

interface SmartNotification {
  changeType: 'removed' | 'changed' | 'moved'
  title: string
  explanation: string
  suggestedAction?: string
  oldDate?: string
  newDate?: string
  oldTime?: string | null
  newTime?: string | null
}

/**
 * Generate smart notification with context about what changed.
 */
async function generateSmartNotification(
  event: ExternalEvent,
  allExtractedEvents: ExtractedEvent[],
  changeType: 'removed' | 'changed',
  changeDetails: { newDate?: string; newTime?: string | null } | null,
  sourceName: string,
  model: string
): Promise<SmartNotification> {
  const apiKey = process.env.OPENROUTER_API_KEY

  // Default notification if no API key
  if (!apiKey) {
    if (changeType === 'changed' && changeDetails) {
      return {
        changeType: 'moved',
        title: event.title,
        explanation: `Hendelsen ble flyttet fra ${event.event_date} til ${changeDetails.newDate}`,
        oldDate: event.event_date,
        newDate: changeDetails.newDate,
        oldTime: event.event_time,
        newTime: changeDetails.newTime,
      }
    }
    return {
      changeType: 'removed',
      title: event.title,
      explanation: 'Hendelsen ble fjernet fra kalenderen',
    }
  }

  // For changed events, return a simpler notification
  if (changeType === 'changed' && changeDetails) {
    const timeInfo = changeDetails.newTime !== event.event_time
      ? ` Tidspunkt endret fra ${event.event_time || 'hele dagen'} til ${changeDetails.newTime || 'hele dagen'}.`
      : ''

    return {
      changeType: 'moved',
      title: event.title,
      explanation: `Hendelsen ble flyttet fra ${event.event_date} til ${changeDetails.newDate}.${timeInfo}`,
      suggestedAction: 'Oppdater kalenderen din med ny dato.',
      oldDate: event.event_date,
      newDate: changeDetails.newDate,
      oldTime: event.event_time,
      newTime: changeDetails.newTime,
    }
  }

  // For removed events, use LLM to provide context
  const extractedDesc = allExtractedEvents.slice(0, 20).map(e =>
    `"${e.title}" on ${e.date}`
  ).join(', ')

  const systemPrompt = `Du er en hjelpsom assistent for norske familier som bruker en kalenderapp.`

  const userPrompt = `En hendelse ble fjernet fra skolekalenderen "${sourceName}":
- Tittel: "${event.title}"
- Dato: ${event.event_date}
- Type: ${event.event_type || 'ukjent'}

Andre hendelser i kalenderen nå: ${extractedDesc || 'ingen'}

Gi en kort, vennlig forklaring på norsk (maks 2 setninger) om hva som kan ha skjedd og hva forelderen bør gjøre.

Returner JSON:
{
  "explanation": "Kort forklaring",
  "suggestedAction": "Hva forelderen bør gjøre",
  "possibleReason": "moved_date" | "cancelled" | "error" | "unknown"
}`

  try {
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://familjen.eu',
        'X-Title': 'Familjen Smart Notification',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    })

    if (!response.ok) {
      return {
        changeType: 'removed',
        title: event.title,
        explanation: 'Hendelsen ble fjernet fra kalenderen.',
      }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return {
        changeType: 'removed',
        title: event.title,
        explanation: 'Hendelsen ble fjernet fra kalenderen.',
      }
    }

    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const result = JSON.parse(jsonStr) as {
      explanation: string
      suggestedAction?: string
      possibleReason?: string
    }

    return {
      changeType: result.possibleReason === 'moved_date' ? 'moved' : 'removed',
      title: event.title,
      explanation: result.explanation,
      suggestedAction: result.suggestedAction,
    }
  } catch (error) {
    console.error('[CalendarSourceSync] Smart notification exception:', error)
    return {
      changeType: 'removed',
      title: event.title,
      explanation: 'Hendelsen ble fjernet fra kalenderen.',
    }
  }
}

// ============================================================================
// MAIN SYNC FUNCTION
// ============================================================================

/**
 * Sync a calendar source with full LLM-powered intelligence:
 * 1. Extract events from HTML
 * 2. Validate extraction quality
 * 3. Match to existing events (detect date/time changes)
 * 4. Generate smart notifications for changes
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
    eventsChanged: 0,
    eventsRemoved: 0,
    notificationsCreated: 0,
    duplicatesAutoMerged: 0,
    duplicateSuggestionsCreated: 0,
    extractionIssues: [],
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
    // Model must be passed in options - caller fetches from app_settings.openrouter_vision_model
    if (!options.model) {
      throw new Error('No AI model configured. Pass model in options (from app_settings).')
    }
    const model = options.model

    let childName: string | undefined
    if (source.child_id) {
      const { data: child } = await supabase
        .from('children')
        .select('name')
        .eq('id', source.child_id)
        .single()
      childName = child?.name
    }

    let extractedEvents = await extractEventsFromHtml(content, {
      childName,
      schoolName: source.display_name,
      model,
    })

    result.eventsFound = extractedEvents.length
    result.debug = {
      contentLength: content.length,
      model,
      validationRan: false,
    }

    // 3. IMPROVEMENT #2: Validate extraction quality
    const validation = await validateExtractedEvents(
      extractedEvents,
      { schoolName: source.display_name, childName },
      model
    )
    result.debug.validationRan = true
    result.extractionIssues = validation.issues

    if (validation.correctedEvents) {
      console.log(`[CalendarSourceSync] Applied ${validation.issues.length} corrections to extracted events`)
      extractedEvents = validation.correctedEvents
    }

    // 4. Get ALL existing events for this source
    const { data: existingEvents } = await supabase
      .from('external_events')
      .select('id, source_url_id, source_event_hash, title, event_date, end_date, event_time, event_type, description, child_id, linked_task_id')
      .eq('source_url_id', source.id)

    const existingList = (existingEvents || []) as ExternalEvent[]

    // 5. IMPROVEMENT #1: Match with date/time change detection
    const matchingResult = await matchEventsWithLLM(extractedEvents, existingList, model)
    result.debug!.matchingMethod = process.env.OPENROUTER_API_KEY ? 'llm' : 'hash'

    // 6. Process matches - UPDATE existing events, notify on changes
    for (const match of matchingResult.matches) {
      const extracted = extractedEvents[match.extractedIndex]
      const existing = existingList.find(e => e.id === match.existingId)!
      const hash = generateEventHash(source.id, extracted.date, extracted.title)

      const eventData = {
        source_event_hash: hash,
        title: truncate(sanitizeString(extracted.title), 200) || extracted.title,
        event_date: extracted.date,
        end_date: extracted.endDate || null,
        event_time: sanitizeTime(extracted.time),
        event_type: extracted.eventType,
        description: truncate(sanitizeString(extracted.description), 2000),
        raw_data: {
          confidence: extracted.confidence,
          extracted_at: new Date().toISOString(),
          match_confidence: match.confidence,
          previous_date: match.dateChanged ? match.oldDate : undefined,
          previous_time: match.timeChanged ? match.oldTime : undefined,
        },
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
        // IMPROVEMENT #1 & #3: Notify on date/time changes
        if (match.dateChanged || match.timeChanged) {
          result.eventsChanged++

          // Get child name for notification
          let childNameForNotif: string | null = null
          if (existing.child_id) {
            const { data: child } = await supabase
              .from('children')
              .select('name')
              .eq('id', existing.child_id)
              .single()
            childNameForNotif = child?.name || null
          }

          // Generate smart notification
          const smartNotif = await generateSmartNotification(
            existing,
            extractedEvents,
            'changed',
            { newDate: match.newDate, newTime: match.newTime },
            source.display_name,
            model
          )

          // Create change notification
          await supabase
            .from('event_change_notifications')
            .insert({
              household_id: source.household_id,
              change_type: 'changed',
              source_url_id: source.id,
              source_name: source.display_name,
              original_title: existing.title,
              original_date: match.oldDate,
              original_end_date: existing.end_date,
              original_time: match.oldTime,
              new_title: extracted.title,
              new_date: match.newDate,
              new_time: match.newTime,
              child_id: existing.child_id,
              child_name: childNameForNotif,
              explanation: smartNotif.explanation,
              suggested_action: smartNotif.suggestedAction,
              status: 'unread',
            })

          result.notificationsCreated++
        } else {
          result.eventsUpdated++
        }
      }
    }

    // 7. Process unmatched extracted events - INSERT as new
    for (const idx of matchingResult.unmatchedExtractedIndices) {
      const extracted = extractedEvents[idx]
      const hash = generateEventHash(source.id, extracted.date, extracted.title)

      const eventData = {
        source_url_id: source.id,
        source_event_hash: hash,
        external_id: `source_${source.id}_${hash}`,
        title: truncate(sanitizeString(extracted.title), 200) || extracted.title,
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

    // 8. Process unmatched existing events - REMOVED
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Count future events (both total and unmatched) for safety check
    const futureExistingEvents = existingList.filter(e => {
      const eventDate = new Date(e.event_date)
      return eventDate >= today
    })
    const futureUnmatchedIds = matchingResult.unmatchedExistingIds.filter(id => {
      const event = existingList.find(e => e.id === id)
      if (!event) return false
      const eventDate = new Date(event.event_date)
      return eventDate >= today
    })

    // SAFETY CHECK: Prevent mass deletions from extraction failures
    // This mirrors the safety thresholds in deletion-handler.ts
    const totalFutureExisting = futureExistingEvents.length
    const wouldDelete = futureUnmatchedIds.length

    if (wouldDelete > 0 && totalFutureExisting > 0) {
      const deletionRatio = wouldDelete / totalFutureExisting

      if (deletionRatio > MAX_DELETION_RATIO || wouldDelete > MAX_ABSOLUTE_DELETIONS) {
        console.warn(
          `[CalendarSourceSync] SAFETY: Skipping deletion for ${source.display_name}: ` +
          `${wouldDelete}/${totalFutureExisting} future events would be deleted (${(deletionRatio * 100).toFixed(0)}%). ` +
          `This looks like an extraction error. Extracted ${result.eventsFound} events this run.`
        )
        // Skip deletion entirely - don't remove any events
        // Update sync status to indicate partial success
        await supabase
          .from('external_source_urls')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: 'partial',
            last_sync_error: `Skipped deletion: ${wouldDelete} events would be removed (safety check)`,
          })
          .eq('id', source.id)

        // Still return success but note the skipped deletions
        result.success = true
        result.debug = {
          ...result.debug,
          deletionSkipped: true,
          wouldHaveDeleted: wouldDelete,
          deletionRatio: deletionRatio,
        }
        return result
      }
    }

    for (const existingId of matchingResult.unmatchedExistingIds) {
      const event = existingList.find(e => e.id === existingId)
      if (!event) continue

      const eventDate = new Date(event.event_date)
      if (eventDate < today) {
        // Past event - delete silently
        await supabase.from('external_events').delete().eq('id', event.id)
        continue
      }

      // Future event - generate smart notification
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

      // IMPROVEMENT #3: Generate smart notification
      const smartNotif = await generateSmartNotification(
        event,
        extractedEvents,
        'removed',
        null,
        source.display_name,
        model
      )

      // Create removal notification with context
      const { error: notifError } = await supabase
        .from('event_change_notifications')
        .insert({
          household_id: source.household_id,
          change_type: smartNotif.changeType,
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
          explanation: smartNotif.explanation,
          suggested_action: smartNotif.suggestedAction,
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

    // 9. Update sync status
    await supabase
      .from('external_source_urls')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'ok',
        last_sync_error: null,
      })
      .eq('id', source.id)

    // 10. Run deduplication on newly created events
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
