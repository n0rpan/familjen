/**
 * Distributed rate limiter using Upstash Redis
 * Falls back to in-memory for local development when UPSTASH_REDIS_REST_URL is not set
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

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
  // Spond sync - moderate, 10/minute (API calls are slow)
  spondSync: { limit: 10, windowMs: 60 * 1000 },
  // Spond test connection - 5/minute (during setup)
  spondTestConnection: { limit: 5, windowMs: 60 * 1000 },
  // Kidplan sync - moderate, 10/minute
  kidplanSync: { limit: 10, windowMs: 60 * 1000 },
  // Kidplan test connection - 5/minute (during setup)
  kidplanTestConnection: { limit: 5, windowMs: 60 * 1000 },
  // iSkole sync - moderate, 10/minute
  iskoleSync: { limit: 10, windowMs: 60 * 1000 },
  // iSkole test connection - 5/minute (during setup)
  iskoleTestConnection: { limit: 5, windowMs: 60 * 1000 },
  // MyKid sync - moderate, 10/minute
  mykidSync: { limit: 10, windowMs: 60 * 1000 },
  // MyKid test connection - 5/minute (during setup)
  mykidTestConnection: { limit: 5, windowMs: 60 * 1000 },
  // Manual URL fetch - 10/minute (external fetch + AI processing)
  urlFetch: { limit: 10, windowMs: 60 * 1000 },
} as const

// ============================================================================
// Upstash Redis Rate Limiter (production)
// ============================================================================

// Initialize Redis client if environment variables are set
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null

// Cache of Ratelimit instances per config (avoid recreating)
const rateLimiters = new Map<string, Ratelimit>()

function getUpstashRateLimiter(config: RateLimitConfig): Ratelimit {
  const key = `${config.limit}:${config.windowMs}`
  let limiter = rateLimiters.get(key)

  if (!limiter && redis) {
    // Convert windowMs to seconds for Upstash
    const windowSeconds = Math.ceil(config.windowMs / 1000)
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.limit, `${windowSeconds} s`),
      analytics: true,
      prefix: 'familjen:ratelimit',
    })
    rateLimiters.set(key, limiter)
  }

  return limiter!
}

// ============================================================================
// In-memory fallback (development)
// ============================================================================

interface InMemoryEntry {
  count: number
  resetTime: number
}

const inMemoryStore = new Map<string, InMemoryEntry>()

function checkInMemoryRateLimit(
  key: string,
  config: RateLimitConfig
): { limited: false } | { limited: true; retryAfter: number } {
  const now = Date.now()
  const entry = inMemoryStore.get(key)

  // Cleanup periodically
  if (Math.random() < 0.1) {
    for (const [k, e] of inMemoryStore.entries()) {
      if (now > e.resetTime) inMemoryStore.delete(k)
    }
  }

  if (!entry || now > entry.resetTime) {
    inMemoryStore.set(key, { count: 1, resetTime: now + config.windowMs })
    return { limited: false }
  }

  if (entry.count >= config.limit) {
    return { limited: true, retryAfter: Math.ceil((entry.resetTime - now) / 1000) }
  }

  entry.count++
  return { limited: false }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if request should be rate limited
 * Uses Upstash Redis in production, in-memory fallback in development
 *
 * @param key - Unique key for the rate limit (e.g., `${endpoint}:${userId}`)
 * @param config - Rate limit configuration
 * @returns { limited: true, retryAfter: number } or { limited: false }
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<{ limited: false } | { limited: true; retryAfter: number }> {
  // Use Upstash when available
  if (redis) {
    try {
      const limiter = getUpstashRateLimiter(config)
      const result = await limiter.limit(key)

      if (!result.success) {
        // Calculate retry-after in seconds
        const retryAfter = Math.ceil((result.reset - Date.now()) / 1000)
        return { limited: true, retryAfter: Math.max(1, retryAfter) }
      }

      return { limited: false }
    } catch (error) {
      // Log error but don't block requests if Redis fails
      console.error('Upstash rate limit error, falling back to in-memory:', error)
      return checkInMemoryRateLimit(key, config)
    }
  }

  // Fallback to in-memory for local development
  return checkInMemoryRateLimit(key, config)
}

/**
 * Create rate limit key from user ID and endpoint
 */
export function createRateLimitKey(userId: string, endpoint: string): string {
  return `${endpoint}:${userId}`
}
