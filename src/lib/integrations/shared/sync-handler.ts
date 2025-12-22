import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin, isUserAdmin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'

type ServiceName = 'spond' | 'mykid' | 'kidplan' | 'iskole'

type RateLimitKey = keyof typeof RATE_LIMITS

interface SyncHandlerConfig {
  service: ServiceName
  rateLimitKey: RateLimitKey
}

interface SyncHandlerSuccess {
  success: true
  supabase: SupabaseClient
  user: User
  householdId: string
  integrations: Integration[]
  isAdmin: boolean
}

interface SyncHandlerError {
  success: false
  response: NextResponse
}

export type SyncHandlerResult = SyncHandlerSuccess | SyncHandlerError

// Basic integration type - routes can extend if needed
export interface Integration {
  id: string
  household_id: string
  service: string
  display_name: string
  credentials_encrypted: string
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_error: string | null
  created_at: string
}

// Child/member mapping type
export interface IntegrationMapping {
  childId: string | null
  memberId: string | null
  groupId: string | null
}

const SERVICE_DISPLAY_NAMES: Record<ServiceName, string> = {
  spond: 'Spond',
  mykid: 'MyKid',
  kidplan: 'Kidplan',
  iskole: 'iSkole',
}

/**
 * Shared handler for integration sync routes.
 * Handles common boilerplate: CSRF, auth, rate limiting, household check, integrations query.
 *
 * @param request - The incoming request
 * @param config - Service-specific configuration
 * @returns Success with context data, or error response
 */
export async function handleSyncSetup(
  request: Request,
  config: SyncHandlerConfig
): Promise<SyncHandlerResult> {
  // CSRF protection
  if (!validateOrigin(request)) {
    return {
      success: false,
      response: NextResponse.json({ error: 'Invalid origin' }, { status: 403 }),
    }
  }

  const supabase = await createClient()

  // Verify user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      success: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  // Check rate limit
  const rateLimitKeyString = createRateLimitKey(user.id, config.rateLimitKey)
  const rateLimit = await checkRateLimit(rateLimitKeyString, RATE_LIMITS[config.rateLimitKey])

  if (rateLimit.limited) {
    return {
      success: false,
      response: NextResponse.json(
        { error: `Too many requests. Try again in ${rateLimit.retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      ),
    }
  }

  // Get user's household
  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return {
      success: false,
      response: NextResponse.json({ error: 'No household found' }, { status: 400 }),
    }
  }

  // Check if household has integrations enabled
  const { data: household } = await supabase
    .from('households')
    .select('external_integrations_enabled')
    .eq('id', membership.household_id)
    .single()

  if (!household?.external_integrations_enabled) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'External integrations are not enabled for your household' },
        { status: 403 }
      ),
    }
  }

  // Parse request body
  const body = await request.json().catch(() => ({}))
  const { integrationId } = body as { integrationId?: string }

  // Get integrations to sync
  let integrationsQuery = supabase
    .from('external_integrations')
    .select('*')
    .eq('household_id', membership.household_id)
    .eq('service', config.service)

  if (integrationId) {
    integrationsQuery = integrationsQuery.eq('id', integrationId)
  }

  const { data: integrations, error: integrationsError } = await integrationsQuery

  if (integrationsError) {
    console.error('Error fetching integrations:', integrationsError)
    return {
      success: false,
      response: NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 }),
    }
  }

  const serviceName = SERVICE_DISPLAY_NAMES[config.service]

  if (!integrations || integrations.length === 0) {
    return {
      success: false,
      response: NextResponse.json({ error: `No ${serviceName} integrations found` }, { status: 404 }),
    }
  }

  return {
    success: true,
    supabase,
    user,
    householdId: membership.household_id,
    integrations: integrations as Integration[],
    isAdmin: isUserAdmin(user),
  }
}

/**
 * Get child/member mappings for integrations
 */
export async function getMappingsForIntegrations(
  supabase: SupabaseClient,
  integrationIds: string[]
): Promise<Map<string, IntegrationMapping[]>> {
  const { data: allMappings } = await supabase
    .from('external_integration_children')
    .select('integration_id, child_id, member_id, external_group_id')
    .in('integration_id', integrationIds)

  const mappingsByIntegration = new Map<string, IntegrationMapping[]>()

  allMappings?.forEach((mapping) => {
    const existing = mappingsByIntegration.get(mapping.integration_id) || []
    existing.push({
      childId: mapping.child_id,
      memberId: mapping.member_id,
      groupId: mapping.external_group_id,
    })
    mappingsByIntegration.set(mapping.integration_id, existing)
  })

  return mappingsByIntegration
}

/**
 * Update integration sync status after sync attempt
 */
export async function updateSyncStatus(
  supabase: SupabaseClient,
  integrationId: string,
  status: 'success' | 'error' | 'partial',
  error?: string
): Promise<void> {
  await supabase
    .from('external_integrations')
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: error || null,
    })
    .eq('id', integrationId)
}

/**
 * Common sync result type
 */
export interface BaseSyncResult {
  integrationId: string
  displayName: string
  success: boolean
  error?: string
}

/**
 * Build success response from sync results
 */
export function buildSyncResponse(results: BaseSyncResult[]): NextResponse {
  const hasErrors = results.some((r) => !r.success)
  const totalSuccess = results.filter((r) => r.success).length

  return NextResponse.json({
    success: !hasErrors || totalSuccess > 0,
    results,
    summary: {
      total: results.length,
      successful: totalSuccess,
      failed: results.length - totalSuccess,
    },
  })
}
