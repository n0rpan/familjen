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

// Confidence thresholds
const HIGH_CONFIDENCE_THRESHOLD = 0.9
const MEDIUM_CONFIDENCE_THRESHOLD = 0.6

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

  // Build the prompt with all event pairs
  const pairsDescription = pairs.map((pair, index) => {
    const eventA = pair.eventA
    const eventB = pair.eventB
    return `Pair ${index + 1}:
  Event A (ID: ${eventA.id}):
    - Title: "${eventA.title}"
    - Date: ${eventA.event_date}${eventA.end_date ? ` to ${eventA.end_date}` : ''}
    - Time: ${eventA.event_time || 'All day'}
    - Type: ${eventA.event_type || 'Unknown'}

  Event B (ID: ${eventB.id}):
    - Title: "${eventB.title}"
    - Date: ${eventB.event_date}${eventB.end_date ? ` to ${eventB.end_date}` : ''}
    - Time: ${eventB.event_time || 'All day'}
    - Type: ${eventB.event_type || 'Unknown'}`
  }).join('\n\n')

  const systemPrompt = `You are an expert at identifying duplicate calendar events from Norwegian family calendars.

These events come from different sources (schools, kindergartens, sports clubs, etc.) and often describe the same event with slightly different wording.

Common patterns:
- "Vinterferie" and "Ferie uke 8" are the same (winter break)
- "Planleggingsdag" and "Planl.dag lærerne" are the same (teacher planning day)
- "Høstferie" and "Høstferie uke 40" are the same
- "Foreldremøte" and "Foreldremøte 1. klasse" might be the same if same date
- Events on the same date with similar meaning but different wording

Consider:
- Semantic similarity (not just string matching)
- Date proximity (±1 day could be same event)
- Norwegian language variations
- Abbreviations and expanded forms

Respond with a JSON array of evaluations.`

  const userPrompt = `Evaluate these event pairs and determine if they are duplicates.

${pairsDescription}

For each pair, respond with:
- isDuplicate: true/false
- confidence: 0.0-1.0 (how confident you are)
- reason: Brief Norwegian explanation for the user

Respond ONLY with a JSON array like:
[
  {"eventAId": "...", "eventBId": "...", "isDuplicate": true, "confidence": 0.95, "reason": "Samme vinterferie, ulik formulering"},
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

  // Build filters for sources
  const filters: string[] = []
  if (sourceUrlIds.length > 0) {
    filters.push(`source_url_id.in.(${sourceUrlIds.join(',')})`)
  }
  if (integrationIds.length > 0) {
    filters.push(`integration_id.in.(${integrationIds.join(',')})`)
  }

  // Query all events in date range from this household
  const { data: allEvents, error } = await supabase
    .from('external_events')
    .select(
      'id, title, event_date, end_date, event_time, event_type, source_url_id, integration_id, child_id, duplicate_of_id, is_hidden'
    )
    .or(filters.join(','))
    .gte('event_date', formatDateISO(minDate))
    .lte('event_date', formatDateISO(maxDate))
    .is('duplicate_of_id', null)
    .eq('is_hidden', false)

  if (error || !allEvents) {
    console.error('[Deduplication] Error fetching events:', error)
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

      // Check date proximity (±3 days)
      const daysDiff = Math.abs(
        (new Date(newEvent.event_date).getTime() - new Date(existingEvent.event_date).getTime()) /
          (1000 * 60 * 60 * 24)
      )
      if (daysDiff > 3) continue

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
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'openrouter_model')
    .single()

  // Use the configured model, or fall back to a fast/cheap model
  return data?.value || 'google/gemini-2.5-flash-lite'
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
