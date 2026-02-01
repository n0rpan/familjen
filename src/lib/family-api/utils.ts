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

let serviceClient: SupabaseClient | null = null

/**
 * Get a Supabase service client with service role key
 * Bypasses RLS for admin operations
 */
export function getServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration')
  }

  serviceClient = createClient(supabaseUrl, serviceRoleKey)
  return serviceClient
}

// ============================================================================
// SSRF Protection
// ============================================================================

// Private IP ranges (RFC 1918 + RFC 5737 + loopback + link-local)
const PRIVATE_IP_PATTERNS = [
  // IPv4 private ranges
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,              // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
  /^192\.168\.\d{1,3}\.\d{1,3}$/,                 // 192.168.0.0/16
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,            // 127.0.0.0/8 (loopback)
  /^169\.254\.\d{1,3}\.\d{1,3}$/,                 // 169.254.0.0/16 (link-local)
  /^0\.0\.0\.0$/,                                  // 0.0.0.0
  // Cloud metadata endpoints
  /^169\.254\.169\.254$/,                          // AWS/GCP/Azure metadata
]

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

  // Check IPv4 private ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true
    }
  }

  // Check IPv6 loopback
  if (hostname === '::1' || hostname === '[::1]') {
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

  // Only allow HTTP(S)
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { valid: false, error: 'URL must use http:// or https://' }
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

  // Block non-standard ports that might be internal services
  // Allow 80, 443, and high ports (8000-9999 often used for web services)
  const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80)
  if (port < 80 || (port > 443 && port < 8000) || port > 9999) {
    // Allow common webhook ports
    if (![80, 443, 8080, 8443, 3000].includes(port)) {
      return {
        valid: false,
        error: `Port ${port} is not allowed for webhook URLs`
      }
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
