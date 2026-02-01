/**
 * Family API: Pickups
 *
 * GET    /api/family/pickups - List pickups for a date range
 * POST   /api/family/pickups - Create or update a pickup
 * DELETE /api/family/pickups - Delete a pickup
 *
 * Authentication: API Key via Authorization header
 * Authorization: Bearer fam_xxxxx
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  validateApiKey,
  hasScope,
  createApiResponse,
  Errors,
  withErrorHandling,
  getServiceClient,
  isValidDate,
  validateDateRange,
  validateUUID,
  validateNotes,
  isValidUUID,
  logApiAccess,
  MAX_DATE_RANGE_DAYS,
} from '@/lib/family-api'
import { dispatchWebhooks } from '@/lib/family-api/webhooks'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import type { ApiPickup } from '@/lib/types'

/**
 * GET /api/family/pickups
 *
 * Query params:
 * - from: Start date (YYYY-MM-DD), defaults to today
 * - to: End date (YYYY-MM-DD), defaults to 7 days from 'from'
 *
 * Returns: Array of pickups with child and picker details
 */
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    // Validate API key
    const auth = await validateApiKey(request)
    if (!auth.valid) {
      throw Errors.unauthorized(auth.error)
    }

    // Rate limit by API key ID (not household - isolates abuse per key)
    const rateLimit = await checkRateLimit(
      `familyApi:read:${auth.keyId}`,
      RATE_LIMITS.familyApiRead
    )
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Check scope
    if (!hasScope(auth, 'pickups:read')) {
      throw Errors.missingScope('pickups:read')
    }

    // Audit log (fire and forget)
    logApiAccess({
      keyId: auth.keyId,
      householdId: auth.householdId,
      operation: 'read',
      endpoint: '/api/family/pickups',
      method: 'GET',
      request,
    }).catch(() => {})

    // Parse query params
    const { searchParams } = new URL(request.url)
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')

    // Default to today if no from date
    const today = new Date()
    const fromDate = fromParam || today.toISOString().split('T')[0]

    // Default to 7 days after from date
    let toDate = toParam
    if (!toDate) {
      const from = new Date(fromDate)
      from.setDate(from.getDate() + 7)
      toDate = from.toISOString().split('T')[0]
    }

    // Validate dates (with proper date validation, not just regex)
    if (!isValidDate(fromDate)) {
      throw Errors.badRequest('Invalid from date. Use YYYY-MM-DD with valid date values.')
    }
    if (!isValidDate(toDate)) {
      throw Errors.badRequest('Invalid to date. Use YYYY-MM-DD with valid date values.')
    }

    // Validate date range (max 90 days to prevent data dumps)
    const rangeError = validateDateRange(fromDate, toDate)
    if (rangeError) {
      throw Errors.badRequest(`${rangeError}. Max: ${MAX_DATE_RANGE_DAYS} days.`)
    }

    const supabase = getServiceClient()

    // Fetch pickups via the API function
    const { data, error } = await supabase.rpc('api_get_pickups', {
      p_household_id: auth.householdId,
      p_from_date: fromDate,
      p_to_date: toDate,
    })

    if (error) {
      console.error('Failed to fetch pickups:', error)
      throw Errors.internal('Failed to fetch pickups')
    }

    // Ensure we always return an array (even if DB returns null)
    const pickups: ApiPickup[] = data || []

    return createApiResponse(pickups, {
      count: pickups.length,
      from: fromDate,
      to: toDate,
    })
  })
}

/**
 * POST /api/family/pickups
 *
 * Body:
 * - child_id: UUID of the child (required)
 * - date: Date in YYYY-MM-DD format (required)
 * - picker_id: UUID of the picker (optional, null to unassign)
 * - notes: Optional notes
 *
 * Returns: Created/updated pickup info
 */
export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    // Validate API key
    const auth = await validateApiKey(request)
    if (!auth.valid) {
      throw Errors.unauthorized(auth.error)
    }

    // Rate limit by API key ID (not household - isolates abuse per key)
    const rateLimit = await checkRateLimit(
      `familyApi:write:${auth.keyId}`,
      RATE_LIMITS.familyApiWrite
    )
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Check scope
    if (!hasScope(auth, 'pickups:write')) {
      throw Errors.missingScope('pickups:write')
    }

    // Audit log (fire and forget)
    logApiAccess({
      keyId: auth.keyId,
      householdId: auth.householdId,
      operation: 'write',
      endpoint: '/api/family/pickups',
      method: 'POST',
      request,
    }).catch(() => {})

    // Parse body
    let body: {
      child_id?: string
      date?: string
      picker_id?: string | null
      notes?: string | null
    }

    try {
      body = await request.json()
    } catch {
      throw Errors.badRequest('Invalid JSON body')
    }

    // Validate required fields
    if (!body.child_id) {
      throw Errors.badRequest('child_id is required')
    }
    if (!isValidUUID(body.child_id)) {
      throw Errors.badRequest('child_id must be a valid UUID')
    }
    if (!body.date) {
      throw Errors.badRequest('date is required')
    }
    if (!isValidDate(body.date)) {
      throw Errors.badRequest('Invalid date. Use YYYY-MM-DD with valid date values.')
    }

    // Validate optional fields
    if (body.picker_id !== null && body.picker_id !== undefined && !isValidUUID(body.picker_id)) {
      throw Errors.badRequest('picker_id must be a valid UUID')
    }

    const notesError = validateNotes(body.notes)
    if (notesError) {
      throw Errors.badRequest(notesError)
    }

    const supabase = getServiceClient()

    // Get existing pickup for comparison (for webhook)
    const { data: existingPickups } = await supabase.rpc('api_get_pickups', {
      p_household_id: auth.householdId,
      p_from_date: body.date,
      p_to_date: body.date,
    })

    const existingPickup = existingPickups?.find(
      (p: ApiPickup) => p.child.id === body.child_id && p.date === body.date
    )

    // Upsert pickup with API key attribution
    const { data, error } = await supabase.rpc('api_upsert_pickup', {
      p_household_id: auth.householdId,
      p_child_id: body.child_id,
      p_date: body.date,
      p_picker_id: body.picker_id ?? null,
      p_notes: body.notes ?? null,
      p_api_key_id: auth.keyId,  // Track which API key made the change
    })

    if (error) {
      console.error('Failed to upsert pickup:', error)
      // Sanitize error messages - don't leak database internals
      if (error.message.includes('Child not found')) {
        throw Errors.badRequest('Child not found in household')
      }
      if (error.message.includes('Picker not found')) {
        throw Errors.badRequest('Picker not found in household')
      }
      throw Errors.internal('Failed to save pickup')
    }

    // Fetch the updated pickup for response and webhook
    const { data: updatedPickups } = await supabase.rpc('api_get_pickups', {
      p_household_id: auth.householdId,
      p_from_date: body.date,
      p_to_date: body.date,
    })

    const updatedPickup = updatedPickups?.find(
      (p: ApiPickup) => p.child.id === body.child_id && p.date === body.date
    )

    // Dispatch webhook only if we have the pickup data
    if (updatedPickup) {
      const isNew = data.operation === 'created'
      const eventType = isNew ? 'pickup.created' : 'pickup.updated'

      // Fire and forget - don't wait for webhook delivery
      dispatchWebhooks(
        auth.householdId,
        eventType,
        updatedPickup,
        isNew ? undefined : existingPickup
      ).catch((err) => console.error('Webhook dispatch failed:', err))
    }

    return createApiResponse({
      pickup: updatedPickup ?? null,
      operation: data.operation,
    })
  })
}

/**
 * DELETE /api/family/pickups
 *
 * Query params:
 * - id: UUID of the pickup to delete
 *
 * Returns: Success status
 */
export async function DELETE(request: NextRequest) {
  return withErrorHandling(async () => {
    // Validate API key
    const auth = await validateApiKey(request)
    if (!auth.valid) {
      throw Errors.unauthorized(auth.error)
    }

    // Rate limit by API key ID (not household - isolates abuse per key)
    const rateLimit = await checkRateLimit(
      `familyApi:write:${auth.keyId}`,
      RATE_LIMITS.familyApiWrite
    )
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Check scope
    if (!hasScope(auth, 'pickups:write')) {
      throw Errors.missingScope('pickups:write')
    }

    // Audit log (fire and forget)
    logApiAccess({
      keyId: auth.keyId,
      householdId: auth.householdId,
      operation: 'write',
      endpoint: '/api/family/pickups',
      method: 'DELETE',
      request,
    }).catch(() => {})

    // Get pickup ID from query
    const { searchParams } = new URL(request.url)
    const pickupId = searchParams.get('id')

    const uuidError = validateUUID(pickupId, 'id')
    if (uuidError) {
      throw Errors.badRequest(uuidError)
    }

    const supabase = getServiceClient()

    // Get pickup details before deletion (for webhook)
    const { data: pickupData } = await supabase
      .from('pickups')
      .select(`
        id, date, notes,
        child:children(id, name, color),
        picker:household_members(id, name, short_name)
      `)
      .eq('id', pickupId)
      .eq('household_id', auth.householdId)
      .single()

    if (!pickupData) {
      throw Errors.notFound('Pickup')
    }

    // Delete pickup
    const { data, error } = await supabase.rpc('api_delete_pickup', {
      p_household_id: auth.householdId,
      p_pickup_id: pickupId,
    })

    if (error) {
      console.error('Failed to delete pickup:', error)
      throw Errors.internal('Failed to delete pickup')
    }

    if (!data) {
      throw Errors.notFound('Pickup')
    }

    // Dispatch webhook
    dispatchWebhooks(auth.householdId, 'pickup.deleted', pickupData).catch(
      (err) => console.error('Webhook dispatch failed:', err)
    )

    return createApiResponse({ deleted: true })
  })
}
