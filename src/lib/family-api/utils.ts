/**
 * Family API - Shared Utilities
 *
 * Common utilities for Family API endpoints including:
 * - SSRF-safe URL validation
 * - Shared Supabase service client
 * - Date validation
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// Supabase Service Client
// ============================================================================

/**
 * Create a fresh Supabase service client for each request
 * This avoids connection pooling issues in serverless environments
 */
export function getServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration')
  }

  // Create fresh client per request - Supabase JS client handles
  // connection pooling internally and is designed for this pattern
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

// ============================================================================
// SSRF Protection
// ============================================================================

// Blocked hostnames
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',       // GCP metadata
  'metadata.internal',              // Cloud metadata
  '169.254.169.254',               // Cloud metadata IP
])

/**
 * Parse an IP address (handles decimal, hex, and octal formats)
 * Returns null if not a valid IP
 */
function parseIPv4(hostname: string): number[] | null {
  // Handle decimal IP (e.g., 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    const num = parseInt(hostname, 10)
    if (num >= 0 && num <= 0xFFFFFFFF) {
      return [
        (num >> 24) & 0xFF,
        (num >> 16) & 0xFF,
        (num >> 8) & 0xFF,
        num & 0xFF,
      ]
    }
  }

  // Handle hex IP (e.g., 0x7f000001 = 127.0.0.1)
  if (/^0x[0-9a-fA-F]+$/.test(hostname)) {
    const num = parseInt(hostname, 16)
    if (num >= 0 && num <= 0xFFFFFFFF) {
      return [
        (num >> 24) & 0xFF,
        (num >> 16) & 0xFF,
        (num >> 8) & 0xFF,
        num & 0xFF,
      ]
    }
  }

  // Handle dotted notation (may contain hex/octal octets)
  const parts = hostname.split('.')
  if (parts.length === 4) {
    const octets: number[] = []
    for (const part of parts) {
      let num: number
      if (part.startsWith('0x') || part.startsWith('0X')) {
        num = parseInt(part, 16)
      } else if (part.startsWith('0') && part.length > 1) {
        num = parseInt(part, 8) // Octal
      } else {
        num = parseInt(part, 10)
      }
      if (isNaN(num) || num < 0 || num > 255) return null
      octets.push(num)
    }
    return octets
  }

  return null
}

/**
 * Check if an IP (as octets) is in a private range
 */
function isPrivateIPv4(octets: number[]): boolean {
  const [a, b, c, d] = octets

  // 10.0.0.0/8
  if (a === 10) return true

  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true

  // 192.168.0.0/16
  if (a === 192 && b === 168) return true

  // 127.0.0.0/8 (loopback)
  if (a === 127) return true

  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true

  // 0.0.0.0
  if (a === 0 && b === 0 && c === 0 && d === 0) return true

  return false
}

/**
 * Check if a hostname or IP is private/internal
 */
function isPrivateHost(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase()

  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.has(lowerHost)) {
    return true
  }

  // Check if it ends with local TLDs
  if (lowerHost.endsWith('.local') ||
      lowerHost.endsWith('.internal') ||
      lowerHost.endsWith('.localhost')) {
    return true
  }

  // Strip brackets from IPv6
  const cleanHost = lowerHost.replace(/^\[|\]$/g, '')

  // Check IPv6 loopback and mapped addresses
  if (cleanHost === '::1') return true
  if (cleanHost === '::') return true

  // IPv6 mapped IPv4 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (cleanHost.startsWith('::ffff:')) {
    const v4part = cleanHost.substring(7)
    // Try parsing as IPv4
    const octets = parseIPv4(v4part)
    if (octets && isPrivateIPv4(octets)) return true

    // Handle hex format (::ffff:7f00:0001)
    const hexParts = v4part.split(':')
    if (hexParts.length === 2) {
      const high = parseInt(hexParts[0], 16)
      const low = parseInt(hexParts[1], 16)
      if (!isNaN(high) && !isNaN(low)) {
        const octets = [(high >> 8) & 0xFF, high & 0xFF, (low >> 8) & 0xFF, low & 0xFF]
        if (isPrivateIPv4(octets)) return true
      }
    }
  }

  // Try parsing hostname as various IP formats
  const octets = parseIPv4(hostname)
  if (octets && isPrivateIPv4(octets)) {
    return true
  }

  return false
}

export type UrlValidationResult =
  | { valid: true; url: URL }
  | { valid: false; error: string }

/**
 * Validate a webhook URL for SSRF protection
 *
 * Blocks:
 * - Non-HTTP(S) protocols
 * - Private/internal IP addresses
 * - Cloud metadata endpoints
 * - Localhost and local domain names
 *
 * @param urlString - The URL string to validate
 * @returns Validation result with parsed URL or error
 */
export function validateWebhookUrl(urlString: string): UrlValidationResult {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'URL is required' }
  }

  let url: URL
  try {
    url = new URL(urlString.trim())
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  // Only allow HTTPS (HTTP would expose webhook secrets in transit)
  if (url.protocol !== 'https:') {
    return { valid: false, error: 'Webhook URLs must use https:// to protect signing secrets' }
  }

  // Check for private/internal hosts
  if (isPrivateHost(url.hostname)) {
    return {
      valid: false,
      error: 'Webhook URLs cannot point to private or internal addresses'
    }
  }

  // Block URLs with authentication (user:pass@host)
  if (url.username || url.password) {
    return {
      valid: false,
      error: 'Webhook URLs cannot contain authentication credentials'
    }
  }

  // Explicit whitelist of allowed ports (HTTPS only, so no port 80)
  const ALLOWED_PORTS = new Set([443, 3000, 8000, 8080, 8443])
  const port = url.port ? parseInt(url.port, 10) : 443 // HTTPS default
  if (!ALLOWED_PORTS.has(port)) {
    return {
      valid: false,
      error: `Port ${port} is not allowed. Allowed ports: 443, 3000, 8000, 8080, 8443`
    }
  }

  return { valid: true, url }
}

// ============================================================================
// Date Validation
// ============================================================================

/**
 * Validate a date string in YYYY-MM-DD format
 *
 * @param dateStr - The date string to validate
 * @returns true if valid, false otherwise
 */
export function isValidDate(dateStr: string): boolean {
  // First check format with regex
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false
  }

  // Parse and validate
  const [year, month, day] = dateStr.split('-').map(Number)

  // Check year is reasonable (1900-2100)
  if (year < 1900 || year > 2100) {
    return false
  }

  // Check month is valid
  if (month < 1 || month > 12) {
    return false
  }

  // Check day is valid for the month
  const daysInMonth = new Date(year, month, 0).getDate()
  if (day < 1 || day > daysInMonth) {
    return false
  }

  // Create date and verify it matches (catches edge cases)
  const date = new Date(dateStr)
  return !isNaN(date.getTime()) &&
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
}

/**
 * Validate date and return error message if invalid
 */
export function validateDateParam(dateStr: string, paramName = 'date'): string | null {
  if (!isValidDate(dateStr)) {
    return `Invalid ${paramName} format. Use YYYY-MM-DD with valid date values`
  }
  return null
}

// ============================================================================
// Date Range Limits
// ============================================================================

/** Maximum days allowed in a single date range query */
export const MAX_DATE_RANGE_DAYS = 90

/**
 * Validate a date range doesn't exceed maximum allowed days
 * Returns error message if invalid, null if valid
 */
export function validateDateRange(fromDate: string, toDate: string): string | null {
  const from = new Date(fromDate)
  const to = new Date(toDate)

  if (to < from) {
    return 'to date must be after from date'
  }

  const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays > MAX_DATE_RANGE_DAYS) {
    return `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days. Requested: ${diffDays} days`
  }

  return null
}

// ============================================================================
// Audit Logging
// ============================================================================

export interface AuditLogParams {
  keyId: string
  householdId: string
  operation: 'read' | 'write'
  endpoint: string
  method: string
  request: Request
}

/**
 * Generate a unique request ID for audit correlation
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Log an API access event to the audit log
 * This is fire-and-forget to not slow down API responses
 */
export async function logApiAccess(params: AuditLogParams): Promise<void> {
  const { keyId, householdId, operation, endpoint, method, request } = params

  try {
    const supabase = getServiceClient()
    const requestId = generateRequestId()

    // Extract headers (safely)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') ||
               null
    const userAgent = request.headers.get('user-agent')

    await supabase.rpc('log_api_access', {
      p_key_id: keyId,
      p_household_id: householdId,
      p_operation: operation,
      p_endpoint: endpoint,
      p_method: method,
      p_ip_address: ip,
      p_user_agent: userAgent,
      p_request_id: requestId,
    })
  } catch (err) {
    // Don't let audit logging failures break API responses
    console.error('Failed to log API access:', err)
  }
}

// ============================================================================
// Input Validation
// ============================================================================

/** Maximum length for API key and webhook names */
export const MAX_NAME_LENGTH = 100

/** Maximum length for webhook URLs */
export const MAX_URL_LENGTH = 2000

/**
 * Validate a name field (API key name, webhook name)
 */
export function validateName(name: string | undefined, fieldName = 'name'): string | null {
  if (!name || name.trim().length === 0) {
    return `${fieldName} is required`
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `${fieldName} must be ${MAX_NAME_LENGTH} characters or less`
  }
  return null
}

// ============================================================================
// Webhook Event Type Validation
// ============================================================================

/**
 * Valid webhook event types
 * Currently only pickup events are implemented.
 * Meal, task, and event webhooks are defined for future use.
 */
export const VALID_WEBHOOK_EVENTS = new Set([
  // Currently implemented
  'pickup.created',
  'pickup.updated',
  'pickup.deleted',
  // Defined for future use (endpoints not yet implemented)
  'meal.planned',
  'meal.updated',
  'meal.deleted',
  'task.created',
  'task.completed',
  'task.deleted',
  'event.created',
  'event.updated',
  'event.deleted',
])

/**
 * Webhook events that are currently dispatched (have working endpoints)
 */
export const IMPLEMENTED_WEBHOOK_EVENTS = new Set([
  'pickup.created',
  'pickup.updated',
  'pickup.deleted',
])

/**
 * Validate webhook event types
 * Only accepts currently implemented events to avoid confusion
 * Returns error message if invalid, null if valid
 */
export function validateWebhookEvents(events: string[]): string | null {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return 'events array is required and must not be empty'
  }

  // Only allow events that are actually implemented
  const invalidEvents = events.filter(e => !IMPLEMENTED_WEBHOOK_EVENTS.has(e))
  if (invalidEvents.length > 0) {
    return `Invalid or unimplemented event types: ${invalidEvents.join(', ')}. Currently available: ${Array.from(IMPLEMENTED_WEBHOOK_EVENTS).join(', ')}`
  }

  return null
}

// ============================================================================
// API Key Scope Validation
// ============================================================================

/**
 * Valid API key scopes
 */
export const VALID_API_SCOPES = new Set([
  'pickups:read',
  'pickups:write',
  'meals:read',
  'meals:write',
  'tasks:read',
  'tasks:write',
  'events:read',
  'events:write',
  'children:read',
  'members:read',
])

/**
 * Validate API key scopes
 * Returns error message if invalid, null if valid
 */
export function validateApiScopes(scopes: string[]): string | null {
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return 'At least one scope is required'
  }

  const invalidScopes = scopes.filter(s => !VALID_API_SCOPES.has(s))
  if (invalidScopes.length > 0) {
    return `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${Array.from(VALID_API_SCOPES).join(', ')}`
  }

  return null
}

// ============================================================================
// UUID Validation
// ============================================================================

/** UUID v4 regex pattern */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Validate a UUID format
 * Returns true if valid UUID, false otherwise
 */
export function isValidUUID(uuid: string): boolean {
  return UUID_REGEX.test(uuid)
}

/**
 * Validate UUID and return error message if invalid
 */
export function validateUUID(uuid: string | null | undefined, fieldName = 'id'): string | null {
  if (!uuid) {
    return `${fieldName} is required`
  }
  if (!isValidUUID(uuid)) {
    return `${fieldName} must be a valid UUID`
  }
  return null
}

// ============================================================================
// Notes Field Validation
// ============================================================================

/** Maximum length for notes fields */
export const MAX_NOTES_LENGTH = 1000

/**
 * Validate notes field length
 * Returns error message if too long, null if valid
 */
export function validateNotes(notes: string | null | undefined): string | null {
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    return `notes must be ${MAX_NOTES_LENGTH} characters or less`
  }
  return null
}
