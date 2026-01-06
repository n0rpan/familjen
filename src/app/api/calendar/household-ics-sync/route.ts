import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { validateOrigin } from '@/lib/config'
import { syncHouseholdICS, type HouseholdICSSyncResult } from '@/lib/household-ics-sync'
import { processHouseholdEventsWithAI } from '@/lib/integrations/household-event-extraction'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

/**
 * POST /api/calendar/household-ics-sync
 *
 * Sync ICS calendar events for household (shared family calendar).
 * Can be triggered by user or cron.
 */
export async function POST(request: Request) {
  try {
    // Check if this is a cron request (uses timing-safe comparison)
    const { verifyCronRequest } = await import('@/lib/cron-auth')
    const isCronRequest = verifyCronRequest(request)

    if (isCronRequest) {
      // Cron: sync all households with ICS URLs
      return syncAllHouseholds()
    }

    // User request: validate origin and auth
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

    // Get user's household
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id, is_household_admin')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return ApiErrors.notFound('Husstanden')
    }

    // Only household admins can trigger sync
    if (!membership.is_household_admin) {
      return ApiErrors.forbidden({ hint: 'Kun husstandsadministratorer kan synkronisere' })
    }

    // Get household with ICS URL
    const { data: household, error: householdError } = await supabase
      .from('households')
      .select('id, name, ics_calendar_url')
      .eq('id', membership.household_id)
      .single()

    if (householdError || !household) {
      return ApiErrors.notFound('Husstanden')
    }

    if (!household.ics_calendar_url) {
      return NextResponse.json({
        success: true,
        message: 'No ICS calendar URL configured for household',
        eventsCount: 0,
      })
    }

    // Sync the household
    const result = await syncHouseholdICS(supabase, {
      id: household.id,
      name: household.name || 'Household',
      ics_calendar_url: household.ics_calendar_url,
    })

    // Process events with AI to create suggestions (fire and forget for faster response)
    let suggestionsCreated = 0
    if (result.success && result.eventsCount > 0) {
      try {
        const aiResult = await processHouseholdEventsWithAI(supabase, household.id)
        suggestionsCreated = aiResult.suggestionsCreated
      } catch (aiError) {
        console.error('[Household ICS] AI extraction error:', aiError)
        // Don't fail the sync if AI extraction fails
      }
    }

    return NextResponse.json({
      success: result.success,
      eventsCount: result.eventsCount,
      suggestionsCreated,
      error: result.error,
    })
  } catch (error) {
    return handleApiError(error, 'household ICS sync')
  }
}

/**
 * Sync all households with ICS URLs (for cron job).
 */
async function syncAllHouseholds(): Promise<NextResponse> {
  console.log('[Household ICS Cron] Starting scheduled household ICS calendar sync')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[Household ICS Cron] Missing Supabase configuration')
    return ApiErrors.internal({ internalMessage: 'Missing Supabase configuration' })
  }

  const supabase = createServiceClient(supabaseUrl, serviceRoleKey)

  // Get all households with ICS URLs
  const { data: households, error: householdsError } = await supabase
    .from('households')
    .select('id, name, ics_calendar_url')
    .not('ics_calendar_url', 'is', null)

  if (householdsError) {
    console.error('[Household ICS Cron] Error fetching households:', householdsError)
    return ApiErrors.internal({ internalMessage: 'Failed to fetch households' })
  }

  if (!households || households.length === 0) {
    console.log('[Household ICS Cron] No households with ICS calendars')
    return NextResponse.json({
      success: true,
      message: 'No households with ICS calendars to sync',
      householdsProcessed: 0,
    })
  }

  console.log(`[Household ICS Cron] Found ${households.length} households with ICS calendars`)

  // Sync each household and process with AI
  const results: HouseholdICSSyncResult[] = []
  let totalSuggestions = 0

  for (const household of households) {
    const result = await syncHouseholdICS(supabase, {
      id: household.id,
      name: household.name || 'Household',
      ics_calendar_url: household.ics_calendar_url!,
    })
    results.push(result)

    // Process events with AI
    if (result.success && result.eventsCount > 0) {
      try {
        const aiResult = await processHouseholdEventsWithAI(supabase, household.id)
        totalSuggestions += aiResult.suggestionsCreated
        console.log(`[Household ICS Cron] ${household.name}: ${aiResult.suggestionsCreated} suggestions created`)
      } catch (aiError) {
        console.error(`[Household ICS Cron] AI extraction error for ${household.name}:`, aiError)
      }
    }

    // Small delay between syncs to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  const successCount = results.filter((r) => r.success).length
  const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)

  console.log(`[Household ICS Cron] Sync complete: ${successCount}/${households.length} success, ${totalEvents} events, ${totalSuggestions} suggestions`)

  return NextResponse.json({
    success: true,
    householdsProcessed: households.length,
    householdsSuccess: successCount,
    householdsFailed: households.length - successCount,
    eventsTotal: totalEvents,
    suggestionsTotal: totalSuggestions,
  })
}

/**
 * GET /api/calendar/household-ics-sync
 *
 * Get ICS sync status for current user's household.
 */
export async function GET(request: Request) {
  try {
    // Validate origin for security consistency
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

    // Get user's household membership
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return ApiErrors.notFound('Husstanden')
    }

    // Get household ICS status
    const { data: household, error } = await supabase
      .from('households')
      .select('id, name, ics_calendar_url, ics_last_sync_at, ics_sync_error')
      .eq('id', membership.household_id)
      .single()

    if (error || !household) {
      return ApiErrors.notFound('Husstanden')
    }

    return NextResponse.json({
      hasICSCalendar: !!household.ics_calendar_url,
      lastSyncAt: household.ics_last_sync_at,
      syncError: household.ics_sync_error,
    })
  } catch (error) {
    return handleApiError(error, 'household ICS status')
  }
}
