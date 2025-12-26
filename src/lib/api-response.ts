/**
 * Standardized API response helpers.
 * Use these to ensure consistent error handling across all API routes.
 */
import { NextResponse } from 'next/server'

/**
 * Error response type
 */
interface ApiError {
  error: string
  code?: string
  details?: string
}

/**
 * Standard error codes
 */
export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  AUTH_FAILED: 'AUTH_FAILED',
} as const

/**
 * Create a standardized error response.
 * Never exposes internal error details to clients in production.
 */
export function apiError(
  message: string,
  status: number,
  options?: {
    code?: string
    details?: string // Only included in development
    logError?: Error | unknown
  }
): NextResponse<ApiError> {
  // Log the full error server-side
  if (options?.logError) {
    console.error(`[API Error] ${message}:`, options.logError)
  }

  const response: ApiError = {
    error: message,
  }

  if (options?.code) {
    response.code = options.code
  }

  // Only include details in development for debugging
  if (options?.details && process.env.NODE_ENV === 'development') {
    response.details = options.details
  }

  return NextResponse.json(response, { status })
}

/**
 * Common error responses
 */
export const ApiErrors = {
  unauthorized: (details?: string) =>
    apiError('Unauthorized', 401, { code: ErrorCodes.UNAUTHORIZED, details }),

  forbidden: (details?: string) =>
    apiError('Forbidden', 403, { code: ErrorCodes.FORBIDDEN, details }),

  notFound: (resource = 'Resource') =>
    apiError(`${resource} not found`, 404, { code: ErrorCodes.NOT_FOUND }),

  validationError: (message: string) =>
    apiError(message, 400, { code: ErrorCodes.VALIDATION_ERROR }),

  rateLimited: (retryAfter?: number) => {
    const response = apiError('Rate limit exceeded', 429, { code: ErrorCodes.RATE_LIMITED })
    if (retryAfter) {
      response.headers.set('Retry-After', String(retryAfter))
    }
    return response
  },

  internalError: (logError?: Error | unknown) =>
    apiError('An unexpected error occurred', 500, {
      code: ErrorCodes.INTERNAL_ERROR,
      logError,
    }),

  externalServiceError: (service: string, logError?: Error | unknown) =>
    apiError(`Failed to connect to ${service}`, 502, {
      code: ErrorCodes.EXTERNAL_SERVICE_ERROR,
      logError,
    }),

  authFailed: (service?: string) =>
    apiError(service ? `Authentication failed for ${service}` : 'Authentication failed', 401, {
      code: ErrorCodes.AUTH_FAILED,
    }),
}

/**
 * Success response helper
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status })
}
