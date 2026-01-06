import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { SpondClient, SpondAuthError } from '@/lib/integrations/spond'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

/**
 * POST /api/integrations/spond/test-connection
 *
 * Test Spond credentials and return available groups.
 * Used during initial setup to verify credentials before saving.
 */
export async function POST(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return ApiErrors.unauthorized()
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'spondTestConnection')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.spondTestConnection)
    if (rateLimit.limited) {
      return ApiErrors.rateLimit(rateLimit.retryAfter)
    }

    // Get user's household
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return ApiErrors.noHousehold()
    }

    // Check if household has integrations enabled
    const { data: household } = await supabase
      .from('households')
      .select('external_integrations_enabled')
      .eq('id', membership.household_id)
      .single()

    if (!household?.external_integrations_enabled) {
      return ApiErrors.forbidden({ hint: 'Eksterne integrasjoner er ikke aktivert for din husstand' })
    }

    // Parse request body
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return ApiErrors.validation('E-post og passord er påkrevd')
    }

    // Test connection to Spond
    const client = new SpondClient({ debug: process.env.NODE_ENV === 'development' })

    try {
      await client.login(email, password)
    } catch (error) {
      if (error instanceof SpondAuthError) {
        return ApiErrors.authFailed('Spond')
      }
      throw error
    }

    // Fetch groups to show user what's available
    const groups = await client.getGroups()

    // Map groups to a simpler format for the UI
    const mappedGroups = groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description || null,
      memberCount: group.members?.length || 0,
      subGroups:
        group.subGroups?.map((sg) => ({
          id: sg.id,
          name: sg.name,
        })) || [],
    }))

    return NextResponse.json({
      success: true,
      email,
      groups: mappedGroups,
    })
  } catch (error) {
    return handleApiError(error, 'spond test connection')
  }
}
