/**
 * Standardized API error responses.
 *
 * Goals:
 * 1. Norwegian user-facing messages that help users self-serve
 * 2. Error codes for debugging (logged server-side, not exposed to users)
 * 3. Consistent response format across all API routes
 * 4. Never leak internal error details to users
 */

import { NextResponse } from 'next/server'

/**
 * Error categories and their user-facing behaviors:
 * - auth: User can fix (log in again)
 * - forbidden: User needs different permissions
 * - notFound: Resource doesn't exist
 * - validation: User input is invalid
 * - rateLimit: Too many requests
 * - config: System configuration issue
 * - internal: Unexpected server error
 */
export type ErrorCategory =
  | 'auth'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'rateLimit'
  | 'config'
  | 'internal'

export interface ApiErrorOptions {
  /** Optional hint for the user on how to fix the issue */
  hint?: string
  /** Optional field name for validation errors */
  field?: string
  /** Retry-After header value in seconds (for rate limit) */
  retryAfter?: number
  /** Internal error message for logging (never sent to client) */
  internalMessage?: string
}

/**
 * Standard error response shape.
 * The `code` field helps frontend display appropriate UI.
 */
export interface ErrorResponse {
  error: string
  code: ErrorCategory
  hint?: string
  field?: string
}

/**
 * Create a standardized error response.
 */
function createErrorResponse(
  category: ErrorCategory,
  message: string,
  status: number,
  options: ApiErrorOptions = {}
): NextResponse<ErrorResponse> {
  // Log internal details server-side
  if (options.internalMessage) {
    console.error(`[ApiError:${category}] ${options.internalMessage}`)
  }

  const body: ErrorResponse = {
    error: message,
    code: category,
  }

  if (options.hint) {
    body.hint = options.hint
  }

  if (options.field) {
    body.field = options.field
  }

  const headers: Record<string, string> = {}
  if (options.retryAfter) {
    headers['Retry-After'] = String(options.retryAfter)
  }

  return NextResponse.json(body, { status, headers })
}

/**
 * Standardized API error helpers.
 *
 * @example
 * ```typescript
 * // In an API route:
 * if (!user) {
 *   return ApiErrors.unauthorized()
 * }
 *
 * if (!isAdmin) {
 *   return ApiErrors.forbidden()
 * }
 *
 * if (!data) {
 *   return ApiErrors.notFound('Husstanden')
 * }
 *
 * // For validation errors
 * if (!email) {
 *   return ApiErrors.validation('E-post er påkrevd', { field: 'email' })
 * }
 *
 * // For internal errors (log details, show generic message)
 * catch (error) {
 *   return ApiErrors.internal({ internalMessage: String(error) })
 * }
 * ```
 */
export const ApiErrors = {
  /**
   * 401 - User needs to log in.
   * User action: Re-authenticate.
   */
  unauthorized(options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'auth',
      'Du må logge inn på nytt',
      401,
      {
        hint: 'Prøv å laste siden på nytt eller logg inn igjen',
        ...options,
      }
    )
  },

  /**
   * 403 - User is logged in but doesn't have permission.
   * User action: Contact admin or check they're in the right household.
   */
  forbidden(options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'forbidden',
      'Du har ikke tilgang til dette',
      403,
      {
        hint: 'Sjekk at du er logget inn med riktig konto',
        ...options,
      }
    )
  },

  /**
   * 403 - Admin access required.
   * User action: Contact system admin.
   */
  adminRequired(options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'forbidden',
      'Denne funksjonen krever administratortilgang',
      403,
      {
        hint: 'Kontakt en administrator hvis du trenger tilgang',
        ...options,
      }
    )
  },

  /**
   * 403 - Invalid origin (CSRF protection).
   * User action: Refresh page, clear cache.
   */
  invalidOrigin(options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'forbidden',
      'Forespørselen ble blokkert av sikkerhetsgrunner',
      403,
      {
        hint: 'Prøv å laste siden på nytt',
        ...options,
      }
    )
  },

  /**
   * 404 - Resource not found.
   * User action: Check URL, refresh, or the item may have been deleted.
   * @param resourceName - Optional name of what wasn't found (e.g., "Husstanden", "Oppskriften")
   */
  notFound(resourceName?: string, options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    const message = resourceName
      ? `${resourceName} ble ikke funnet`
      : 'Fant ikke det du lette etter'

    return createErrorResponse(
      'notFound',
      message,
      404,
      {
        hint: 'Elementet kan ha blitt slettet eller flyttet',
        ...options,
      }
    )
  },

  /**
   * 400 - Validation error.
   * User action: Fix the input and try again.
   * @param message - Specific validation message
   */
  validation(message: string, options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'validation',
      message,
      400,
      {
        hint: 'Sjekk at alle felt er fylt ut riktig',
        ...options,
      }
    )
  },

  /**
   * 429 - Rate limit exceeded.
   * User action: Wait and try again.
   * @param retryAfter - Seconds until they can retry
   */
  rateLimit(retryAfter: number, options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'rateLimit',
      `For mange forespørsler. Prøv igjen om ${retryAfter} sekunder`,
      429,
      {
        retryAfter,
        ...options,
      }
    )
  },

  /**
   * 500 - Configuration error (API keys, etc).
   * User action: Contact admin.
   */
  configError(options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'config',
      'Tjenesten er ikke riktig konfigurert',
      500,
      {
        hint: 'Kontakt administrator for hjelp',
        ...options,
      }
    )
  },

  /**
   * 500 - Internal server error.
   * User action: Try again later, contact support if persistent.
   *
   * IMPORTANT: Always pass the actual error to internalMessage for logging.
   * The user will only see a generic message.
   */
  internal(options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'internal',
      'Noe gikk galt. Prøv igjen senere',
      500,
      {
        hint: 'Hvis problemet vedvarer, kontakt support',
        ...options,
      }
    )
  },

  /**
   * 504 - Request timeout.
   * User action: Try again, perhaps with a simpler request.
   */
  timeout(options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'internal',
      'Forespørselen tok for lang tid',
      504,
      {
        hint: 'Prøv igjen. Hvis det fortsetter, prøv med mindre data',
        ...options,
      }
    )
  },

  /**
   * Authentication failed for external service (Spond, Kidplan, etc).
   * User action: Update their credentials.
   * @param serviceName - Name of the service (e.g., "Spond", "Kidplan")
   */
  authFailed(serviceName: string, options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'auth',
      `Kunne ikke logge inn på ${serviceName}`,
      401,
      {
        hint: 'Sjekk at brukernavn og passord er riktig',
        ...options,
      }
    )
  },

  /**
   * 503 - External service unavailable.
   * User action: Try again later.
   */
  serviceUnavailable(options?: ApiErrorOptions): NextResponse<ErrorResponse> {
    return createErrorResponse(
      'internal',
      'Tjenesten er midlertidig utilgjengelig',
      503,
      {
        hint: 'Prøv igjen om noen minutter',
        ...options,
      }
    )
  },
}

/**
 * Type-safe error handler for try/catch blocks.
 *
 * @example
 * ```typescript
 * try {
 *   // ... API logic
 * } catch (error) {
 *   return handleApiError(error, 'calendar sync')
 * }
 * ```
 */
export function handleApiError(error: unknown, context: string): NextResponse<ErrorResponse> {
  const message = error instanceof Error ? error.message : String(error)
  return ApiErrors.internal({
    internalMessage: `[${context}] ${message}`,
  })
}
