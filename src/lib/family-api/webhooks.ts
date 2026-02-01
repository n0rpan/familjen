/**
 * Webhook Dispatcher
 *
 * Dispatches events to registered webhooks with HMAC signatures
 * for authentication on the receiving end.
 */

import { createHmac, randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import type { WebhookEventType, WebhookPayload } from '@/lib/types'

// Webhook delivery timeout
const WEBHOOK_TIMEOUT_MS = 5000

// Minimum secret length (security validation)
const MIN_SECRET_LENGTH = 32

// Create a service role client for webhook operations
function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration for webhook dispatch')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

/**
 * Generate a unique delivery ID for idempotency
 * Format: whd_{timestamp}_{uuid} for easy debugging
 */
function generateDeliveryId(): string {
  return `whd_${Date.now().toString(36)}_${randomUUID().substring(0, 8)}`
}

export interface WebhookResult {
  webhookId: string
  deliveryId: string
  url: string
  status: number | null
  error: string | null
  success: boolean
}

/**
 * Generate HMAC signature for webhook payload
 *
 * Format: sha256=<hex_signature>
 * Signed data: <timestamp>.<json_payload>
 */
function generateSignature(
  payload: string,
  timestamp: number,
  secret: string
): string {
  const signedData = `${timestamp}.${payload}`
  const signature = createHmac('sha256', secret)
    .update(signedData)
    .digest('hex')
  return `sha256=${signature}`
}

/**
 * Dispatch a single webhook
 */
async function deliverWebhook(
  webhookId: string,
  url: string,
  secret: string,
  eventType: WebhookEventType,
  payload: WebhookPayload,
  deliveryId: string
): Promise<WebhookResult> {
  // Security: Validate secret is not empty or too short
  // This catches decryption failures or corrupted secrets
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    console.error(`Webhook ${webhookId} has invalid secret (length: ${secret?.length || 0})`)
    return {
      webhookId,
      deliveryId,
      url,
      status: null,
      error: 'Invalid webhook secret - please regenerate webhook',
      success: false,
    }
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const payloadJson = JSON.stringify(payload)
  const signature = generateSignature(payloadJson, timestamp, secret)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Familjen-Signature': signature,
        'X-Familjen-Timestamp': String(timestamp),
        'X-Familjen-Event': eventType,
        'X-Familjen-Delivery': deliveryId,  // Idempotency header
        'User-Agent': 'Familjen-Webhook/1.0',
      },
      body: payloadJson,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    return {
      webhookId,
      deliveryId,
      url,
      status: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
      success: response.ok,
    }
  } catch (err) {
    clearTimeout(timeoutId)
    const error = err instanceof Error ? err.message : 'Unknown error'
    return {
      webhookId,
      deliveryId,
      url,
      status: null,
      error: error.includes('abort') ? 'Timeout' : error,
      success: false,
    }
  }
}

/**
 * Dispatch webhooks for an event
 *
 * Finds all webhooks that match the event type and delivers to each.
 * Records delivery attempts in the database.
 *
 * @param householdId - The household that owns the data
 * @param eventType - The type of event (e.g., 'pickup.updated')
 * @param data - The event data
 * @param previous - Previous state for update events
 * @returns Array of delivery results
 */
export async function dispatchWebhooks<T>(
  householdId: string,
  eventType: WebhookEventType,
  data: T,
  previous?: Partial<T>
): Promise<WebhookResult[]> {
  const supabase = getServiceClient()

  // Get matching webhooks
  const { data: webhooks, error: fetchError } = await supabase.rpc(
    'get_matching_webhooks',
    {
      p_household_id: householdId,
      p_event_type: eventType,
    }
  )

  if (fetchError) {
    console.error('Failed to fetch webhooks:', fetchError)
    return []
  }

  if (!webhooks || webhooks.length === 0) {
    return []
  }

  // Build payload
  const payload: WebhookPayload<T> = {
    event: eventType,
    timestamp: new Date().toISOString(),
    household_id: householdId,
    data,
    ...(previous && { previous }),
  }

  // Deliver to all webhooks in parallel
  const results = await Promise.all(
    webhooks.map(async (webhook: { id: string; url: string; secret: string }) => {
      // Generate delivery ID for idempotency
      const deliveryId = generateDeliveryId()

      const result = await deliverWebhook(
        webhook.id,
        webhook.url,
        webhook.secret,
        eventType,
        payload,
        deliveryId
      )

      // Record delivery in database with delivery ID for idempotency
      try {
        await supabase.rpc('record_webhook_delivery', {
          p_webhook_id: webhook.id,
          p_event_type: eventType,
          p_payload: payload,
          p_status: result.status,
          p_error: result.error,
          p_delivery_id: deliveryId,
        })
      } catch (err) {
        console.error('Failed to record webhook delivery:', err)
      }

      return result
    })
  )

  return results
}

/**
 * Dispatch a single webhook event (convenience wrapper)
 */
export async function dispatchWebhook<T>(
  householdId: string,
  eventType: WebhookEventType,
  data: T,
  previous?: Partial<T>
): Promise<WebhookResult[]> {
  return dispatchWebhooks(householdId, eventType, data, previous)
}

/**
 * Example verification code for webhook receivers
 *
 * ```typescript
 * import { createHmac } from 'crypto'
 *
 * function verifyWebhook(
 *   payload: string,
 *   signature: string,
 *   timestamp: string,
 *   secret: string
 * ): boolean {
 *   // Check timestamp is recent (within 5 minutes)
 *   const ts = parseInt(timestamp, 10)
 *   if (Math.abs(Date.now() / 1000 - ts) > 300) {
 *     return false // Replay attack or clock drift
 *   }
 *
 *   // Verify signature
 *   const expected = createHmac('sha256', secret)
 *     .update(`${timestamp}.${payload}`)
 *     .digest('hex')
 *
 *   return signature === `sha256=${expected}`
 * }
 * ```
 */
