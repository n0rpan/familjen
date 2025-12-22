/**
 * Centralized app configuration
 * Single source of truth for constants used across the app
 */

export const APP_CONFIG = {
  // App metadata
  APP_NAME: 'Familjen',

  // Feature flags
  ENABLE_AI_SUGGESTIONS: true,
} as const

/**
 * Check if user is admin via JWT app_metadata
 * This is set during login from allowed_emails.is_admin
 * Works in API routes and server components
 */
export function isUserAdmin(user: { app_metadata?: Record<string, unknown> } | null): boolean {
  return user?.app_metadata?.is_admin === true
}

/**
 * Validate request origin for CSRF protection on mutation endpoints
 * Returns true if origin is valid (same-site request)
 */
export function validateOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  // In development, be more lenient
  if (process.env.NODE_ENV === 'development') {
    return true
  }

  // Get expected host from request URL
  const requestUrl = new URL(request.url)
  const expectedHost = requestUrl.host

  // Check origin header (preferred)
  if (origin) {
    try {
      const originUrl = new URL(origin)
      return originUrl.host === expectedHost
    } catch {
      return false
    }
  }

  // Fallback to referer header
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      return refererUrl.host === expectedHost
    } catch {
      return false
    }
  }

  // No origin or referer - reject for safety
  return false
}

/**
 * Validate Content-Type header for JSON API endpoints
 * Returns true if Content-Type is application/json (with optional charset)
 */
export function validateContentType(request: Request): boolean {
  const contentType = request.headers.get('content-type')
  if (!contentType) return false

  // Allow application/json with optional charset or other parameters
  const mediaType = contentType.split(';')[0].trim().toLowerCase()
  return mediaType === 'application/json'
}

/**
 * Combined validation for POST/PUT/PATCH API routes
 * Validates both origin (CSRF) and content-type
 */
export function validateMutationRequest(request: Request): { valid: boolean; error?: string } {
  if (!validateOrigin(request)) {
    return { valid: false, error: 'Invalid origin' }
  }

  if (!validateContentType(request)) {
    return { valid: false, error: 'Invalid Content-Type. Expected application/json' }
  }

  return { valid: true }
}
