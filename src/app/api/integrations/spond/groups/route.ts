import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { SpondClient, SpondAuthError } from '@/lib/integrations/spond'

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
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }

    const supabase = await createClient()

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'spondGroups')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.spondTestConnection)
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rateLimit.retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Get integration ID from query params
    const { searchParams } = new URL(request.url)
    const integrationId = searchParams.get('integrationId')

    if (!integrationId) {
      return NextResponse.json({ error: 'integrationId is required' }, { status: 400 })
    }

    // Get user's household
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 400 })
    }

    // Verify the integration belongs to the user's household
    const { data: integration, error: intError } = await supabase
      .from('external_integrations')
      .select('id, household_id, account_email')
      .eq('id', integrationId)
      .single()

    if (intError || !integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    if (integration.household_id !== membership.household_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get decrypted credentials
    const { data: credentials, error: credError } = await supabase.rpc(
      'get_integration_credentials',
      { p_integration_id: integrationId }
    )

    if (credError || !credentials) {
      return NextResponse.json({ error: 'Failed to decrypt credentials' }, { status: 500 })
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
        return NextResponse.json(
          { error: 'Authentication failed - credentials may have changed' },
          { status: 401 }
        )
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
    console.error('Spond groups fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch groups. Please try again later.' },
      { status: 500 }
    )
  }
}
