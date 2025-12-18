import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { ISkoleClient, ISkoleAuthError } from '@/lib/integrations/iskole'

/**
 * GET /api/integrations/iskole/groups?integrationId=xxx
 *
 * Fetch available iSkole children for an existing integration.
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
    const rateLimitKey = createRateLimitKey(user.id, 'iskoleGroups')
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.iskoleTestConnection)
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

    const { username, password } = credentials as {
      username: string
      password: string
    }

    // Connect to iSkole and fetch children
    const client = new ISkoleClient({ debug: process.env.NODE_ENV === 'development' })

    try {
      await client.login(username, password)
    } catch (error) {
      if (error instanceof ISkoleAuthError) {
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

    // Fetch children
    const iskoleChildren = await client.getChildren()

    // Also get current mappings
    const { data: currentMappings } = await supabase
      .from('external_integration_children')
      .select('id, child_id, external_group_id, external_group_name')
      .eq('integration_id', integrationId)

    return NextResponse.json({
      success: true,
      username: integration.account_email,
      // Return children in a "groups" format for UI consistency with Spond/Kidplan
      groups: iskoleChildren.map((c) => ({
        id: String(c.Elevnr),
        name: c.Elev,
        description: `${c.Skolenavn} - ${c.Klasse} (${c.Planperi})`,
        memberCount: 1,
        subGroups: [],
      })),
      children: iskoleChildren.map((c) => ({
        id: String(c.Elevnr),
        name: c.Elev,
        school: c.Skolenavn,
        class: c.Klasse,
        schoolYear: c.Planperi,
        fylkeid: c.Fylkeid,
        skoleid: c.Skoleid,
      })),
      currentMappings: currentMappings || [],
    })
  } catch (error) {
    console.error('iSkole groups fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch children. Please try again later.' },
      { status: 500 }
    )
  }
}
