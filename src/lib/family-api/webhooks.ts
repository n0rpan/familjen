/**
 * Webhook Dispatcher
 *
 * Dispatches events to registered webhooks with HMAC signatures
 * for authentication on the receiving end.
 *
 * Security features:
 * - HMAC-SHA256 signatures for payload verification
 * - DNS rebinding protection at DELIVERY TIME:
 *   - Hostname is resolved BEFORE EACH delivery attempt (including retries)
 *   - If DNS resolves to private IP, request is blocked immediately
 *   - This mitigates DNS rebinding attacks where attacker changes DNS between retries
 *   - See checkDNSRebinding() and its call inside the retry loop
 * - Redirect blocking (prevents SSRF via 3xx responses)
 * - Timeout protection (5 second max per attempt)
 * - Private IP blocking (also validated at webhook creation time for fast-fail)
 *
 * SSRF Protection Summary:
 * 1. Creation time: URL validated for private IPs (src/components/settings/FamilyApiSection.tsx)
 * 2. Delivery time: DNS re-resolved before EACH attempt to catch DNS rebinding
 * 3. Fetch time: redirect='error' prevents 3xx redirects to internal URLs
 */

import { createHmac, randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { lookup } from 'dns/promises'
import type { WebhookEventType, WebhookPayload } from '@/lib/types'

// Webhook delivery timeout
const WEBHOOK_TIMEOUT_MS = 5000

// Minimum secret length (security validation)
// Webhook secrets are 32 bytes hex-encoded = 64 characters
const MIN_SECRET_LENGTH = 64

// DNS resolution timeout (must be less than WEBHOOK_TIMEOUT_MS)
const DNS_TIMEOUT_MS = 2000

// Retry configuration
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 1000  // 1 second
const MAX_RETRY_DELAY_MS = 8000      // 8 seconds

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)
  return Math.min(delay, MAX_RETRY_DELAY_MS)
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Check if an IP address is private/internal
 * This protects against DNS rebinding attacks where an attacker's
 * DNS server returns a private IP after initial validation
 */
function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  if (ip.startsWith('10.') ||
      ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') || ip.startsWith('172.20.') || ip.startsWith('172.21.') ||
      ip.startsWith('172.22.') || ip.startsWith('172.23.') || ip.startsWith('172.24.') ||
      ip.startsWith('172.25.') || ip.startsWith('172.26.') || ip.startsWith('172.27.') ||
      ip.startsWith('172.28.') || ip.startsWith('172.29.') || ip.startsWith('172.30.') ||
      ip.startsWith('172.31.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('127.') ||
      ip.startsWith('169.254.') ||  // Link-local
      ip === '0.0.0.0') {
    return true
  }

  // IPv6 private/special ranges
  if (ip === '::1' ||                    // Loopback
      ip.startsWith('fc') ||             // Unique local
      ip.startsWith('fd') ||             // Unique local
      ip.startsWith('fe80:') ||          // Link-local
      ip.startsWith('::ffff:127.') ||    // IPv4-mapped loopback
      ip.startsWith('::ffff:10.') ||     // IPv4-mapped private
      ip.startsWith('::ffff:192.168.') || // IPv4-mapped private
      ip.startsWith('::ffff:172.')) {    // IPv4-mapped private (partial check)
    return true
  }

  return false
}

/**
 * Resolve hostname and check for private IPs (DNS rebinding protection)
 * Returns null if safe, error message if blocked
 *
 * SECURITY NOTE: There is a small TOCTOU (time-of-check-time-of-use) window
 * between DNS validation and the actual HTTP request. To fully eliminate this,
 * we would need DNS pinning (connecting to the resolved IP with Host header).
 * However, Node.js native fetch doesn't support this without custom agents.
 *
 * Mitigations in place:
 * 1. DNS is re-validated before EACH retry attempt (not just once)
 * 2. The window between validation and fetch is microseconds
 * 3. Attacker would need to time DNS change precisely during this window
 * 4. For a family app, this residual risk is acceptable
 *
 * For higher-security applications, consider using:
 * - ssrf-req-filter library
 * - undici with custom DNS resolver
 * - Cloudflare Workers with fetch that supports connect-to
 */
async function checkDNSRebinding(hostname: string): Promise<string | null> {
  try {
    // Resolve with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS)
    })

    const lookupPromise = lookup(hostname, { all: true })
    const addresses = await Promise.race([lookupPromise, timeoutPromise])

    // Check all resolved addresses
    for (const addr of addresses) {
      if (isPrivateIP(addr.address)) {
        return `DNS rebinding detected: ${hostname} resolves to private IP ${addr.address}`
      }
    }

    return null // Safe
  } catch (err) {
    // DNS resolution failed - block the request to be safe
    const message = err instanceof Error ? err.message : 'Unknown error'
    return `DNS resolution failed for ${hostname}: ${message}`
  }
}

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
 * Uses a proper UUID format for database compatibility
 */
function generateDeliveryId(): string {
  return randomUUID()
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
  // Security: Validate secret is valid lowercase hex and correct length
  // Webhook secrets are 32 bytes hex-encoded = 64 lowercase hex characters
  // Only accept lowercase to match database output (encode(..., 'hex') produces lowercase)
  const HEX_64_REGEX = /^[0-9a-f]{64}$/
  if (!secret || !HEX_64_REGEX.test(secret)) {
    console.error(`Webhook ${webhookId} has invalid secret (length: ${secret?.length || 0}, expected 64 lowercase hex chars)`)
    return {
      webhookId,
      deliveryId,
      url,
      status: null,
      error: 'Invalid webhook secret - please regenerate webhook',
      success: false,
    }
  }

  // Parse URL once (URL validation was done at webhook creation time)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch (err) {
    console.error(`Webhook ${webhookId} URL parse error:`, err)
    return {
      webhookId,
      deliveryId,
      url,
      status: null,
      error: 'Invalid webhook URL',
      success: false,
    }
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const payloadJson = JSON.stringify(payload)
  const signature = generateSignature(payloadJson, timestamp, secret)

  // Retry loop with exponential backoff
  let lastError: string = 'Unknown error'
  let lastStatus: number | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Wait before retry (not on first attempt)
    if (attempt > 0) {
      const delay = getRetryDelay(attempt - 1)
      await sleep(delay)
    }

    // SECURITY: DNS rebinding protection - check BEFORE EACH attempt
    // An attacker could change DNS between retries (TOCTOU vulnerability)
    // so we must re-resolve and re-validate on every delivery attempt
    const dnsError = await checkDNSRebinding(parsedUrl.hostname)
    if (dnsError) {
      console.error(`Webhook ${webhookId} blocked on attempt ${attempt}: ${dnsError}`)
      // Don't retry DNS rebinding - it's likely malicious
      return {
        webhookId,
        deliveryId,
        url,
        status: null,
        error: 'Webhook URL blocked for security reasons',
        success: false,
      }
    }

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
          'X-Familjen-Retry': String(attempt),  // Retry count for debugging
          'User-Agent': 'Familjen-Webhook/1.0',
        },
        body: payloadJson,
        signal: controller.signal,
        redirect: 'error',  // SECURITY: Prevent SSRF via redirects to internal URLs
      })

      clearTimeout(timeoutId)
      lastStatus = response.status

      // Success - return immediately
      if (response.ok) {
        return {
          webhookId,
          deliveryId,
          url,
          status: response.status,
          error: null,
          success: true,
        }
      }

      // 4xx errors are client errors - don't retry (except 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return {
          webhookId,
          deliveryId,
          url,
          status: response.status,
          error: `HTTP ${response.status}`,
          success: false,
        }
      }

      // 5xx or 429 - retry
      lastError = `HTTP ${response.status}`
    } catch (err) {
      clearTimeout(timeoutId)
      lastError = err instanceof Error ? err.message : 'Unknown error'
      if (lastError.includes('abort')) {
        lastError = 'Timeout'
      }
      // Network errors - retry
    }
  }

  // All retries exhausted
  return {
    webhookId,
    deliveryId,
    url,
    status: lastStatus,
    error: `${lastError} (after ${MAX_RETRIES + 1} attempts)`,
    success: false,
  }
}

/**
 * Dispatch webhooks for an event
 *
 * Finds all webhooks that match the event type and delivers to each.
 * Records delivery attempts in the database.
 *
 * IMPORTANT: This function is designed to be called fire-and-forget:
 *   dispatchWebhooks(...).catch((err) => console.error(err))
 *
 * The function never throws - all errors are caught and logged internally.
 * This ensures that webhook failures never affect the main request flow.
 *
 * @param householdId - The household that owns the data
 * @param eventType - The type of event (e.g., 'pickup.updated')
 * @param data - The event data
 * @param previous - Previous state for update events
 * @returns Array of delivery results (empty array on any error)
 */
export async function dispatchWebhooks<T>(
  householdId: string,
  eventType: WebhookEventType,
  data: T,
  previous?: Partial<T>
): Promise<WebhookResult[]> {
  // SAFETY: Wrap entire function in try-catch to ensure fire-and-forget safety
  // Even if getServiceClient() throws (missing env vars), we return empty array
  try {
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

        // Normalize secret to lowercase (defense-in-depth)
        // PostgreSQL encode(..., 'hex') produces lowercase, but we normalize as safety measure
        const normalizedSecret = webhook.secret?.toLowerCase() ?? ''

        const result = await deliverWebhook(
          webhook.id,
          webhook.url,
          normalizedSecret,
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
  } catch (err) {
    // SAFETY: Catch any unexpected error (e.g., missing env vars, network issues)
    // Log the error but don't throw - webhook failures must not affect main flow
    console.error('Webhook dispatch error (non-fatal):', err)
    return []
  }
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
