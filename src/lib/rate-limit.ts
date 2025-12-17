/**
 * Simple in-memory rate limiter
 * For production, consider using Redis or Upstash for distributed rate limiting
 */

interface RateLimitEntry {
  count: number
  resetTime: number
}

// In-memory store - cleared on server restart
const rateLimitStore = new Map<string, RateLimitEntry>()

interface RateLimitConfig {
  // Max requests per window
  limit: number
  // Window size in milliseconds
  windowMs: number
}

// Default configs for different endpoints
export const RATE_LIMITS = {
  // AI suggestions - expensive, limit to 10/minute
  aiSuggest: { limit: 10, windowMs: 60 * 1000 },
  // AI parse reminders - more lenient, 20/minute
  aiParseReminders: { limit: 20, windowMs: 60 * 1000 },
  // AI models list - moderate, 30/minute
  aiModels: { limit: 30, windowMs: 60 * 1000 },
  // Calendar sync - moderate, 30/minute
  calendarSync: { limit: 30, windowMs: 60 * 1000 },
  // Calendar invites - moderate, 20/minute
  calendarInvite: { limit: 20, windowMs: 60 * 1000 },
  // Push notifications - moderate, 30/minute per user
  pushNotify: { limit: 30, windowMs: 60 * 1000 },
} as const

/**
 * Check if request should be rate limited
 * @param key - Unique key for the rate limit (e.g., `${endpoint}:${userId}`)
 * @param config - Rate limit configuration
 * @returns { limited: true, retryAfter: number } or { limited: false }
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { limited: false } | { limited: true; retryAfter: number } {
  const now = Date.now()
  const entry = rateLimitStore.get(key)

  // Clean up expired entries periodically
  if (Math.random() < 0.1) {
    cleanupExpiredEntries()
  }

  if (!entry || now > entry.resetTime) {
    // First request or window expired - start new window
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
    })
    return { limited: false }
  }

  if (entry.count >= config.limit) {
    // Rate limited
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000)
    return { limited: true, retryAfter }
  }

  // Increment count
  entry.count++
  return { limited: false }
}

function cleanupExpiredEntries() {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}

/**
 * Create rate limit key from user ID and endpoint
 */
export function createRateLimitKey(userId: string, endpoint: string): string {
  return `${endpoint}:${userId}`
}
