import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { MyKidClient, MyKidAuthError } from '@/lib/integrations/mykid'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

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
    const rateLimitKey = createRateLimitKey(user.id, 'mykidTestConnection')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.mykidTestConnection)
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
    const { phone, password } = body

    if (!phone || !password) {
      return ApiErrors.validation('Telefon og passord er påkrevd')
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
        return ApiErrors.authFailed('MyKid')
      }
      throw error
    }
  } catch (error) {
    return handleApiError(error, 'mykid test connection')
  }
}
