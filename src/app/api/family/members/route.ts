/**
 * Family API: Members
 *
 * GET /api/family/members - List household members (adults)
 *
 * Authentication: API Key via Authorization header
 * Authorization: Bearer fam_xxxxx
 */

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  validateApiKey,
  hasScope,
  createApiResponse,
  Errors,
  withErrorHandling,
} from '@/lib/family-api'
import type { ApiMember } from '@/lib/types'

// Service client for database operations
function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

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

    // Check scope
    if (!hasScope(auth, 'members:read')) {
      throw Errors.missingScope('members:read')
    }

    const supabase = getServiceClient()

    // Fetch members via the API function
    const { data, error } = await supabase.rpc('api_get_members', {
      p_household_id: auth.householdId,
    })

    if (error) {
      console.error('Failed to fetch members:', error)
      throw Errors.internal('Failed to fetch members')
    }

    const members: ApiMember[] = data || []

    return createApiResponse(members, {
      count: members.length,
    })
  })
}
