/**
 * API Response Helpers
 *
 * Standardized response format for Family API endpoints.
 */

import { NextResponse } from 'next/server'

export interface ApiErrorResponse {
  error: string
  code?: string
  details?: Record<string, unknown>
}

export interface ApiSuccessResponse<T> {
  data: T
  meta?: {
    count?: number
    from?: string
    to?: string
  }
}

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number = 500,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiError'
  }

  toResponse(): NextResponse<ApiErrorResponse> {
    return NextResponse.json(
      {
        error: this.message,
        ...(this.code && { code: this.code }),
        ...(this.details && { details: this.details }),
      },
      { status: this.status }
    )
  }
}

// Common API errors
export const Errors = {
  unauthorized: (message = 'Unauthorized') =>
    new ApiError(message, 401, 'UNAUTHORIZED'),

  forbidden: (message = 'Forbidden') =>
    new ApiError(message, 403, 'FORBIDDEN'),

  notFound: (resource = 'Resource') =>
    new ApiError(`${resource} not found`, 404, 'NOT_FOUND'),

  badRequest: (message: string, details?: Record<string, unknown>) =>
    new ApiError(message, 400, 'BAD_REQUEST', details),

  missingScope: (scope: string) =>
    new ApiError(
      `Missing required scope: ${scope}`,
      403,
      'MISSING_SCOPE',
      { required_scope: scope }
    ),

  internal: (message = 'Internal server error') =>
    new ApiError(message, 500, 'INTERNAL_ERROR'),
}

/**
 * Create a success response
 */
export function createApiResponse<T>(
  data: T,
  meta?: ApiSuccessResponse<T>['meta']
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({
    data,
    ...(meta && { meta }),
  })
}

/**
 * Create an error response
 */
export function createErrorResponse(
  error: string | ApiError,
  status = 500
): NextResponse<ApiErrorResponse> {
  if (error instanceof ApiError) {
    return error.toResponse()
  }

  return NextResponse.json({ error }, { status })
}

/**
 * Wrap an async handler with error handling
 */
export function withErrorHandling<T>(
  handler: () => Promise<NextResponse<T>>
): Promise<NextResponse<T | ApiErrorResponse>> {
  return handler().catch((err) => {
    if (err instanceof ApiError) {
      return err.toResponse()
    }

    console.error('Unhandled API error:', err)
    return Errors.internal().toResponse()
  })
}
