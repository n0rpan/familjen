import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { SpondClient, SpondAuthError } from '@/lib/integrations/spond'

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
    const rateLimitKey = createRateLimitKey(user.id, 'spondTestConnection')
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.spondTestConnection)
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rateLimit.retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
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

    // Check if household has integrations enabled
    const { data: household } = await supabase
      .from('households')
      .select('external_integrations_enabled')
      .eq('id', membership.household_id)
      .single()

    if (!household?.external_integrations_enabled) {
      return NextResponse.json(
        { error: 'External integrations are not enabled for your household' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Test connection to Spond
    const client = new SpondClient({ debug: process.env.NODE_ENV === 'development' })

    try {
      await client.login(email, password)
    } catch (error) {
      if (error instanceof SpondAuthError) {
        return NextResponse.json(
          { error: 'Invalid Spond credentials. Please check your email and password.' },
          { status: 401 }
        )
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
    console.error('Spond test connection error:', error)
    return NextResponse.json(
      { error: 'Failed to connect to Spond. Please try again later.' },
      { status: 500 }
    )
  }
}
