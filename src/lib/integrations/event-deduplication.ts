/**
 * Event Deduplication Service
 *
 * Detects and handles duplicate events across different sources using AI.
 * - High confidence (>0.9): Auto-merge (hide duplicate, keep one)
 * - Medium confidence (0.6-0.9): Create suggestion for user review
 * - Low confidence (<0.6): No action
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { formatDateISO } from '@/lib/utils'
import { getModel } from '@/lib/ai-models'

// Confidence thresholds
// 0.95 is more conservative for auto-merge to avoid merging unrelated events
const HIGH_CONFIDENCE_THRESHOLD = 0.95
const MEDIUM_CONFIDENCE_THRESHOLD = 0.6

/**
 * Combine results from two queries, deduplicating by ID.
 */
function combineAndDeduplicateEvents(events1: ExternalEvent[], events2: ExternalEvent[]): ExternalEvent[] {
  const seenIds = new Set<string>()
  const results: ExternalEvent[] = []

  for (const event of events1) {
    if (!seenIds.has(event.id)) {
      seenIds.add(event.id)
      results.push(event)
    }
  }

  for (const event of events2) {
    if (!seenIds.has(event.id)) {
      seenIds.add(event.id)
      results.push(event)
    }
  }

  return results
}

interface ExternalEvent {
  id: string
  title: string
  event_date: string
  end_date: string | null
  event_time: string | null
  event_type: string | null
  source_url_id: string | null
  integration_id: string | null
  child_id: string | null
  duplicate_of_id: string | null
  is_hidden: boolean
}

interface DuplicateCandidate {
  eventA: ExternalEvent
  eventB: ExternalEvent
  confidence: number
  matchReason: string
}

interface LLMDuplicateResult {
  eventAId: string
  eventBId: string
  isDuplicate: boolean
  confidence: number
  reason: string
}

export interface DeduplicationResult {
  autoMerged: number
  suggestionsCreated: number
  errors: string[]
  pairsChecked?: number
}

/**
 * Use LLM to evaluate if event pairs are duplicates.
 * Batches multiple pairs in one request for efficiency.
 */
async function evaluateDuplicatesWithLLM(
  pairs: Array<{ eventA: ExternalEvent; eventB: ExternalEvent }>,
  model: string
): Promise<LLMDuplicateResult[]> {
  if (pairs.length === 0) return []

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('[Deduplication] OPENROUTER_API_KEY not set')
    return []
  }

  // Sanitize event data to prevent prompt injection
  const sanitize = (s: string | null | undefined) =>
    s ? s.replace(/["\n\r]/g, ' ').trim().slice(0, 200) : ''

  // Build the prompt with all event pairs
  const pairsDescription = pairs.map((pair, index) => {
    const eventA = pair.eventA
    const eventB = pair.eventB
    return `Pair ${index + 1}:
  Event A (ID: ${eventA.id}):
    - Title: "${sanitize(eventA.title)}"
    - Date: ${eventA.event_date}${eventA.end_date ? ` to ${eventA.end_date}` : ''}
    - Time: ${eventA.event_time || 'All day'}
    - Type: ${eventA.event_type || 'Unknown'}

  Event B (ID: ${eventB.id}):
    - Title: "${sanitize(eventB.title)}"
    - Date: ${eventB.event_date}${eventB.end_date ? ` to ${eventB.end_date}` : ''}
    - Time: ${eventB.event_time || 'All day'}
    - Type: ${eventB.event_type || 'Unknown'}`
  }).join('\n\n')

  const systemPrompt = `You are an expert at identifying duplicate calendar events from Norwegian family calendars.

These events come from different sources (schools, kindergartens, sports clubs, etc.) and often describe the same event with slightly different wording.

CRITICAL - WATCH FOR CONTRADICTIONS (these are NOT duplicates):
- "SFO åpent i høstferien" (SFO OPEN) vs "Høstferie" (holiday/closed) = DIFFERENT! One says OPEN, the other implies CLOSED
- "åpent" (open) vs "stengt" (closed) = OPPOSITE meanings, never duplicates
- "Fri" (day off) vs "åpent" (open) = CONTRADICTIONS
- "SFO stengt" vs "Stengt barnehage" = Same meaning (both closed), likely duplicates
- If one event says something is AVAILABLE/OPEN and another implies CLOSED/HOLIDAY, they are NOT duplicates!

Common VALID duplicate patterns:
- "Vinterferie" and "Ferie uke 8" = same (winter break, both imply closed)
- "Planleggingsdag" and "Planl.dag" = same (teacher planning day)
- "Høstferie" and "Høstferie uke 40" = same (fall break)
- "Stengt" and "Fri" and "Ferie" = similar (all mean closed/off)
- "SFO stengt" and "Stengt barnehage" = same if same date (both mean closed)
- "Juleferie" and "Skolefri" = similar (both mean school closed for Christmas)
- "Karneval" from two sources on same date = same event

Consider:
- SEMANTIC MEANING first - understand what the event actually says
- "åpent" (open) is the OPPOSITE of "stengt/ferie/fri" (closed)
- Events must be on the same day or adjacent days to be duplicates
- Norwegian abbreviations: "Planl." = "Planlegging", "bhg" = "barnehage"

Respond with a JSON array of evaluations.`

  const userPrompt = `Evaluate these event pairs and determine if they are duplicates.

${pairsDescription}

REMEMBER:
- If one says "åpent" (open) and the other implies "stengt/ferie/fri" (closed) → NOT duplicates!
- "SFO åpent i høstferien" is NOT the same as "Høstferie" - one says OPEN, one implies CLOSED
- "Juleferie" and "Skolefri" ARE similar (both mean school closed)
- Focus on MEANING, not just word overlap

For each pair, respond with:
- isDuplicate: true/false
- confidence: 0.0-1.0 (how confident you are)
- reason: Brief explanation IN NORWEGIAN for the user (e.g. "Samme arrangement, ulik kilde")

IMPORTANT: The "reason" field MUST be in Norwegian as this is shown directly to Norwegian users.

Respond ONLY with a JSON array like:
[
  {"eventAId": "...", "eventBId": "...", "isDuplicate": true, "confidence": 0.95, "reason": "Samme vinterferie, ulik formulering"},
  {"eventAId": "...", "eventBId": "...", "isDuplicate": false, "confidence": 0.9, "reason": "Motsetninger: en sier åpent, den andre betyr stengt"},
  ...
]`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://familjen.eu',
        'X-Title': 'Familjen Event Deduplication',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1, // Low temperature for consistent results
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      console.error('[Deduplication] LLM API error:', response.status, await response.text())
      return []
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      console.error('[Deduplication] No content in LLM response')
      return []
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    let results: LLMDuplicateResult[]
    try {
      results = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error('[Deduplication] Failed to parse LLM response as JSON:', parseError)
      return []
    }

    if (!Array.isArray(results)) {
      console.error('[Deduplication] LLM response is not an array')
      return []
    }

    // Validate and map results
    return results.map((r) => ({
      eventAId: r.eventAId,
      eventBId: r.eventBId,
      isDuplicate: Boolean(r.isDuplicate),
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
      reason: String(r.reason || ''),
    }))
  } catch (error) {
    console.error('[Deduplication] Error calling LLM:', error)
    return []
  }
}

/**
 * Find potential duplicate events for new events across all sources.
 * Uses date proximity as a cheap pre-filter before LLM evaluation.
 */
async function findPotentialDuplicates(
  supabase: SupabaseClient,
  newEvents: ExternalEvent[],
  householdId: string,
  model: string
): Promise<DuplicateCandidate[]> {
  if (newEvents.length === 0) return []

  // Get all source IDs for this household
  const [sourceUrlsResult, integrationsResult] = await Promise.all([
    supabase.from('external_source_urls').select('id').eq('household_id', householdId),
    supabase.from('external_integrations').select('id').eq('household_id', householdId),
  ])

  const sourceUrlIds = sourceUrlsResult.data?.map((s) => s.id) || []
  const integrationIds = integrationsResult.data?.map((i) => i.id) || []

  if (sourceUrlIds.length === 0 && integrationIds.length === 0) {
    return []
  }

  // Find date range to search (covers all new events ±3 days)
  const dates = newEvents.map((e) => new Date(e.event_date))
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())))
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())))
  minDate.setDate(minDate.getDate() - 3)
  maxDate.setDate(maxDate.getDate() + 3)

  const minDateStr = formatDateISO(minDate)
  const maxDateStr = formatDateISO(maxDate)

  const eventSelectFields = 'id, title, event_date, end_date, event_time, event_type, source_url_id, integration_id, child_id, duplicate_of_id, is_hidden'

  // Query using safe parameterized .in() instead of .or() string interpolation
  // Make separate queries and combine results to avoid SQL injection
  const [sourceUrlEventsResult, integrationEventsResult] = await Promise.all([
    sourceUrlIds.length > 0
      ? supabase
          .from('external_events')
          .select(eventSelectFields)
          .in('source_url_id', sourceUrlIds)
          .gte('event_date', minDateStr)
          .lte('event_date', maxDateStr)
          .is('duplicate_of_id', null)
          .eq('is_hidden', false)
      : Promise.resolve({ data: [], error: null }),
    integrationIds.length > 0
      ? supabase
          .from('external_events')
          .select(eventSelectFields)
          .in('integration_id', integrationIds)
          .gte('event_date', minDateStr)
          .lte('event_date', maxDateStr)
          .is('duplicate_of_id', null)
          .eq('is_hidden', false)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (sourceUrlEventsResult.error) {
    console.error('[Deduplication] Error querying by source_url_id:', sourceUrlEventsResult.error)
  }
  if (integrationEventsResult.error) {
    console.error('[Deduplication] Error querying by integration_id:', integrationEventsResult.error)
  }

  const allEvents = combineAndDeduplicateEvents(
    (sourceUrlEventsResult.data || []) as ExternalEvent[],
    (integrationEventsResult.data || []) as ExternalEvent[]
  )

  if (allEvents.length === 0) {
    return []
  }

  // Build pairs to check: new events vs existing events from OTHER sources
  const newEventIds = new Set(newEvents.map((e) => e.id))
  const existingEvents = allEvents.filter((e) => !newEventIds.has(e.id)) as ExternalEvent[]

  const pairsToCheck: Array<{ eventA: ExternalEvent; eventB: ExternalEvent }> = []

  for (const newEvent of newEvents) {
    for (const existingEvent of existingEvents) {
      // Skip if from same source
      if (newEvent.source_url_id && newEvent.source_url_id === existingEvent.source_url_id) continue
      if (newEvent.integration_id && newEvent.integration_id === existingEvent.integration_id) continue

      // Check date proximity (±1 day to be more conservative)
      const daysDiff = Math.abs(
        (new Date(newEvent.event_date).getTime() - new Date(existingEvent.event_date).getTime()) /
          (1000 * 60 * 60 * 24)
      )
      if (daysDiff > 1) continue

      pairsToCheck.push({ eventA: newEvent, eventB: existingEvent })
    }
  }

  if (pairsToCheck.length === 0) {
    return []
  }

  // Batch pairs for LLM (max 10 per request to avoid token limits)
  const batchSize = 10
  const allResults: LLMDuplicateResult[] = []

  for (let i = 0; i < pairsToCheck.length; i += batchSize) {
    const batch = pairsToCheck.slice(i, i + batchSize)
    const results = await evaluateDuplicatesWithLLM(batch, model)
    allResults.push(...results)
  }

  // Convert LLM results to DuplicateCandidate format
  const candidates: DuplicateCandidate[] = []
  const pairsMap = new Map(
    pairsToCheck.map((p) => [`${p.eventA.id}:${p.eventB.id}`, p])
  )

  for (const result of allResults) {
    if (!result.isDuplicate || result.confidence < MEDIUM_CONFIDENCE_THRESHOLD) {
      continue
    }

    // Find the original pair (could be A:B or B:A)
    const pair = pairsMap.get(`${result.eventAId}:${result.eventBId}`) ||
                 pairsMap.get(`${result.eventBId}:${result.eventAId}`)

    if (pair) {
      candidates.push({
        eventA: pair.eventA,
        eventB: pair.eventB,
        confidence: result.confidence,
        matchReason: result.reason,
      })
    }
  }

  return candidates
}

/**
 * Get the AI model to use for deduplication from app settings.
 */
async function getDeduplicationModel(supabase: SupabaseClient): Promise<string> {
  return getModel(supabase, 'text')
}

/**
 * Check for and handle duplicates after syncing events.
 * Should be called after adding new events from a source.
 */
export async function deduplicateEvents(
  supabase: SupabaseClient,
  householdId: string,
  newEventIds: string[]
): Promise<DeduplicationResult> {
  const result: DeduplicationResult = {
    autoMerged: 0,
    suggestionsCreated: 0,
    errors: [],
  }

  if (newEventIds.length === 0) {
    return result
  }

  // Get AI model from settings
  const model = await getDeduplicationModel(supabase)

  // Get the new events
  const { data: newEvents, error: fetchError } = await supabase
    .from('external_events')
    .select(
      'id, title, event_date, end_date, event_time, event_type, source_url_id, integration_id, child_id, duplicate_of_id, is_hidden'
    )
    .in('id', newEventIds)

  if (fetchError || !newEvents) {
    result.errors.push(`Failed to fetch new events: ${fetchError?.message}`)
    return result
  }

  // Find duplicates using LLM
  const candidates = await findPotentialDuplicates(
    supabase,
    newEvents as ExternalEvent[],
    householdId,
    model
  )

  // Track which pairs we've already processed
  const processedPairs = new Set<string>()

  for (const candidate of candidates) {
    // Normalize pair key (smaller ID first)
    const pairKey =
      candidate.eventA.id < candidate.eventB.id
        ? `${candidate.eventA.id}:${candidate.eventB.id}`
        : `${candidate.eventB.id}:${candidate.eventA.id}`

    if (processedPairs.has(pairKey)) continue
    processedPairs.add(pairKey)

    if (candidate.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      // Auto-merge: Hide the newer event (the one just synced)
      const keepEvent =
        candidate.eventA.id < candidate.eventB.id ? candidate.eventA : candidate.eventB
      const hideEvent =
        candidate.eventA.id < candidate.eventB.id ? candidate.eventB : candidate.eventA

      const { error: mergeError } = await supabase
        .from('external_events')
        .update({
          duplicate_of_id: keepEvent.id,
          is_hidden: true,
          duplicate_confidence: candidate.confidence,
        })
        .eq('id', hideEvent.id)

      if (mergeError) {
        result.errors.push(`Failed to merge duplicate ${hideEvent.id}: ${mergeError.message}`)
      } else {
        result.autoMerged++
      }
    } else {
      // Medium confidence: Create suggestion for user review
      const eventAId =
        candidate.eventA.id < candidate.eventB.id ? candidate.eventA.id : candidate.eventB.id
      const eventBId =
        candidate.eventA.id < candidate.eventB.id ? candidate.eventB.id : candidate.eventA.id

      // Check if suggestion already exists
      const { data: existing } = await supabase
        .from('event_duplicate_suggestions')
        .select('id')
        .eq('event_a_id', eventAId)
        .eq('event_b_id', eventBId)
        .eq('status', 'pending')
        .single()

      if (!existing) {
        const { error: suggestionError } = await supabase
          .from('event_duplicate_suggestions')
          .insert({
            household_id: householdId,
            event_a_id: eventAId,
            event_b_id: eventBId,
            confidence: candidate.confidence,
            match_reason: candidate.matchReason,
          })

        if (suggestionError) {
          if (!suggestionError.message.includes('duplicate key')) {
            result.errors.push(`Failed to create suggestion: ${suggestionError.message}`)
          }
        } else {
          result.suggestionsCreated++
        }
      }
    }
  }

  return result
}

/**
 * Get pending duplicate suggestions for a household.
 */
export async function getPendingDuplicateSuggestions(
  supabase: SupabaseClient
): Promise<
  Array<{
    id: string
    eventA: ExternalEvent
    eventB: ExternalEvent
    confidence: number
    matchReason: string
    createdAt: string
  }>
> {
  const { data, error } = await supabase
    .from('event_duplicate_suggestions')
    .select(
      `
      id,
      confidence,
      match_reason,
      created_at,
      event_a:external_events!event_a_id(id, title, event_date, end_date, event_time, event_type, source_url_id, integration_id, child_id),
      event_b:external_events!event_b_id(id, title, event_date, end_date, event_time, event_type, source_url_id, integration_id, child_id)
    `
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error || !data) {
    console.error('[Deduplication] Error fetching suggestions:', error)
    return []
  }

  return data.map((row) => ({
    id: row.id,
    eventA: row.event_a as unknown as ExternalEvent,
    eventB: row.event_b as unknown as ExternalEvent,
    confidence: row.confidence,
    matchReason: row.match_reason || '',
    createdAt: row.created_at,
  }))
}

/**
 * Manually trigger deduplication on ALL future events in a household.
 * Scans all events from different sources and finds duplicates.
 */
export async function deduplicateAllEvents(
  supabase: SupabaseClient,
  householdId: string
): Promise<DeduplicationResult> {
  const result: DeduplicationResult = {
    autoMerged: 0,
    suggestionsCreated: 0,
    errors: [],
    pairsChecked: 0,
  }

  // Get AI model from settings
  const model = await getDeduplicationModel(supabase)

  // Get all source IDs for this household
  const [sourceUrlsResult, integrationsResult] = await Promise.all([
    supabase.from('external_source_urls').select('id').eq('household_id', householdId),
    supabase.from('external_integrations').select('id').eq('household_id', householdId),
  ])

  const sourceUrlIds = sourceUrlsResult.data?.map((s) => s.id) || []
  const integrationIds = integrationsResult.data?.map((i) => i.id) || []

  if (sourceUrlIds.length === 0 && integrationIds.length === 0) {
    return result
  }

  // Get all future events (from today onwards) that aren't already marked as duplicates
  const today = formatDateISO(new Date())

  const eventSelectFields = 'id, title, event_date, end_date, event_time, event_type, source_url_id, integration_id, child_id, duplicate_of_id, is_hidden'

  // Query using safe parameterized .in() instead of .or() string interpolation
  // Make separate queries and combine results to avoid SQL injection
  const [sourceUrlEventsResult, integrationEventsResult] = await Promise.all([
    sourceUrlIds.length > 0
      ? supabase
          .from('external_events')
          .select(eventSelectFields)
          .in('source_url_id', sourceUrlIds)
          .gte('event_date', today)
          .is('duplicate_of_id', null)
          .eq('is_hidden', false)
      : Promise.resolve({ data: [], error: null }),
    integrationIds.length > 0
      ? supabase
          .from('external_events')
          .select(eventSelectFields)
          .in('integration_id', integrationIds)
          .gte('event_date', today)
          .is('duplicate_of_id', null)
          .eq('is_hidden', false)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (sourceUrlEventsResult.error) {
    result.errors.push(`Error querying by source_url_id: ${sourceUrlEventsResult.error.message}`)
  }
  if (integrationEventsResult.error) {
    result.errors.push(`Error querying by integration_id: ${integrationEventsResult.error.message}`)
  }

  const allEvents = combineAndDeduplicateEvents(
    (sourceUrlEventsResult.data || []) as ExternalEvent[],
    (integrationEventsResult.data || []) as ExternalEvent[]
  )

  // Sort by event_date ascending (since we combined results from two queries)
  allEvents.sort((a, b) => a.event_date.localeCompare(b.event_date))

  if (allEvents.length < 2) {
    return result // Need at least 2 events to compare
  }

  // Group events by source (source_url_id or integration_id)
  const eventsBySource = new Map<string, ExternalEvent[]>()
  for (const event of allEvents as ExternalEvent[]) {
    const sourceKey = event.source_url_id || event.integration_id || 'unknown'
    if (!eventsBySource.has(sourceKey)) {
      eventsBySource.set(sourceKey, [])
    }
    eventsBySource.get(sourceKey)!.push(event)
  }

  // Build pairs to check: compare events from DIFFERENT sources only
  // Also check date proximity (±3 days) and child context
  const pairsToCheck: Array<{ eventA: ExternalEvent; eventB: ExternalEvent }> = []
  const sourceKeys = Array.from(eventsBySource.keys())

  for (let i = 0; i < sourceKeys.length; i++) {
    for (let j = i + 1; j < sourceKeys.length; j++) {
      const eventsA = eventsBySource.get(sourceKeys[i])!
      const eventsB = eventsBySource.get(sourceKeys[j])!

      for (const eventA of eventsA) {
        for (const eventB of eventsB) {
          // Only compare events for the same child (or both without child context)
          // This prevents false positives like "Vinterferie" for different children
          if (eventA.child_id !== eventB.child_id) {
            // Allow comparison if either has no child (household-wide event)
            if (eventA.child_id !== null && eventB.child_id !== null) {
              continue
            }
          }

          // Check date proximity (±3 days)
          const daysDiff = Math.abs(
            (new Date(eventA.event_date).getTime() - new Date(eventB.event_date).getTime()) /
              (1000 * 60 * 60 * 24)
          )
          if (daysDiff <= 3) {
            pairsToCheck.push({ eventA, eventB })
          }
        }
      }
    }
  }

  if (pairsToCheck.length === 0) {
    return result
  }

  result.pairsChecked = pairsToCheck.length

  // Batch pairs for LLM (max 10 per request to avoid token limits)
  const batchSize = 10
  const allLLMResults: LLMDuplicateResult[] = []

  for (let i = 0; i < pairsToCheck.length; i += batchSize) {
    const batch = pairsToCheck.slice(i, i + batchSize)
    const results = await evaluateDuplicatesWithLLM(batch, model)
    allLLMResults.push(...results)
  }

  // Convert LLM results to DuplicateCandidate format
  const pairsMap = new Map(
    pairsToCheck.map((p) => [`${p.eventA.id}:${p.eventB.id}`, p])
  )

  // Track which pairs we've already processed
  const processedPairs = new Set<string>()

  for (const llmResult of allLLMResults) {
    if (!llmResult.isDuplicate || llmResult.confidence < MEDIUM_CONFIDENCE_THRESHOLD) {
      continue
    }

    // Find the original pair (could be A:B or B:A)
    const pair = pairsMap.get(`${llmResult.eventAId}:${llmResult.eventBId}`) ||
                 pairsMap.get(`${llmResult.eventBId}:${llmResult.eventAId}`)

    if (!pair) continue

    // Normalize pair key (smaller ID first)
    const pairKey =
      pair.eventA.id < pair.eventB.id
        ? `${pair.eventA.id}:${pair.eventB.id}`
        : `${pair.eventB.id}:${pair.eventA.id}`

    if (processedPairs.has(pairKey)) continue
    processedPairs.add(pairKey)

    if (llmResult.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      // Auto-merge: Hide the newer event (by ID)
      const keepEvent = pair.eventA.id < pair.eventB.id ? pair.eventA : pair.eventB
      const hideEvent = pair.eventA.id < pair.eventB.id ? pair.eventB : pair.eventA

      const { error: mergeError } = await supabase
        .from('external_events')
        .update({
          duplicate_of_id: keepEvent.id,
          is_hidden: true,
          duplicate_confidence: llmResult.confidence,
        })
        .eq('id', hideEvent.id)

      if (mergeError) {
        result.errors.push(`Failed to merge duplicate ${hideEvent.id}: ${mergeError.message}`)
      } else {
        result.autoMerged++
      }
    } else {
      // Medium confidence: Create suggestion for user review
      const eventAId = pair.eventA.id < pair.eventB.id ? pair.eventA.id : pair.eventB.id
      const eventBId = pair.eventA.id < pair.eventB.id ? pair.eventB.id : pair.eventA.id

      // Check if suggestion already exists
      const { data: existing } = await supabase
        .from('event_duplicate_suggestions')
        .select('id')
        .eq('event_a_id', eventAId)
        .eq('event_b_id', eventBId)
        .eq('status', 'pending')
        .single()

      if (!existing) {
        const { error: suggestionError } = await supabase
          .from('event_duplicate_suggestions')
          .insert({
            household_id: householdId,
            event_a_id: eventAId,
            event_b_id: eventBId,
            confidence: llmResult.confidence,
            match_reason: llmResult.reason,
          })

        if (suggestionError) {
          if (!suggestionError.message.includes('duplicate key')) {
            result.errors.push(`Failed to create suggestion: ${suggestionError.message}`)
          }
        } else {
          result.suggestionsCreated++
        }
      }
    }
  }

  return result
}
