import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { SpondClient, SpondAuthError } from '@/lib/integrations/spond'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

/**
 * GET /api/integrations/spond/groups?integrationId=xxx
 *
 * Fetch available Spond groups for an existing integration.
 * Uses stored credentials to authenticate.
 */
export async function GET(request: Request) {
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
    const rateLimitKey = createRateLimitKey(user.id, 'spondGroups')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.spondTestConnection)
    if (rateLimit.limited) {
      return ApiErrors.rateLimit(rateLimit.retryAfter)
    }

    // Get integration ID from query params
    const { searchParams } = new URL(request.url)
    const integrationId = searchParams.get('integrationId')

    if (!integrationId) {
      return ApiErrors.validation('integrationId er påkrevd')
    }

    // Get user's household
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return ApiErrors.notFound('Husstanden')
    }

    // Verify the integration belongs to the user's household
    const { data: integration, error: intError } = await supabase
      .from('external_integrations')
      .select('id, household_id, account_email')
      .eq('id', integrationId)
      .single()

    if (intError || !integration) {
      return ApiErrors.notFound('Integrasjonen')
    }

    if (integration.household_id !== membership.household_id) {
      return ApiErrors.forbidden()
    }

    // Get decrypted credentials
    const { data: credentials, error: credError } = await supabase.rpc(
      'get_integration_credentials',
      { p_integration_id: integrationId }
    )

    if (credError || !credentials) {
      return ApiErrors.internal({ internalMessage: 'Failed to decrypt credentials' })
    }

    const { email, password } = credentials as { email: string; password: string }

    // Connect to Spond and fetch groups
    const client = new SpondClient({ debug: process.env.NODE_ENV === 'development' })

    try {
      await client.login(email, password)
    } catch (error) {
      if (error instanceof SpondAuthError) {
        // Update status to auth_failed
        await supabase.rpc('update_integration_sync_status', {
          p_integration_id: integrationId,
          p_status: 'auth_failed',
          p_error: 'Invalid credentials',
        })
        return ApiErrors.authFailed('Spond')
      }
      throw error
    }

    // Fetch groups
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

    // Also get current mappings
    const { data: currentMappings } = await supabase
      .from('external_integration_children')
      .select('id, child_id, member_id, external_group_id, external_group_name')
      .eq('integration_id', integrationId)

    return NextResponse.json({
      success: true,
      email: integration.account_email,
      groups: mappedGroups,
      currentMappings: currentMappings || [],
    })
  } catch (error) {
    return handleApiError(error, 'spond groups')
  }
}
