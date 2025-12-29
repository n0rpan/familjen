import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { MyKidClient, MyKidAuthError } from '@/lib/integrations/mykid'

/**
 * POST /api/integrations/mykid/test-connection
 *
 * Test MyKid credentials and return available children.
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
    const rateLimitKey = createRateLimitKey(user.id, 'mykidTestConnection')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.mykidTestConnection)
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
    const { phone, password } = body

    if (!phone || !password) {
      return NextResponse.json(
        { error: 'Phone and password are required' },
        { status: 400 }
      )
    }

    // Test connection to MyKid
    const client = new MyKidClient()

    try {
      await client.login(phone, password)

      // Get children list
      const children = await client.getChildren()

      if (children.length === 0) {
        return NextResponse.json({
          success: true,
          phone,
          children: [],
          warning: 'Ingen barn funnet i MyKid-kontoen. Kontakt support hvis dette er feil.',
        })
      }

      return NextResponse.json({
        success: true,
        phone,
        children: children.map((child) => ({
          id: child.id,
          name: child.name,
        })),
      })
    } catch (error) {
      if (error instanceof MyKidAuthError) {
        return NextResponse.json(
          { error: 'Feil telefonnummer eller passord' },
          { status: 401 }
        )
      }
      throw error
    }
  } catch (error) {
    console.error('MyKid test connection error:', error)
    return NextResponse.json(
      { error: 'Kunne ikke koble til MyKid. Prøv igjen senere.' },
      { status: 500 }
    )
  }
}
