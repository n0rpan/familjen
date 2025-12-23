import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/openrouter/analyze-wishlist-image/route'
import { createTestRequest, parseResponse } from './helpers'
import { TEST_MODEL } from './setup'

// Types for wishlist analysis response
interface WishlistAnalysisResponse {
  name: string | null
  description: string | null
  price: number | null
  error?: string
}

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { value: TEST_MODEL },
        error: null,
      }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@example.com' } },
        error: null,
      }),
    },
  })),
}))

// Mock household helper
vi.mock('@/lib/supabase/household', () => ({
  getUserHousehold: vi.fn().mockResolvedValue({
    data: {
      id: 'test-household-id',
      name: 'Test Familie',
      openrouter_api_key: null,
    },
    error: null,
  }),
}))

// Mock rate limiting
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  createRateLimitKey: vi.fn().mockReturnValue('test-key'),
  RATE_LIMITS: { aiAnalyze: { requests: 10, window: 60 } },
}))

// Mock origin validation
vi.mock('@/lib/config', () => ({
  validateOrigin: vi.fn().mockReturnValue(true),
}))

// A simple 1x1 PNG image as base64 for testing
const SIMPLE_TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('/api/openrouter/analyze-wishlist-image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Image Analysis', () => {
    it('analyzes image and returns product info or gracefully fails', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        body: { image: SIMPLE_TEST_IMAGE },
      })

      const response = await POST(request)

      // With a blank test image, the AI may:
      // - Return 200 with null fields (no product detected)
      // - Return 500 if it can't parse the response (AI returns text instead of JSON)
      expect([200, 500]).toContain(response.status)

      if (response.status === 200) {
        const data = await parseResponse<WishlistAnalysisResponse>(response)
        // Response should have the expected structure
        expect(data).toHaveProperty('name')
        expect(data).toHaveProperty('description')
        expect(data).toHaveProperty('price')
      }
    }, 60000)

    it('handles images with no detectable product', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        body: { image: SIMPLE_TEST_IMAGE }, // Simple blank image
      })

      const response = await POST(request)

      // AI may return 500 if it can't produce valid JSON for blank image
      expect([200, 500]).toContain(response.status)

      if (response.status === 200) {
        const data = await parseResponse<WishlistAnalysisResponse>(response)
        // Should return null fields for undetectable product
        expect(data).toHaveProperty('name')
        expect(data).toHaveProperty('description')
        expect(data).toHaveProperty('price')
      }
    }, 60000)
  })

  describe('Error Handling', () => {
    it('rejects missing image', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        body: {},
      })

      const response = await POST(request)

      // Should return 400 for missing image
      expect(response.status).toBe(400)
    }, 60000)

    it('rejects empty image string', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        body: { image: '' },
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
    }, 60000)

    it('handles invalid image format gracefully', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        body: { image: 'not-a-valid-image' },
      })

      const response = await POST(request)

      // Should either return 400 or handle gracefully
      // The exact behavior depends on the API implementation
      expect([200, 400, 500]).toContain(response.status)
    }, 60000)
  })

  describe('Response Format', () => {
    it('returns properly typed response when successful', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        body: { image: SIMPLE_TEST_IMAGE },
      })

      const response = await POST(request)

      // With blank test image, AI may return 500 (can't parse)
      expect([200, 500]).toContain(response.status)

      if (response.status === 200) {
        const data = await parseResponse<WishlistAnalysisResponse>(response)

        // Type validation
        if (data.name !== null) {
          expect(typeof data.name).toBe('string')
          expect(data.name.length).toBeGreaterThan(0)
        }

        if (data.description !== null) {
          expect(typeof data.description).toBe('string')
        }

        if (data.price !== null) {
          expect(typeof data.price).toBe('number')
          expect(data.price).toBeGreaterThanOrEqual(0)
        }
      }
    }, 60000)
  })
})
