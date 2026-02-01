/**
 * Family API: Children
 *
 * GET /api/family/children - List children in the household
 *
 * Authentication: API Key via Authorization header
 * Authorization: Bearer fam_xxxxx
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  validateApiKey,
  hasScope,
  createApiResponse,
  Errors,
  withErrorHandling,
  getServiceClient,
  logApiAccess,
} from '@/lib/family-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import type { ApiChild } from '@/lib/types'

/**
 * GET /api/family/children
 *
 * Returns: Array of children with basic info
 */
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    // Validate API key
    const auth = await validateApiKey(request)
    if (!auth.valid) {
      throw Errors.unauthorized(auth.error)
    }

    // Rate limit by API key ID (not household - isolates abuse per key)
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

    // Check scope
    if (!hasScope(auth, 'children:read')) {
      throw Errors.missingScope('children:read')
    }

    // Audit log (fire and forget)
    logApiAccess({
      keyId: auth.keyId,
      householdId: auth.householdId,
      operation: 'read',
      endpoint: '/api/family/children',
      method: 'GET',
      request,
    }).catch(() => {})

    const supabase = getServiceClient()

    // Fetch children via the API function
    const { data, error } = await supabase.rpc('api_get_children', {
      p_household_id: auth.householdId,
    })

    if (error) {
      console.error('Failed to fetch children:', error)
      throw Errors.internal('Failed to fetch children')
    }

    // Ensure we always return an array
    const children: ApiChild[] = data || []

    return createApiResponse(children, {
      count: children.length,
    })
  })
}
