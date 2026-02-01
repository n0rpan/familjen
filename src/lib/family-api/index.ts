/**
 * Family API - Core utilities for API key validation and webhook dispatch
 *
 * This module provides:
 * - API key validation for external access
 * - Webhook event dispatching
 * - HMAC signature generation for webhook security
 */

export { validateApiKey, hasScope, type ApiKeyValidation } from './auth'
export { dispatchWebhook, dispatchWebhooks, type WebhookResult } from './webhooks'
export { createApiResponse, ApiError, type ApiErrorResponse } from './response'
