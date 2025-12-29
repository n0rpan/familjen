/**
 * Sanitization utilities for external data
 *
 * Used to validate and clean data from external APIs before storing in the database.
 */

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 */
export function truncate(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (str.length === 0) return null
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 3) + '...'
}

/**
 * Sanitize a string by trimming whitespace and removing null characters.
 */
export function sanitizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const str = String(value)
    .trim()
    .replace(/\0/g, '') // Remove null characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Remove control characters except newlines/tabs
  if (str.length === 0) return null
  return str
}

/**
 * Validate and sanitize a date string (YYYY-MM-DD format).
 */
export function sanitizeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null

  // Parse and validate it's a real date (not a rollover like Feb 30 -> Mar 1)
  const [year, month, day] = str.split('-').map(Number)
  const date = new Date(year, month - 1, day) // month is 0-indexed

  // Check that the date didn't roll over (e.g., Feb 30 -> Mar 1)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  return str
}

/**
 * Validate and sanitize a time string (HH:MM or HH:MM:SS format).
 */
export function sanitizeTime(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(str)) return null
  const [hours, minutes] = str.split(':').map(Number)
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return str
}

/**
 * Validate URL to prevent SSRF attacks.
 * Blocks internal IPs, localhost, and cloud metadata endpoints.
 */
export function isUrlAllowed(urlString: string): boolean {
  try {
    const url = new URL(urlString)

    // Only allow http/https
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false
    }

    const hostname = url.hostname.toLowerCase()

    // Block localhost variations
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return false
    }

    // Block private IP ranges and cloud metadata
    const blockedPatterns = [
      /^127\./, // Loopback
      /^10\./, // Private Class A
      /^172\.(1[6-9]|2\d|3[01])\./, // Private Class B
      /^192\.168\./, // Private Class C
      /^169\.254\./, // Link-local / Cloud metadata
      /^0\./, // Invalid
      /^fc00:/, // IPv6 private
      /^fe80:/, // IPv6 link-local
    ]

    if (blockedPatterns.some(p => p.test(hostname))) {
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Sanitize user input to prevent prompt injection attacks in AI prompts.
 * - Removes newlines, tabs, and control characters
 * - Collapses multiple spaces
 * - Removes brackets and backticks that could be injection markers
 * - Limits length
 */
export function sanitizePromptInput(input: string, maxLength = 100): string {
  if (!input) return ''
  return input
    .replace(/[\r\n\t]/g, ' ')           // Remove newlines/tabs
    .replace(/\s+/g, ' ')                 // Collapse whitespace
    .replace(/[<>{}[\]`]/g, '')           // Remove brackets and backticks that could be injection markers
    .slice(0, maxLength)                  // Limit length
    .trim()
}

/**
 * Sanitize an array of strings for AI prompts (e.g., allergies list).
 * Filters out empty items after sanitization.
 */
export function sanitizePromptArray(items: string[], maxItemLength = 50): string[] {
  return items
    .map(item => sanitizePromptInput(item, maxItemLength))
    .filter(item => item.length > 0)
}
