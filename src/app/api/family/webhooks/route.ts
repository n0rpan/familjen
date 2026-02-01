/**
 * Family API: Webhook Management
 *
 * GET    /api/family/webhooks - List webhooks (authenticated users)
 * POST   /api/family/webhooks - Create new webhook (household admins)
 * PATCH  /api/family/webhooks - Update a webhook (household admins)
 * DELETE /api/family/webhooks - Delete a webhook (household admins)
 *
 * Authentication: Session-based (not API key)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateWebhookUrl, validateWebhookEvents, validateUUID } from '@/lib/family-api'
import type { HouseholdWebhook } from '@/lib/types'

/**
 * GET /api/family/webhooks
 *
 * Returns: Array of webhooks (without secrets)
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Get user's household
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'No household found' },
        { status: 404 }
      )
    }

    // Fetch webhooks for the household (secret_encrypted not included)
    const { data: webhooks, error } = await supabase
      .from('household_webhooks')
      .select('id, url, events, name, created_at, last_triggered_at, last_status, failure_count, disabled_at')
      .eq('household_id', membership.household_id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch webhooks:', error)
      return NextResponse.json(
        { error: 'Failed to fetch webhooks' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data: webhooks })
  } catch (error) {
    console.error('Webhooks GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/family/webhooks
 *
 * Body:
 * - url: Webhook endpoint URL (required)
 * - events: Array of event types to subscribe to (required)
 * - name: User-friendly name (optional)
 *
 * Returns: Created webhook with secret (secret shown only once!)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Parse body
    let body: { url?: string; events?: string[]; name?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    // Validate required fields
    if (!body.url || body.url.trim().length === 0) {
      return NextResponse.json(
        { error: 'url is required' },
        { status: 400 }
      )
    }

    // Validate URL format (with SSRF protection)
    const urlValidation = validateWebhookUrl(body.url)
    if (!urlValidation.valid) {
      return NextResponse.json(
        { error: urlValidation.error },
        { status: 400 }
      )
    }

    // Validate event types
    const eventsError = validateWebhookEvents(body.events || [])
    if (eventsError) {
      return NextResponse.json(
        { error: eventsError },
        { status: 400 }
      )
    }

    // Create webhook via RPC (handles admin check internally)
    const { data, error } = await supabase.rpc('create_webhook', {
      p_url: body.url.trim(),
      p_events: body.events,
      p_name: body.name?.trim() || null,
    })

    if (error) {
      console.error('Failed to create webhook:', error)
      if (error.message.includes('household admin')) {
        return NextResponse.json(
          { error: 'Only household admins can create webhooks' },
          { status: 403 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to create webhook' },
        { status: 500 }
      )
    }

    // Return the webhook with secret (this is the only time it's shown!)
    return NextResponse.json({
      data: {
        id: data.id,
        url: data.url,
        secret: data.secret,  // Show once!
        events: data.events,
        name: data.name,
      },
      warning: 'Save the secret now - it will not be shown again!',
    })
  } catch (error) {
    console.error('Webhooks POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/family/webhooks
 *
 * Query params:
 * - id: UUID of the webhook to update
 *
 * Body:
 * - url: New URL (optional)
 * - events: New events array (optional)
 * - name: New name (optional)
 * - disabled: true to disable, false to re-enable (optional)
 *
 * Returns: Updated webhook
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Get webhook ID from query
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('id')

    const uuidError = validateUUID(webhookId, 'id')
    if (uuidError) {
      return NextResponse.json(
        { error: uuidError },
        { status: 400 }
      )
    }

    // Parse body
    let body: { url?: string; events?: string[]; name?: string; disabled?: boolean }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    // Check admin status
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id, is_household_admin')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'No household found' },
        { status: 404 }
      )
    }

    if (!membership.is_household_admin) {
      return NextResponse.json(
        { error: 'Only household admins can update webhooks' },
        { status: 403 }
      )
    }

    // Build update object
    const updates: Record<string, unknown> = {}
    if (body.url !== undefined) {
      // Validate URL format (with SSRF protection)
      const urlValidation = validateWebhookUrl(body.url)
      if (!urlValidation.valid) {
        return NextResponse.json(
          { error: urlValidation.error },
          { status: 400 }
        )
      }
      updates.url = urlValidation.url.toString()
    }
    if (body.events !== undefined) {
      const eventsError = validateWebhookEvents(body.events)
      if (eventsError) {
        return NextResponse.json(
          { error: eventsError },
          { status: 400 }
        )
      }
      updates.events = body.events
    }
    if (body.name !== undefined) {
      updates.name = body.name?.trim() || null
    }
    if (body.disabled !== undefined) {
      updates.disabled_at = body.disabled ? new Date().toISOString() : null
      if (!body.disabled) {
        updates.failure_count = 0  // Reset failure count on re-enable
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      )
    }

    // Update webhook
    const { data: webhook, error } = await supabase
      .from('household_webhooks')
      .update(updates)
      .eq('id', webhookId)
      .eq('household_id', membership.household_id)
      .select('id, url, events, name, created_at, last_triggered_at, last_status, failure_count, disabled_at')
      .single()

    if (error) {
      console.error('Failed to update webhook:', error)
      return NextResponse.json(
        { error: 'Failed to update webhook' },
        { status: 500 }
      )
    }

    if (!webhook) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: webhook })
  } catch (error) {
    console.error('Webhooks PATCH error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/family/webhooks
 *
 * Query params:
 * - id: UUID of the webhook to delete
 *
 * Returns: Success status
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Get webhook ID from query
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('id')

    const uuidError = validateUUID(webhookId, 'id')
    if (uuidError) {
      return NextResponse.json(
        { error: uuidError },
        { status: 400 }
      )
    }

    // Check admin status
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id, is_household_admin')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'No household found' },
        { status: 404 }
      )
    }

    if (!membership.is_household_admin) {
      return NextResponse.json(
        { error: 'Only household admins can delete webhooks' },
        { status: 403 }
      )
    }

    // Delete webhook
    const { error } = await supabase
      .from('household_webhooks')
      .delete()
      .eq('id', webhookId)
      .eq('household_id', membership.household_id)

    if (error) {
      console.error('Failed to delete webhook:', error)
      return NextResponse.json(
        { error: 'Failed to delete webhook' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data: { deleted: true } })
  } catch (error) {
    console.error('Webhooks DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
