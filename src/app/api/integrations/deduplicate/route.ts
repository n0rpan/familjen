/**
 * Manual Deduplication API Endpoint
 *
 * Allows users to manually trigger deduplication of all existing events.
 * This scans all future events across all sources and:
 * - Auto-merges high confidence duplicates (≥0.9)
 * - Creates suggestions for medium confidence duplicates (0.6-0.9)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deduplicateAllEvents } from '@/lib/integrations/event-deduplication'
import { checkRateLimit, createRateLimitKey } from '@/lib/rate-limit'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

// Rate limit: 5 requests per hour (AI calls are expensive)
const DEDUPE_RATE_LIMIT = { limit: 5, windowMs: 3600 * 1000 }

export async function POST() {
  const supabase = await createClient()

  // Verify authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return ApiErrors.unauthorized()
  }

  // Rate limit check
  const rateLimit = await checkRateLimit(
    createRateLimitKey(user.id, 'deduplicate'),
    DEDUPE_RATE_LIMIT
  )
  if (rateLimit.limited) {
    return ApiErrors.rateLimit(rateLimit.retryAfter)
  }

  // Get user's household
  const { data: member, error: memberError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .single()

  if (memberError || !member) {
    return ApiErrors.noHousehold()
  }

  try {
    const result = await deduplicateAllEvents(supabase, member.household_id)

    return NextResponse.json({
      success: true,
      autoMerged: result.autoMerged,
      suggestionsCreated: result.suggestionsCreated,
      pairsChecked: result.pairsChecked,
      errors: result.errors,
    })
  } catch (error) {
    return handleApiError(error, 'deduplication')
  }
}
