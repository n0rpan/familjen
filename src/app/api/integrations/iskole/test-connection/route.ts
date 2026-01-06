import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { ISkoleClient, ISkoleAuthError } from '@/lib/integrations/iskole'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

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
    const rateLimitKey = createRateLimitKey(user.id, 'iskoleTestConnection')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.iskoleTestConnection)
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
    const { username, password } = body

    if (!username || !password) {
      return ApiErrors.validation('Fødselsnummer og passord er påkrevd')
    }

    // Validate username format (11 digits)
    if (!/^\d{11}$/.test(username)) {
      return ApiErrors.validation('Fødselsnummer må være 11 siffer')
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
        return ApiErrors.authFailed('iSkole')
      }
      throw error
    }
  } catch (error) {
    return handleApiError(error, 'iskole test connection')
  }
}
