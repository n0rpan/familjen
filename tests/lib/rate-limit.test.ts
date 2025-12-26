import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Upstash modules before importing rate-limit
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: vi.fn(),
}))
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(),
}))

// Now import the module (uses mocks)
import { RATE_LIMITS, checkRateLimit, createRateLimitKey } from '@/lib/rate-limit'

describe('RATE_LIMITS configuration', () => {
  it('has expected rate limit configs', () => {
    expect(RATE_LIMITS.aiSuggest).toEqual({ limit: 10, windowMs: 60000 })
    expect(RATE_LIMITS.calendarSync).toEqual({ limit: 30, windowMs: 60000 })
    expect(RATE_LIMITS.spondSync).toEqual({ limit: 10, windowMs: 60000 })
  })

  it('all configs have limit and windowMs', () => {
    for (const [key, config] of Object.entries(RATE_LIMITS)) {
      expect(config).toHaveProperty('limit')
      expect(config).toHaveProperty('windowMs')
      expect(typeof config.limit).toBe('number')
      expect(typeof config.windowMs).toBe('number')
      expect(config.limit).toBeGreaterThan(0)
      expect(config.windowMs).toBeGreaterThan(0)
    }
  })
})

describe('createRateLimitKey', () => {
  it('creates key from userId and endpoint', () => {
    expect(createRateLimitKey('user123', 'suggest')).toBe('suggest:user123')
    expect(createRateLimitKey('abc-def', 'calendar')).toBe('calendar:abc-def')
  })

  it('handles empty strings', () => {
    expect(createRateLimitKey('', 'suggest')).toBe('suggest:')
    expect(createRateLimitKey('user', '')).toBe(':user')
  })
})

describe('checkRateLimit (in-memory fallback)', () => {
  // Without Redis env vars, it uses in-memory rate limiting

  beforeEach(() => {
    // Reset the in-memory store by making many requests to trigger cleanup
    // This is a workaround since the store is private
    vi.useFakeTimers()
  })

  it('allows requests under the limit', async () => {
    vi.useRealTimers()
    const config = { limit: 5, windowMs: 1000 }

    // First request should not be limited
    const result1 = await checkRateLimit('test-key-1', config)
    expect(result1.limited).toBe(false)

    // Second request should not be limited
    const result2 = await checkRateLimit('test-key-1', config)
    expect(result2.limited).toBe(false)
  })

  it('limits requests over the threshold', async () => {
    vi.useRealTimers()
    const config = { limit: 2, windowMs: 10000 }
    const key = `limit-test-${Date.now()}`

    // Make requests up to the limit
    await checkRateLimit(key, config)
    await checkRateLimit(key, config)

    // Third request should be limited
    const result = await checkRateLimit(key, config)
    expect(result.limited).toBe(true)
    if (result.limited) {
      expect(result.retryAfter).toBeGreaterThan(0)
      expect(result.retryAfter).toBeLessThanOrEqual(10)
    }
  })

  it('tracks different keys separately', async () => {
    vi.useRealTimers()
    const config = { limit: 1, windowMs: 10000 }
    const timestamp = Date.now()

    // First key - one request allowed
    const key1 = `separate-key-a-${timestamp}`
    const result1 = await checkRateLimit(key1, config)
    expect(result1.limited).toBe(false)

    // Second request to key1 should be limited
    const result2 = await checkRateLimit(key1, config)
    expect(result2.limited).toBe(true)

    // Different key should still be allowed
    const key2 = `separate-key-b-${timestamp}`
    const result3 = await checkRateLimit(key2, config)
    expect(result3.limited).toBe(false)
  })

  it('resets after window expires', async () => {
    vi.useFakeTimers()
    const config = { limit: 1, windowMs: 1000 }
    const key = 'reset-test-key'

    // Make a request
    const result1 = await checkRateLimit(key, config)
    expect(result1.limited).toBe(false)

    // Second request within window should be limited
    const result2 = await checkRateLimit(key, config)
    expect(result2.limited).toBe(true)

    // Advance time past window
    vi.advanceTimersByTime(1500)

    // Should be allowed again
    const result3 = await checkRateLimit(key, config)
    expect(result3.limited).toBe(false)

    vi.useRealTimers()
  })
})
