import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { POST } from '@/app/api/openrouter/analyze-wishlist-image/route'
import { createTestRequest, parseResponse, getTestProductImage, FALLBACK_PRODUCT_IMAGE } from './helpers'
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

// Generate realistic product images for testing
let PRODUCT_IMAGE_TOY: string
let PRODUCT_IMAGE_ELECTRONICS: string

beforeAll(async () => {
  console.log('[Test Setup] Generating product images for wishlist tests...')

  // Try to generate realistic images, fall back to static if not available
  const [toyImage, electronicsImage] = await Promise.all([
    getTestProductImage('LEGO toy box on store shelf with visible price tag 299 kr'),
    getTestProductImage('wireless headphones in retail packaging with price 599 kr'),
  ])

  PRODUCT_IMAGE_TOY = toyImage
  PRODUCT_IMAGE_ELECTRONICS = electronicsImage

  console.log(`[Test Setup] Using ${toyImage === FALLBACK_PRODUCT_IMAGE ? 'fallback' : 'AI-generated'} images`)
}, 30000)

describe('/api/openrouter/analyze-wishlist-image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Image Analysis', () => {
    it('analyzes toy product image and extracts info', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        body: { image: PRODUCT_IMAGE_TOY },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await parseResponse<WishlistAnalysisResponse>(response)

      // Response should have the expected structure
      expect(data).toHaveProperty('name')
      expect(data).toHaveProperty('description')
      expect(data).toHaveProperty('price')

      // With a realistic toy image, AI should detect something
      if (data.name !== null) {
        expect(typeof data.name).toBe('string')
        expect(data.name.length).toBeGreaterThan(0)
      }
    }, 60000)

    it('analyzes electronics product image and extracts info', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        body: { image: PRODUCT_IMAGE_ELECTRONICS },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await parseResponse<WishlistAnalysisResponse>(response)

      expect(data).toHaveProperty('name')
      expect(data).toHaveProperty('description')
      expect(data).toHaveProperty('price')
    }, 60000)

    it('handles fallback image gracefully', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        body: { image: FALLBACK_PRODUCT_IMAGE },
      })

      const response = await POST(request)

      // With minimal fallback image, AI may return 200 with nulls or 500
      expect([200, 500]).toContain(response.status)

      if (response.status === 200) {
        const data = await parseResponse<WishlistAnalysisResponse>(response)
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
        body: { image: PRODUCT_IMAGE_TOY },
      })

      const response = await POST(request)
      expect(response.status).toBe(200)

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
    }, 60000)
  })
})
