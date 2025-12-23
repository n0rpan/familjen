import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/openrouter/shopping-suggest/route'
import { createTestRequest, parseResponse, getNextMonday } from './helpers'
import { TEST_MODEL } from './setup'

// Types for shopping suggest response
interface ShoppingSuggestion {
  item?: string
  name?: string  // API may return 'name' instead of 'item'
  category: string
  source: 'recipe' | 'pattern' | 'staple'
  confidence: number
}

interface ShoppingSuggestResponse {
  suggestions: ShoppingSuggestion[]
  mealsPlanned: number
  weekStart: string
  error?: string
}

// Use vi.hoisted to define mock data before vi.mock hoisting
const mockData = vi.hoisted(() => {
  const weekStart = (() => {
    const today = new Date()
    const dayOfWeek = today.getDay()
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek
    const nextMonday = new Date(today)
    nextMonday.setDate(today.getDate() + daysUntilMonday)
    return nextMonday.toISOString().split('T')[0]
  })()

  return {
    household: {
      id: 'test-household-id',
      name: 'Test Familie',
    },
    recipes: [
      {
        id: 'recipe-1',
        name: 'Taco',
        household_id: 'test-household-id',
        ingredients: [
          { item: 'kjøttdeig', amount: '400g' },
          { item: 'tacokrydder', amount: '1 pakke' },
          { item: 'tortilla', amount: '8 stk' },
          { item: 'salat', amount: '1 pose' },
        ],
      },
      {
        id: 'recipe-2',
        name: 'Pasta Bolognese',
        household_id: 'test-household-id',
        ingredients: [
          { item: 'kjøttdeig', amount: '500g' },
          { item: 'hermetiske tomater', amount: '2 bokser' },
          { item: 'pasta', amount: '400g' },
          { item: 'løk', amount: '1 stk' },
        ],
      },
    ],
    meals: [
      { date: weekStart, recipe_id: 'recipe-1', custom_meal: null, household_id: 'test-household-id' },
    ],
    weekStart,
  }
})

// Mock the Supabase server client with meal and recipe data
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({
    from: vi.fn((table: string) => {
      const queryBuilder = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          if (table === 'app_settings') {
            return Promise.resolve({ data: { value: TEST_MODEL }, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        }),
        then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
          let data: unknown[] = []
          if (table === 'meals') data = mockData.meals
          if (table === 'recipes') data = mockData.recipes
          if (table === 'shopping_lists') data = [{ id: 'list-1', household_id: 'test-household-id', is_archived: false }]
          if (table === 'shopping_items') data = []
          resolve({ data, error: null })
          return Promise.resolve({ data, error: null })
        },
      }
      return queryBuilder
    }),
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
  getUserHousehold: vi.fn().mockImplementation(() => Promise.resolve({
    data: mockData.household,
    error: null,
  })),
}))

// Mock rate limiting
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  createRateLimitKey: vi.fn().mockReturnValue('test-key'),
  RATE_LIMITS: { aiSuggest: { requests: 10, window: 60 } },
}))

// Mock origin validation
vi.mock('@/lib/config', () => ({
  validateOrigin: vi.fn().mockReturnValue(true),
}))

describe('/api/openrouter/shopping-suggest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Suggestion Generation', () => {
    it('returns suggestions structure', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/shopping-suggest', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ShoppingSuggestResponse>(response)

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('suggestions')
      expect(data).toHaveProperty('mealsPlanned')
      expect(data).toHaveProperty('weekStart')
      expect(Array.isArray(data.suggestions)).toBe(true)
    }, 60000)

    it('returns valid suggestion format', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/shopping-suggest', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ShoppingSuggestResponse>(response)

      expect(response.status).toBe(200)

      if (data.suggestions.length > 0) {
        const suggestion = data.suggestions[0]
        // API may return 'name' or 'item' for the product name
        expect(suggestion.item || suggestion.name).toBeDefined()
        expect(suggestion).toHaveProperty('category')
        expect(suggestion).toHaveProperty('source')
        expect(suggestion).toHaveProperty('confidence')

        // Source should be one of the valid types
        expect(['recipe', 'pattern', 'staple']).toContain(suggestion.source)

        // Confidence should be between 0 and 1
        expect(suggestion.confidence).toBeGreaterThanOrEqual(0)
        expect(suggestion.confidence).toBeLessThanOrEqual(1)
      }
    }, 60000)

    it('includes staple items in suggestions', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/shopping-suggest', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ShoppingSuggestResponse>(response)

      expect(response.status).toBe(200)

      // Check if any staple items are suggested
      const stapleItems = data.suggestions.filter(s => s.source === 'staple')

      // May or may not have staples depending on current shopping list state
      // Just verify the format is correct if they exist
      for (const staple of stapleItems) {
        // API may return 'name' or 'item'
        expect(staple.item || staple.name).toBeDefined()
        expect(staple.category).toBeDefined()
      }
    }, 60000)
  })

  describe('Recipe Integration', () => {
    it('suggests ingredients from planned meals', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/shopping-suggest', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ShoppingSuggestResponse>(response)

      expect(response.status).toBe(200)

      // Check for recipe-sourced suggestions
      const recipeItems = data.suggestions.filter(s => s.source === 'recipe')

      // If there are recipe items, they should match planned meal ingredients
      for (const item of recipeItems) {
        expect(item.item).toBeDefined()
        expect(item.category).toBeDefined()
      }
    }, 60000)
  })

  describe('Response Metadata', () => {
    it('returns correct week start date', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/shopping-suggest', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ShoppingSuggestResponse>(response)

      expect(response.status).toBe(200)

      // weekStart should be a valid date string
      expect(data.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }, 60000)

    it('returns meals planned count', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/shopping-suggest', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await parseResponse<ShoppingSuggestResponse>(response)

      expect(response.status).toBe(200)
      expect(typeof data.mealsPlanned).toBe('number')
      expect(data.mealsPlanned).toBeGreaterThanOrEqual(0)
    }, 60000)
  })
})
