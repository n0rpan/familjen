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
import { createHmac } from 'crypto'

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

    if (!webhookId) {
      return NextResponse.json(
        { error: 'id query parameter is required' },
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

    // Security: Validate secret is not empty or too short
    // Empty string would pass truthiness check but create insecure HMAC
    if (!secret || typeof secret !== 'string' || secret.length < 32) {
      console.error(`Webhook ${webhookId} has invalid secret (length: ${secret?.length || 0})`)
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
    const deliveryId = `whd_test_${Date.now().toString(36)}`
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
          'X-Familjen-Delivery': deliveryId,  // Idempotency header
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
