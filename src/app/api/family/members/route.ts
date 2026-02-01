/**
 * Family API: Members
 *
 * GET /api/family/members - List household members (adults)
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
import type { ApiMember } from '@/lib/types'

/**
 * GET /api/family/members
 *
 * Returns: Array of household members (parents/adults)
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
    if (!hasScope(auth, 'members:read')) {
      throw Errors.missingScope('members:read')
    }

    // Audit log (fire and forget)
    logApiAccess({
      keyId: auth.keyId,
      householdId: auth.householdId,
      operation: 'read',
      endpoint: '/api/family/members',
      method: 'GET',
      request,
    }).catch(() => {})

    const supabase = getServiceClient()

    // Fetch members via the API function
    const { data, error } = await supabase.rpc('api_get_members', {
      p_household_id: auth.householdId,
    })

    if (error) {
      console.error('Failed to fetch members:', error)
      throw Errors.internal('Failed to fetch members')
    }

    // Ensure we always return an array
    const members: ApiMember[] = data || []

    return createApiResponse(members, {
      count: members.length,
    })
  })
}
