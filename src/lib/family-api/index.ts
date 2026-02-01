/**
 * Family API - Core utilities for API key validation and webhook dispatch
 *
 * This module provides:
 * - API key validation for external access
 * - Webhook event dispatching
 * - HMAC signature generation for webhook security
 * - SSRF-safe URL validation
 * - Shared Supabase service client
 */

export { validateApiKey, hasScope, type ApiKeyValidation } from './auth'
export { dispatchWebhook, dispatchWebhooks, type WebhookResult } from './webhooks'
export {
  createApiResponse,
  Errors,
  withErrorHandling,
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from './response'
export {
  getServiceClient,
  validateWebhookUrl,
  isValidDate,
  validateDateParam,
  type UrlValidationResult,
} from './utils'
