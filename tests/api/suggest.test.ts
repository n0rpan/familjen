import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/openrouter/suggest/route'
import {
  createMockSupabaseClient,
  createTestRequest,
  parseResponse,
  getNextMonday,
  DAIRY_PATTERNS,
  EGG_PATTERNS,
  NUT_PATTERNS,
  GLUTEN_PATTERNS,
  type TestChild,
  type TestMember,
} from './helpers'
import { TEST_MODEL } from './setup'

// Types for meal suggestions
interface MealIngredient {
  item: string
  amount: string
}

interface MealSuggestion {
  day: string
  name: string
  description: string
  ingredients: MealIngredient[]
  is_quick: boolean
  is_kid_friendly: boolean
}

interface SuggestResponse {
  suggestions: MealSuggestion[]
  error?: string
}

// Mock the Supabase server client
const mockSupabase = vi.hoisted(() => ({
  client: null as ReturnType<typeof createMockSupabaseClient> | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase.client)),
}))

// Mock rate limiting to always allow
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  createRateLimitKey: vi.fn().mockReturnValue('test-key'),
  RATE_LIMITS: { aiSuggest: { requests: 10, window: 60 } },
}))

// Mock origin validation to always pass
vi.mock('@/lib/config', () => ({
  validateOrigin: vi.fn().mockReturnValue(true),
}))

// Mock household helper
vi.mock('@/lib/supabase/household', () => ({
  getUserHousehold: vi.fn().mockImplementation(async () => {
    // Return the household from mock client
    return {
      data: {
        id: 'test-household-id',
        name: 'Test Familie',
        ai_meal_context: null,
        share_names_with_ai: true,
      },
      error: null,
    }
  }),
}))

describe('/api/openrouter/suggest', () => {
  const weekStart = getNextMonday()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Allergy Handling', () => {
    it('excludes dairy when milk allergy is specified', async () => {
      // Setup mock with milk allergy
      const childrenWithAllergy: TestChild[] = [
        { id: 'child-1', name: 'Emma', birth_date: '2020-01-15', allergies: ['melk'] },
      ]

      mockSupabase.client = createMockSupabaseClient({
        children: childrenWithAllergy,
        members: [{ id: 'member-1', name: 'Martin', birth_date: '1985-03-10', allergies: [], is_parent: true }],
      })

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: { weekStart, existingMeals: [] },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      // Should return suggestions (or empty array if all days filled)
      expect(response.status).toBe(200)

      if (data.suggestions && data.suggestions.length > 0) {
        for (const meal of data.suggestions) {
          const nameAndIngredients = [
            meal.name.toLowerCase(),
            ...meal.ingredients.map(i => i.item.toLowerCase()),
          ].join(' ')

          // Verify no dairy ingredients
          expect(nameAndIngredients).not.toMatch(DAIRY_PATTERNS)
        }
      }
    }, 60000) // 60s timeout for real API call

    it('excludes eggs when egg allergy is specified', async () => {
      const childrenWithAllergy: TestChild[] = [
        { id: 'child-1', name: 'Emma', birth_date: '2020-01-15', allergies: ['egg'] },
      ]

      mockSupabase.client = createMockSupabaseClient({
        children: childrenWithAllergy,
      })

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: { weekStart, existingMeals: [] },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      expect(response.status).toBe(200)

      if (data.suggestions && data.suggestions.length > 0) {
        for (const meal of data.suggestions) {
          const ingredients = meal.ingredients.map(i => i.item.toLowerCase()).join(' ')
          expect(ingredients).not.toMatch(EGG_PATTERNS)
        }
      }
    }, 60000)

    it('excludes nuts when nut allergy is specified', async () => {
      const childrenWithAllergy: TestChild[] = [
        { id: 'child-1', name: 'Emma', birth_date: '2020-01-15', allergies: ['nøtter'] },
      ]

      mockSupabase.client = createMockSupabaseClient({
        children: childrenWithAllergy,
      })

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: { weekStart, existingMeals: [] },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      expect(response.status).toBe(200)

      if (data.suggestions && data.suggestions.length > 0) {
        for (const meal of data.suggestions) {
          const ingredients = meal.ingredients.map(i => i.item.toLowerCase()).join(' ')
          expect(ingredients).not.toMatch(NUT_PATTERNS)
        }
      }
    }, 60000)

    it('handles multiple allergies from both children and parents', async () => {
      const children: TestChild[] = [
        { id: 'child-1', name: 'Emma', birth_date: '2020-01-15', allergies: ['melk'] },
        { id: 'child-2', name: 'Oliver', birth_date: '2018-06-20', allergies: ['egg'] },
      ]
      const members: TestMember[] = [
        { id: 'member-1', name: 'Martin', birth_date: '1985-03-10', allergies: ['nøtter'], is_parent: true },
      ]

      mockSupabase.client = createMockSupabaseClient({
        children,
        members,
      })

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: { weekStart, existingMeals: [] },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      expect(response.status).toBe(200)

      if (data.suggestions && data.suggestions.length > 0) {
        for (const meal of data.suggestions) {
          const ingredients = meal.ingredients.map(i => i.item.toLowerCase()).join(' ')

          // All three allergies should be excluded
          expect(ingredients).not.toMatch(DAIRY_PATTERNS)
          expect(ingredients).not.toMatch(EGG_PATTERNS)
          expect(ingredients).not.toMatch(NUT_PATTERNS)
        }
      }
    }, 60000)

    it('normalizes allergy case (MELK should work same as melk)', async () => {
      const childrenWithAllergy: TestChild[] = [
        { id: 'child-1', name: 'Emma', birth_date: '2020-01-15', allergies: ['MELK', 'EGG'] },
      ]

      mockSupabase.client = createMockSupabaseClient({
        children: childrenWithAllergy,
      })

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: { weekStart, existingMeals: [] },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      expect(response.status).toBe(200)

      if (data.suggestions && data.suggestions.length > 0) {
        for (const meal of data.suggestions) {
          const ingredients = meal.ingredients.map(i => i.item.toLowerCase()).join(' ')
          expect(ingredients).not.toMatch(DAIRY_PATTERNS)
          expect(ingredients).not.toMatch(EGG_PATTERNS)
        }
      }
    }, 60000)

    it('returns suggestions when no allergies are specified', async () => {
      mockSupabase.client = createMockSupabaseClient({
        children: [{ id: 'child-1', name: 'Emma', birth_date: '2020-01-15', allergies: [] }],
        members: [{ id: 'member-1', name: 'Martin', birth_date: '1985-03-10', allergies: [], is_parent: true }],
      })

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: { weekStart, existingMeals: [] },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      expect(response.status).toBe(200)
      // Should return suggestions for weekdays
      expect(data.suggestions).toBeDefined()
    }, 60000)
  })

  describe('Meal Planning Logic', () => {
    it('skips days that already have meals', async () => {
      mockSupabase.client = createMockSupabaseClient({})

      // Provide existing meals for Monday and Tuesday
      const mondayDate = weekStart
      const tuesdayDate = new Date(weekStart)
      tuesdayDate.setDate(tuesdayDate.getDate() + 1)
      const tuesdayStr = tuesdayDate.toISOString().split('T')[0]

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: {
          weekStart,
          existingMeals: [
            { date: mondayDate, name: 'Taco' },
            { date: tuesdayStr, name: 'Pizza' },
          ],
        },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      expect(response.status).toBe(200)

      // Suggestions should not include Monday or Tuesday
      if (data.suggestions && data.suggestions.length > 0) {
        const suggestionDays = data.suggestions.map(s => s.day)
        expect(suggestionDays).not.toContain(mondayDate)
        expect(suggestionDays).not.toContain(tuesdayStr)
      }
    }, 60000)

    it('enhances partial meal names', async () => {
      mockSupabase.client = createMockSupabaseClient({})

      const mondayDate = weekStart

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: {
          weekStart,
          existingMeals: [
            { date: mondayDate, name: 'kylling' }, // Short/partial name
          ],
        },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      expect(response.status).toBe(200)

      // Should suggest enhancement for "kylling"
      if (data.suggestions && data.suggestions.length > 0) {
        const mondaySuggestion = data.suggestions.find(s => s.day === mondayDate)
        if (mondaySuggestion) {
          // The enhanced suggestion should contain "kylling" or a chicken dish
          expect(mondaySuggestion.name.toLowerCase()).toMatch(/kylling|chicken/)
        }
      }
    }, 60000)

    it('returns empty suggestions when all weekdays have meals', async () => {
      mockSupabase.client = createMockSupabaseClient({})

      // Create meals for all 5 weekdays
      const existingMeals = []
      for (let i = 0; i < 5; i++) {
        const date = new Date(weekStart)
        date.setDate(date.getDate() + i)
        existingMeals.push({
          date: date.toISOString().split('T')[0],
          name: `Meal ${i + 1} with enough characters`,
        })
      }

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: { weekStart, existingMeals },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      expect(response.status).toBe(200)
      expect(data.suggestions).toEqual([])
    }, 60000)
  })

  describe('Response Format', () => {
    it('returns properly formatted suggestions', async () => {
      mockSupabase.client = createMockSupabaseClient({})

      const request = createTestRequest('http://localhost:3000/api/openrouter/suggest', {
        method: 'POST',
        body: { weekStart, existingMeals: [] },
      })

      const response = await POST(request)
      const data = await parseResponse<SuggestResponse>(response)

      expect(response.status).toBe(200)

      if (data.suggestions && data.suggestions.length > 0) {
        const suggestion = data.suggestions[0]

        // Check required fields
        expect(suggestion).toHaveProperty('day')
        expect(suggestion).toHaveProperty('name')
        expect(suggestion).toHaveProperty('description')
        expect(suggestion).toHaveProperty('ingredients')

        // Day should be in YYYY-MM-DD format
        expect(suggestion.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)

        // Ingredients should be an array
        expect(Array.isArray(suggestion.ingredients)).toBe(true)

        if (suggestion.ingredients.length > 0) {
          expect(suggestion.ingredients[0]).toHaveProperty('item')
          expect(suggestion.ingredients[0]).toHaveProperty('amount')
        }
      }
    }, 60000)
  })
})
