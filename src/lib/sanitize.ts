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
  // Validate it's a real date
  const date = new Date(str)
  if (isNaN(date.getTime())) return null
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
 * Validate and sanitize a URL string.
 */
export function sanitizeUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  try {
    const url = new URL(str)
    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return str
  } catch {
    return null
  }
}

/**
 * Sanitize external data fields with appropriate length limits.
 */
export interface ExternalEventInput {
  title?: unknown
  description?: unknown
  location?: unknown
  event_date?: unknown
  end_date?: unknown
  event_time?: unknown
  end_time?: unknown
}

export interface SanitizedExternalEvent {
  title: string | null
  description: string | null
  location: string | null
  event_date: string | null
  end_date: string | null
  event_time: string | null
  end_time: string | null
}

export function sanitizeExternalEvent(input: ExternalEventInput): SanitizedExternalEvent {
  return {
    title: truncate(sanitizeString(input.title), 200),
    description: truncate(sanitizeString(input.description), 2000),
    location: truncate(sanitizeString(input.location), 500),
    event_date: sanitizeDate(input.event_date),
    end_date: sanitizeDate(input.end_date),
    event_time: sanitizeTime(input.event_time),
    end_time: sanitizeTime(input.end_time),
  }
}

export interface ExternalMessageInput {
  title?: unknown
  body?: unknown
  sender_name?: unknown
  message_date?: unknown
}

export interface SanitizedExternalMessage {
  title: string | null
  body: string | null
  sender_name: string | null
  message_date: string | null
}

export function sanitizeExternalMessage(input: ExternalMessageInput): SanitizedExternalMessage {
  return {
    title: truncate(sanitizeString(input.title), 200),
    body: truncate(sanitizeString(input.body), 50000), // Allow longer message bodies
    sender_name: truncate(sanitizeString(input.sender_name), 100),
    message_date: input.message_date ? String(input.message_date) : null, // Dates are already validated elsewhere
  }
}
