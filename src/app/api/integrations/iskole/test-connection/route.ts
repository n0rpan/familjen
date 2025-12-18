import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { ISkoleClient, ISkoleAuthError } from '@/lib/integrations/iskole'

/**
 * POST /api/integrations/iskole/test-connection
 *
 * Test iSkole credentials and return available children.
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
    const rateLimitKey = createRateLimitKey(user.id, 'iskoleTestConnection')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.iskoleTestConnection)
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
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Fødselsnummer and password are required' },
        { status: 400 }
      )
    }

    // Validate username format (11 digits)
    if (!/^\d{11}$/.test(username)) {
      return NextResponse.json(
        { error: 'Fødselsnummer must be 11 digits' },
        { status: 400 }
      )
    }

    // Test connection to iSkole
    const client = new ISkoleClient()

    try {
      const session = await client.login(username, password)

      // Get children to show the user what's available
      const children = await client.getChildren()

      // Map to simpler format for UI
      const mappedChildren = children.map((child) => ({
        id: String(child.Elevnr),
        name: child.Elev,
        school: child.Skolenavn,
        class: child.Klasse,
        schoolYear: child.Planperi,
        fylkeid: child.Fylkeid,
        skoleid: child.Skoleid,
        unreadMessages: child.AntallMeldinger,
      }))

      return NextResponse.json({
        success: true,
        username,
        parent: {
          name: session.fullname,
          personId: session.personId,
        },
        children: mappedChildren,
      })
    } catch (error) {
      if (error instanceof ISkoleAuthError) {
        return NextResponse.json(
          { error: 'Feil fødselsnummer eller passord' },
          { status: 401 }
        )
      }
      throw error
    }
  } catch (error) {
    console.error('iSkole test connection error:', error)
    return NextResponse.json(
      { error: 'Kunne ikke koble til iSkole. Prøv igjen senere.' },
      { status: 500 }
    )
  }
}
