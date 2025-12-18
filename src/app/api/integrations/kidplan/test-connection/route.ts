import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { KidplanClient, KidplanAuthError } from '@/lib/integrations/kidplan'

/**
 * POST /api/integrations/kidplan/test-connection
 *
 * Test Kidplan credentials and return available kindergartens.
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
    const rateLimitKey = createRateLimitKey(user.id, 'kidplanTestConnection')
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.kidplanTestConnection)
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

    // Test connection to Kidplan
    const client = new KidplanClient({ debug: process.env.NODE_ENV === 'development' })

    try {
      const session = await client.login(email, password)

      // Get children to show the user what's available
      const childrenResponse = await client.getChildren()

      // Map to simpler format for UI
      const children = childrenResponse.ChildList.map((child) => ({
        id: child.ChildId,
        name: `${child.Firstname} ${child.Lastname}`,
        unit: child.unitName,
        birthdate: KidplanClient.parseMicrosoftDate(child.Birthdate).toISOString().split('T')[0],
      }))

      return NextResponse.json({
        success: true,
        email,
        kindergarten: {
          id: session.kindergartenId,
          name: session.kindergartenName,
        },
        children,
      })
    } catch (error) {
      if (error instanceof KidplanAuthError) {
        return NextResponse.json(
          { error: 'Invalid Kidplan credentials. Please check your email and password.' },
          { status: 401 }
        )
      }
      throw error
    }
  } catch (error) {
    console.error('Kidplan test connection error:', error)
    return NextResponse.json(
      { error: 'Failed to connect to Kidplan. Please try again later.' },
      { status: 500 }
    )
  }
}
