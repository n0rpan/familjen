/**
 * Family API: Context
 *
 * GET /api/family/context - Get API documentation and household context
 *
 * This endpoint helps AI assistants understand:
 * - What entities exist (children, members, pickups)
 * - What fields mean and how to use them
 * - Common scenarios and how to handle them
 * - Current household summary (names, counts)
 *
 * Authentication: API Key via Authorization header
 * Authorization: Bearer fam_xxxxx
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  validateApiKey,
  createApiResponse,
  Errors,
  withErrorHandling,
  getServiceClient,
  logApiAccess,
} from '@/lib/family-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET /api/family/context
 *
 * Returns documentation and context for AI assistants to understand the API.
 * No special scope required - any valid API key can access this.
 */
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    // Validate API key
    const auth = await validateApiKey(request)
    if (!auth.valid) {
      throw Errors.unauthorized(auth.error)
    }

    // Rate limit (same as read operations)
    const rateLimit = await checkRateLimit(
      `familyApi:read:${auth.keyId}`,
      RATE_LIMITS.familyApiRead
    )
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Audit log (fire and forget)
    logApiAccess({
      keyId: auth.keyId,
      householdId: auth.householdId,
      operation: 'read',
      endpoint: '/api/family/context',
      method: 'GET',
      request,
    }).catch(() => {})

    const supabase = getServiceClient()

    // Get context from database function
    const { data, error } = await supabase.rpc('api_get_context', {
      p_household_id: auth.householdId,
    })

    if (error) {
      console.error('Failed to get context:', error)
      throw Errors.internal('Failed to get context')
    }

    return createApiResponse(data)
  })
}
