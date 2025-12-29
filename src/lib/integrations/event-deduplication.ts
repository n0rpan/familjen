/**
 * Event Deduplication Service
 *
 * Detects and handles duplicate events across different sources.
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

export interface DeduplicationResult {
  autoMerged: number
  suggestionsCreated: number
  errors: string[]
}

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length
  const n = str2.length

  // Create a matrix
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0))

  // Initialize first row and column
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  // Fill in the rest
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

/**
 * Calculate string similarity using Levenshtein distance.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
function stringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1
  if (str1.length === 0 || str2.length === 0) return 0

  const distance = levenshteinDistance(str1, str2)
  const maxLength = Math.max(str1.length, str2.length)

  return 1 - distance / maxLength
}

/**
 * Normalize a title for comparison.
 * Handles common Norwegian variations and removes noise.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    // Normalize common Norwegian variations
    .replace(/vinterferie/gi, 'ferie')
    .replace(/høstferie/gi, 'ferie')
    .replace(/påskeferie/gi, 'ferie')
    .replace(/sommerferie/gi, 'ferie')
    .replace(/planleggingsdag/gi, 'planl.dag')
    .replace(/planl\.dag/gi, 'planl.dag')
    // Remove common suffixes that vary
    .replace(/\s*-\s*(skole|barnehage|sfo)/gi, '')
    .replace(/\s*\d{4}(-\d{4})?$/g, '') // Remove year suffixes like "2025" or "2025-2026"
}

/**
 * Calculate date proximity score.
 * Returns 1 for exact match, decreasing for dates further apart.
 */
function dateProximity(date1: string, date2: string): number {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  const diffDays = Math.abs((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 1
  if (diffDays === 1) return 0.9
  if (diffDays === 2) return 0.7
  if (diffDays <= 3) return 0.5
  return 0 // More than 3 days apart - not a match
}

/**
 * Calculate overall duplicate confidence between two events.
 */
function calculateDuplicateConfidence(
  eventA: ExternalEvent,
  eventB: ExternalEvent
): { confidence: number; reason: string } {
  // Must be same date (or very close)
  const dateScore = dateProximity(eventA.event_date, eventB.event_date)
  if (dateScore === 0) {
    return { confidence: 0, reason: 'Dates too far apart' }
  }

  // Compare normalized titles
  const titleA = normalizeTitle(eventA.title)
  const titleB = normalizeTitle(eventB.title)
  const titleScore = stringSimilarity(titleA, titleB)

  // If titles are very similar (>0.8), high confidence
  if (titleScore >= 0.95) {
    return {
      confidence: dateScore * 0.95,
      reason: `Nesten identisk tittel: "${eventA.title}" ≈ "${eventB.title}"`,
    }
  }

  if (titleScore >= 0.8) {
    return {
      confidence: dateScore * titleScore * 0.9,
      reason: `Lignende tittel: "${eventA.title}" ≈ "${eventB.title}"`,
    }
  }

  // Check for common event patterns
  // If both contain the same key terms, might be duplicates
  const keyTermsA = extractKeyTerms(titleA)
  const keyTermsB = extractKeyTerms(titleB)
  const commonTerms = keyTermsA.filter((term) => keyTermsB.includes(term))

  if (commonTerms.length >= 2) {
    const termScore = commonTerms.length / Math.max(keyTermsA.length, keyTermsB.length)
    return {
      confidence: dateScore * termScore * 0.8,
      reason: `Felles nøkkelord: ${commonTerms.join(', ')}`,
    }
  }

  // Check if same child and same event type
  if (eventA.child_id && eventA.child_id === eventB.child_id && titleScore >= 0.5) {
    return {
      confidence: dateScore * titleScore * 0.85,
      reason: `Samme barn, lignende hendelse`,
    }
  }

  // Titles are too different
  if (titleScore < 0.5) {
    return { confidence: 0, reason: 'Titles too different' }
  }

  // Medium confidence for moderate title similarity
  return {
    confidence: dateScore * titleScore * 0.75,
    reason: `Delvis lignende: "${eventA.title}" ≈ "${eventB.title}"`,
  }
}

/**
 * Extract key terms from a normalized title.
 */
function extractKeyTerms(title: string): string[] {
  // Norwegian stop words
  const stopWords = new Set([
    'og',
    'i',
    'på',
    'til',
    'for',
    'med',
    'av',
    'fra',
    'er',
    'en',
    'et',
    'de',
    'den',
    'det',
    'som',
    'har',
    'om',
    'kan',
    'vil',
    'skal',
    'alle',
  ])

  return title
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
}

/**
 * Find potential duplicate events for a given event across all sources.
 */
async function findPotentialDuplicates(
  supabase: SupabaseClient,
  event: ExternalEvent,
  householdId: string
): Promise<DuplicateCandidate[]> {
  const candidates: DuplicateCandidate[] = []

  // Get date range to search (±3 days)
  const eventDate = new Date(event.event_date)
  const startDate = new Date(eventDate)
  startDate.setDate(startDate.getDate() - 3)
  const endDate = new Date(eventDate)
  endDate.setDate(endDate.getDate() + 3)

  // First, get all source_url_ids and integration_ids for this household
  const [sourceUrlsResult, integrationsResult] = await Promise.all([
    supabase.from('external_source_urls').select('id').eq('household_id', householdId),
    supabase.from('external_integrations').select('id').eq('household_id', householdId),
  ])

  const sourceUrlIds = sourceUrlsResult.data?.map((s) => s.id) || []
  const integrationIds = integrationsResult.data?.map((i) => i.id) || []

  if (sourceUrlIds.length === 0 && integrationIds.length === 0) {
    return candidates
  }

  // Build filters for sources
  const filters: string[] = []
  if (sourceUrlIds.length > 0) {
    filters.push(`source_url_id.in.(${sourceUrlIds.join(',')})`)
  }
  if (integrationIds.length > 0) {
    filters.push(`integration_id.in.(${integrationIds.join(',')})`)
  }

  // Query events in the date range from this household's sources
  const { data: nearbyEvents, error } = await supabase
    .from('external_events')
    .select(
      'id, title, event_date, end_date, event_time, event_type, source_url_id, integration_id, child_id, duplicate_of_id, is_hidden'
    )
    .or(filters.join(','))
    .gte('event_date', formatDateISO(startDate))
    .lte('event_date', formatDateISO(endDate))
    .is('duplicate_of_id', null)
    .eq('is_hidden', false)
    .neq('id', event.id)

  if (error || !nearbyEvents) {
    console.error('[Deduplication] Error fetching nearby events:', error)
    return candidates
  }

  // Filter to events from different sources
  const eventsFromOtherSources = nearbyEvents.filter((e) => {
    // Must be from a different source
    if (event.source_url_id && e.source_url_id === event.source_url_id) return false
    if (event.integration_id && e.integration_id === event.integration_id) return false
    return true
  })

  // Calculate confidence for each potential match
  for (const otherEvent of eventsFromOtherSources) {
    const { confidence, reason } = calculateDuplicateConfidence(event, otherEvent as ExternalEvent)

    if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
      candidates.push({
        eventA: event,
        eventB: otherEvent as ExternalEvent,
        confidence,
        matchReason: reason,
      })
    }
  }

  return candidates
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

  console.log(`[Deduplication] Checking ${newEventIds.length} new events for duplicates`)

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

  // Track which pairs we've already checked (to avoid A-B and B-A)
  const checkedPairs = new Set<string>()

  for (const event of newEvents) {
    const candidates = await findPotentialDuplicates(
      supabase,
      event as ExternalEvent,
      householdId
    )

    for (const candidate of candidates) {
      // Create a normalized pair key (smaller ID first)
      const pairKey =
        candidate.eventA.id < candidate.eventB.id
          ? `${candidate.eventA.id}:${candidate.eventB.id}`
          : `${candidate.eventB.id}:${candidate.eventA.id}`

      if (checkedPairs.has(pairKey)) continue
      checkedPairs.add(pairKey)

      if (candidate.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
        // Auto-merge: Hide the newer event (the one just synced)
        const keepEvent = candidate.eventA.id < candidate.eventB.id
          ? candidate.eventA
          : candidate.eventB
        const hideEvent = candidate.eventA.id < candidate.eventB.id
          ? candidate.eventB
          : candidate.eventA

        const { error: mergeError } = await supabase
          .from('external_events')
          .update({
            duplicate_of_id: keepEvent.id,
            is_hidden: true,
            duplicate_confidence: candidate.confidence,
          })
          .eq('id', hideEvent.id)

        if (mergeError) {
          result.errors.push(
            `Failed to merge duplicate ${hideEvent.id}: ${mergeError.message}`
          )
        } else {
          result.autoMerged++
          console.log(
            `[Deduplication] Auto-merged: "${hideEvent.title}" (${candidate.confidence.toFixed(2)}) → "${keepEvent.title}"`
          )
        }
      } else {
        // Medium confidence: Create suggestion for user review
        // Ensure event_a_id < event_b_id for the constraint
        const eventAId =
          candidate.eventA.id < candidate.eventB.id
            ? candidate.eventA.id
            : candidate.eventB.id
        const eventBId =
          candidate.eventA.id < candidate.eventB.id
            ? candidate.eventB.id
            : candidate.eventA.id

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
            // Ignore duplicate key errors (race condition)
            if (!suggestionError.message.includes('duplicate key')) {
              result.errors.push(
                `Failed to create suggestion: ${suggestionError.message}`
              )
            }
          } else {
            result.suggestionsCreated++
            console.log(
              `[Deduplication] Suggestion created: "${candidate.eventA.title}" ≈ "${candidate.eventB.title}" (${candidate.confidence.toFixed(2)})`
            )
          }
        }
      }
    }
  }

  console.log(
    `[Deduplication] Complete: ${result.autoMerged} auto-merged, ${result.suggestionsCreated} suggestions created`
  )

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
