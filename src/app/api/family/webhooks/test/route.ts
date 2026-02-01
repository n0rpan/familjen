/**
 * Family API: Webhook Test
 *
 * POST /api/family/webhooks/test - Send a test event to a webhook
 *
 * Authentication: Session-based (not API key)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createHmac, randomUUID } from 'crypto'
import { validateUUID } from '@/lib/family-api'

const WEBHOOK_TIMEOUT_MS = 5000

/**
 * POST /api/family/webhooks/test
 *
 * Query params:
 * - id: UUID of the webhook to test
 *
 * Returns: Test result with status and any error
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

    // Get webhook ID from query
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('id')

    // Validate webhook ID
    const uuidError = validateUUID(webhookId, 'id')
    if (uuidError) {
      return NextResponse.json(
        { error: uuidError },
        { status: 400 }
      )
    }

    // Check membership
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

    // Only household admins can test webhooks
    if (!membership.is_household_admin) {
      return NextResponse.json(
        { error: 'Only household admins can test webhooks' },
        { status: 403 }
      )
    }

    // Get webhook details (need secret for signing)
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: webhookData } = await serviceClient
      .from('household_webhooks')
      .select('id, url, secret_encrypted, events')
      .eq('id', webhookId)
      .eq('household_id', membership.household_id)
      .single()

    if (!webhookData) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      )
    }

    // Decrypt secret
    const { data: secret } = await serviceClient.rpc('decrypt_token', {
      ciphertext: webhookData.secret_encrypted,
    })

    // Security: Validate secret is valid lowercase hex and correct length
    // Webhook secrets are 32 bytes hex-encoded = 64 lowercase hex characters
    // Only accept lowercase to match database output (encode(..., 'hex') produces lowercase)
    // This ensures HMAC consistency between test and production
    const HEX_64_REGEX = /^[0-9a-f]{64}$/
    if (!secret || typeof secret !== 'string' || !HEX_64_REGEX.test(secret)) {
      console.error(`Webhook ${webhookId} has invalid secret (length: ${secret?.length || 0}, expected 64 lowercase hex chars)`)
      return NextResponse.json(
        { error: 'Webhook secret is invalid - please delete and recreate the webhook' },
        { status: 500 }
      )
    }

    // Build test payload
    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      household_id: membership.household_id,
      data: {
        message: 'This is a test webhook from Familjen',
        webhook_id: webhookId,
        events_subscribed: webhookData.events,
      },
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const deliveryId = randomUUID()  // Match production format
    const payloadJson = JSON.stringify(testPayload)
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${payloadJson}`)
      .digest('hex')

    // Send test webhook
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

    try {
      const response = await fetch(webhookData.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Familjen-Signature': `sha256=${signature}`,
          'X-Familjen-Timestamp': String(timestamp),
          'X-Familjen-Event': 'test',
          'X-Familjen-Delivery': deliveryId,
          'X-Familjen-Retry': '0',  // Test is always first attempt
          'User-Agent': 'Familjen-Webhook/1.0',
        },
        body: payloadJson,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Security: Don't return response body - could leak internal data
      // if user misconfigured the webhook URL
      return NextResponse.json({
        data: {
          success: response.ok,
          status: response.status,
          statusText: response.statusText,
          // Note: Response body intentionally not included for security
        },
      })
    } catch (err) {
      clearTimeout(timeoutId)
      const error = err instanceof Error ? err.message : 'Unknown error'

      return NextResponse.json({
        data: {
          success: false,
          error: error.includes('abort') ? 'Request timed out (5s)' : error,
        },
      })
    }
  } catch (error) {
    console.error('Webhook test error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
