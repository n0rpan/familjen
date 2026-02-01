/**
 * Family API: Children
 *
 * GET /api/family/children - List children in the household
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
import type { ApiChild } from '@/lib/types'

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

    // Check scope
    if (!hasScope(auth, 'children:read')) {
      throw Errors.missingScope('children:read')
    }

    const supabase = getServiceClient()

    // Fetch children via the API function
    const { data, error } = await supabase.rpc('api_get_children', {
      p_household_id: auth.householdId,
    })

    if (error) {
      console.error('Failed to fetch children:', error)
      throw Errors.internal('Failed to fetch children')
    }

    const children: ApiChild[] = data || []

    return createApiResponse(children, {
      count: children.length,
    })
  })
}
