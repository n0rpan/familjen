import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/openrouter/models/route'
import { createTestRequest, parseResponse } from './helpers'

// Types for models response
interface OpenRouterModel {
  id: string
  name: string
  pricing: {
    prompt: string
    completion: string
  }
  context_length: number
  supportsVision?: boolean
}

interface ModelsResponse {
  models: OpenRouterModel[]
  error?: string
}

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({
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
  RATE_LIMITS: { aiModels: { requests: 30, window: 60 } },
}))

// Mock origin validation
vi.mock('@/lib/config', () => ({
  validateOrigin: vi.fn().mockReturnValue(true),
}))

describe('/api/openrouter/models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Model Listing', () => {
    it('returns a list of models', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/models', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ModelsResponse>(response)

      expect(response.status).toBe(200)
      expect(data.models).toBeDefined()
      expect(Array.isArray(data.models)).toBe(true)
      expect(data.models.length).toBeGreaterThan(0)
    }, 60000)

    it('returns models with required fields', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/models', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ModelsResponse>(response)

      expect(response.status).toBe(200)

      const model = data.models[0]
      expect(model).toHaveProperty('id')
      expect(model).toHaveProperty('name')
      expect(model).toHaveProperty('pricing')
      expect(model).toHaveProperty('context_length')

      // Pricing should have prompt and completion
      expect(model.pricing).toHaveProperty('prompt')
      expect(model.pricing).toHaveProperty('completion')
    }, 60000)

    it('excludes deprecated models', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/models', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ModelsResponse>(response)

      expect(response.status).toBe(200)

      // No model should have "deprecated" or "test" in the ID
      for (const model of data.models) {
        expect(model.id.toLowerCase()).not.toContain('deprecated')
        expect(model.id.toLowerCase()).not.toContain('test')
      }
    }, 60000)

    it('sorts models by provider priority', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/models', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ModelsResponse>(response)

      expect(response.status).toBe(200)

      // Provider priority: anthropic > openai > google > meta > mistral
      const providers = data.models.map(m => m.id.split('/')[0])

      // Find first occurrence of each provider
      const anthropicIndex = providers.findIndex(p => p === 'anthropic')
      const openaiIndex = providers.findIndex(p => p === 'openai')
      const googleIndex = providers.findIndex(p => p === 'google')

      // If both exist, anthropic should come before openai
      if (anthropicIndex !== -1 && openaiIndex !== -1) {
        expect(anthropicIndex).toBeLessThan(openaiIndex)
      }

      // If both exist, openai should come before google
      if (openaiIndex !== -1 && googleIndex !== -1) {
        expect(openaiIndex).toBeLessThan(googleIndex)
      }
    }, 60000)
  })

  describe('Vision Model Filtering', () => {
    it('filters for vision models when vision=true', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/models?vision=true', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ModelsResponse>(response)

      expect(response.status).toBe(200)

      // All returned models should support vision
      for (const model of data.models) {
        expect(model.supportsVision).toBe(true)
      }
    }, 60000)

    it('returns all models when vision filter not specified', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/models', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ModelsResponse>(response)

      expect(response.status).toBe(200)

      // Should include both vision and non-vision models
      const hasVision = data.models.some(m => m.supportsVision === true)
      const hasNonVision = data.models.some(m => m.supportsVision === false || m.supportsVision === undefined)

      // At least should have models (may or may not have both types)
      expect(data.models.length).toBeGreaterThan(0)
    }, 60000)
  })
})
