import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/openrouter/categorize-item/route'
import { createTestRequest, parseResponse } from './helpers'
import { TEST_MODEL } from './setup'

// Types for categorization response
interface CategorizeResponse {
  category: string
  confidence: number
  fromCache: boolean
  error?: string
}

// Valid categories from the API
const VALID_CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'frozen',
  'pantry',
  'beverages',
  'household',
  'home',
  'electronics',
  'other',
]

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
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@example.com' } },
        error: null,
      }),
    },
  })),
}))

// Mock rate limiting
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  createRateLimitKey: vi.fn().mockReturnValue('test-key'),
  RATE_LIMITS: { aiCategorize: { requests: 60, window: 60 } },
}))

// Mock origin validation
vi.mock('@/lib/config', () => ({
  validateOrigin: vi.fn().mockReturnValue(true),
}))

describe('/api/openrouter/categorize-item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Common Item Cache', () => {
    it('categorizes common items from cache', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: 'melk' },
      })

      const response = await POST(request)
      const data = await parseResponse<CategorizeResponse>(response)

      expect(response.status).toBe(200)
      expect(data.category).toBe('dairy')
      expect(data.fromCache).toBe(true)
      expect(data.confidence).toBe(1.0)
    }, 60000)

    it('categorizes bread from cache', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: 'brød' },
      })

      const response = await POST(request)
      const data = await parseResponse<CategorizeResponse>(response)

      expect(response.status).toBe(200)
      expect(data.category).toBe('pantry')
      expect(data.fromCache).toBe(true)
    }, 60000)

    it('categorizes eggs from cache', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: 'egg' },
      })

      const response = await POST(request)
      const data = await parseResponse<CategorizeResponse>(response)

      expect(response.status).toBe(200)
      expect(data.category).toBe('dairy')
      expect(data.fromCache).toBe(true)
    }, 60000)
  })

  describe('API Categorization', () => {
    it('categorizes unknown items via API', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: 'quinoa-salat med feta' },
      })

      const response = await POST(request)
      const data = await parseResponse<CategorizeResponse>(response)

      expect(response.status).toBe(200)
      expect(VALID_CATEGORIES).toContain(data.category)
      expect(data.fromCache).toBe(false)
      expect(data.confidence).toBeGreaterThan(0)
      expect(data.confidence).toBeLessThanOrEqual(1)
    }, 60000)

    it('handles Norwegian items correctly', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: 'rømme' },
      })

      const response = await POST(request)
      const data = await parseResponse<CategorizeResponse>(response)

      expect(response.status).toBe(200)
      expect(data.category).toBe('dairy')
    }, 60000)

    it('categorizes brunost correctly', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: 'brunost' },
      })

      const response = await POST(request)
      const data = await parseResponse<CategorizeResponse>(response)

      expect(response.status).toBe(200)
      expect(data.category).toBe('dairy')
    }, 60000)
  })

  describe('Response Validation', () => {
    it('returns valid category enum', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: 'random item 12345' },
      })

      const response = await POST(request)
      const data = await parseResponse<CategorizeResponse>(response)

      expect(response.status).toBe(200)
      // Category should always be a valid enum value
      expect(VALID_CATEGORIES).toContain(data.category)
    }, 60000)

    it('returns confidence score between 0 and 1', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: 'noe rart' },
      })

      const response = await POST(request)
      const data = await parseResponse<CategorizeResponse>(response)

      expect(response.status).toBe(200)
      expect(data.confidence).toBeGreaterThanOrEqual(0)
      expect(data.confidence).toBeLessThanOrEqual(1)
    }, 60000)
  })

  describe('Error Handling', () => {
    it('handles empty item name', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: '' },
      })

      const response = await POST(request)

      // Should return 400 for invalid input
      expect(response.status).toBe(400)
    }, 60000)

    it('falls back to other for unrecognizable items', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/categorize-item', {
        method: 'POST',
        body: { itemName: '🎲🎯🎪' },
      })

      const response = await POST(request)
      const data = await parseResponse<CategorizeResponse>(response)

      expect(response.status).toBe(200)
      // Should gracefully handle and return a valid category
      expect(VALID_CATEGORIES).toContain(data.category)
    }, 60000)
  })
})
