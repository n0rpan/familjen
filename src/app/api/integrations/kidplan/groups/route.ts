import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { KidplanClient, KidplanAuthError } from '@/lib/integrations/kidplan'

/**
 * GET /api/integrations/kidplan/groups?integrationId=xxx
 *
 * Fetch available Kidplan children for an existing integration.
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
    const rateLimitKey = createRateLimitKey(user.id, 'kidplanGroups')
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.kidplanTestConnection)
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

    const { email, password, kindergartenId } = credentials as {
      email: string
      password: string
      kindergartenId?: number
    }

    // Connect to Kidplan and fetch children
    const client = new KidplanClient({ debug: process.env.NODE_ENV === 'development' })

    try {
      await client.login(email, password, kindergartenId)
    } catch (error) {
      if (error instanceof KidplanAuthError) {
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
    const childrenResponse = await client.getChildren()

    // Map children to a format similar to Spond groups
    const kidplanChildren = childrenResponse.ChildList.map((child) => ({
      id: String(child.ChildId),
      name: `${child.Firstname} ${child.Lastname}`,
      unit: child.unitName,
      birthdate: KidplanClient.parseMicrosoftDate(child.Birthdate)?.toISOString().split('T')[0] || null,
    }))

    // Also get current mappings
    const { data: currentMappings } = await supabase
      .from('external_integration_children')
      .select('id, child_id, external_group_id, external_group_name')
      .eq('integration_id', integrationId)

    return NextResponse.json({
      success: true,
      email: integration.account_email,
      // Return children in a "groups" format for UI consistency with Spond
      groups: kidplanChildren.map((c) => ({
        id: c.id,
        name: c.name,
        description: `${c.unit} - ${c.birthdate}`,
        memberCount: 1,
        subGroups: [],
      })),
      children: kidplanChildren,
      currentMappings: currentMappings || [],
    })
  } catch (error) {
    console.error('Kidplan groups fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch children. Please try again later.' },
      { status: 500 }
    )
  }
}
