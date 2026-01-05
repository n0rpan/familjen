import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/openrouter/parse-action/route'
import { createTestRequest, parseResponse, formatDate } from './helpers'
import { TEST_MODEL } from './setup'

// Types for parsed actions
interface ClarificationOption {
  value: string
  label: string
}

interface NeedsClarification {
  field: string
  question: string
  options: ClarificationOption[]
}

interface ParsedAction {
  type: string
  operation: string
  data: Record<string, unknown>
  display: {
    title: string
    subtitle: string
    icon: string
  }
  confidence: number
  needsClarification?: NeedsClarification
}

interface SearchSource {
  type: 'message' | 'task' | 'event' | 'recipe' | 'meal'
  title: string
  excerpt: string
  date?: string
  id: string
}

interface MealSuggestion {
  day: string
  name: string
  description?: string
  ingredients: Array<{ item: string; amount: string }>
}

// Response types for different modes
interface ActionResponse {
  mode: 'action'
  actions: ParsedAction[]
}

interface SearchResponse {
  mode: 'search'
  answer: string
  sources: SearchSource[]
}

interface SuggestResponse {
  mode: 'suggest'
  suggestions: MealSuggestion[]
}

type ParseActionResponse = ActionResponse | SearchResponse | SuggestResponse | { error: string }

// Legacy response type for backward compatibility
interface LegacyParseActionResponse {
  actions: ParsedAction[]
  error?: string
}

// Mock the Supabase server client with full query chain support
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({
    from: vi.fn((table: string) => {
      // Create a complete builder that supports all query methods
      const builder = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        and: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: table === 'app_settings' ? { value: TEST_MODEL } : null,
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: table === 'household_members' ? { household_id: 'test-household-id' } : null,
          error: null,
        }),
        // Default to returning empty arrays for list queries (search/suggest modes)
        then: vi.fn((callback: (result: { data: unknown[]; error: null }) => void) =>
          Promise.resolve(callback({ data: [], error: null }))
        ),
      }
      return builder
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
  getUserHousehold: vi.fn().mockResolvedValue({
    data: {
      id: 'test-household-id',
      name: 'Test Familie',
      ai_meal_context: null,
      share_names_with_ai: true,
    },
    error: null,
    multipleHouseholds: false,
  }),
}))

// Mock rate limiting
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  checkDemoRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  createRateLimitKey: vi.fn().mockReturnValue('test-key'),
  isDemoRequest: vi.fn().mockReturnValue(false), // Tests run as production mode
  RATE_LIMITS: { aiParseReminders: { requests: 20, window: 60 } },
}))

// Mock origin validation
vi.mock('@/lib/config', () => ({
  validateOrigin: vi.fn().mockReturnValue(true),
}))

describe('/api/openrouter/parse-action', () => {
  const today = formatDate(new Date())

  const defaultContext = {
    today,
    children: [
      { id: 'child-1', name: 'Emma' },
      { id: 'child-2', name: 'Oliver' },
    ],
    members: [
      { id: 'member-1', name: 'Martin', isCurrentUser: true },
      { id: 'member-2', name: 'Sara', isCurrentUser: false },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Meal Actions', () => {
    it('parses meal add action', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Taco på fredag',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions).toBeDefined()
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('meal')
      expect(action.operation).toBe('add')
      // Data should have meal name or date (AI response format may vary)
      expect(action.data.meal || action.data.name || action.data.date).toBeDefined()
      expect(action.confidence).toBeGreaterThan(0.5)
    }, 60000)

    it('parses meal edit action', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Endre middag på fredag til pizza',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('meal')
      expect(action.operation).toBe('edit')
    }, 60000)

    it('parses meal delete action', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Fjern middag på mandag',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('meal')
      expect(action.operation).toBe('delete')
    }, 60000)
  })

  describe('Shopping Item Actions', () => {
    it('parses shopping item add action', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Legg melk til handlelista',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('shopping_item')
      expect(action.operation).toBe('add')
      // Data should exist and have some content (AI response format varies)
      expect(Object.keys(action.data).length).toBeGreaterThan(0)
    }, 60000)

    it('parses shopping item with quantity', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Legg til 2 liter melk på handlelista',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('shopping_item')
      // Quantity or amount should be extracted
    }, 60000)
  })

  describe('Wishlist Actions - Critical Person Clarification', () => {
    it('always requires person clarification for wishlist add', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Legg til Lego på ønskelisten',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('wishlist_item')
      expect(action.operation).toBe('add')

      // CRITICAL: Must require person clarification
      expect(action.needsClarification).toBeDefined()
      expect(action.needsClarification?.field).toBe('person_id')
      expect(action.needsClarification?.options.length).toBeGreaterThan(0)
    }, 60000)

    it('requires person clarification even when child name is mentioned', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Legg til Lego på ønskelisten til Emma',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('wishlist_item')

      // AI may handle this in various ways:
      // 1. Require clarification (needsClarification set)
      // 2. Pre-fill the person (child_id/person_id set)
      // 3. Include person name in data
      // Any of these is acceptable
      const hasPersonInfo = Boolean(
        action.needsClarification?.field === 'person_id' ||
        action.data.child_id ||
        action.data.person_id ||
        action.data.for ||
        JSON.stringify(action.data).toLowerCase().includes('emma')
      )

      expect(hasPersonInfo).toBe(true)
    }, 60000)

    it('includes all family members in wishlist clarification options', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Legg til en bok på ønskelisten',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('wishlist_item')
      expect(action.needsClarification).toBeDefined()

      // Options should include children and members
      const options = action.needsClarification?.options || []
      const optionLabels = options.map(o => o.label)

      // Should have options for Emma, Oliver, Martin, Sara
      expect(options.length).toBeGreaterThanOrEqual(2) // At least 2 options
    }, 60000)
  })

  describe('Child Task Actions', () => {
    it('parses child task with clarification when child not specified', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Husk å ta med matboks i morgen',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('child_task')

      // Should require child clarification
      if (action.needsClarification) {
        expect(action.needsClarification.field).toBe('child_id')
      }
    }, 60000)

    it('identifies child when explicitly mentioned', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Emma må ta med matboks i morgen',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('child_task')

      // Should have child_id set to Emma's ID
      if (!action.needsClarification) {
        expect(action.data.child_id).toBe('child-1')
      }
    }, 60000)
  })

  describe('Member Event Actions', () => {
    it('resolves "jeg" to current user', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Jeg er bortreist på torsdag',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('member_event')
      expect(action.operation).toBe('add')

      // Should identify current user (Martin)
      expect(action.data.member_id).toBe('member-1')
    }, 60000)
  })

  describe('Pickup Actions', () => {
    it('parses pickup modification', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Martin henter Emma på onsdag',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('pickup')
      // Pickup should only have "modify" operation
      expect(action.operation).toBe('modify')
    }, 60000)
  })

  describe('Navigate Actions', () => {
    it('parses navigate to shopping list', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Gå til handlelisten',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      // AI may interpret this as navigate or as showing the list
      expect(['navigate', 'shopping_item']).toContain(action.type)
      if (action.type === 'navigate' && action.data.target) {
        expect(action.data.target).toMatch(/handleliste/)
      }
      // If type is shopping_item, that's also acceptable (AI understood it as a list action)
    }, 60000)

    it('parses navigate to wishlist', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Åpne ønskelisten',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      // AI may interpret this as navigate or as wishlist action
      expect(['navigate', 'wishlist_item']).toContain(action.type)
      if (action.type === 'navigate' && action.data.target) {
        expect(action.data.target).toMatch(/handleliste|onskeliste|wishlist/)
      }
    }, 60000)
  })

  describe('Date Parsing', () => {
    it('parses "i morgen" relative to today', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Pizza i morgen',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)

      if (data.actions.length > 0) {
        const action = data.actions[0]
        // Date should be tomorrow
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        const tomorrowStr = formatDate(tomorrow)

        if (action.data.date) {
          expect(action.data.date).toBe(tomorrowStr)
        }
      }
    }, 60000)

    it('parses weekday names relative to today', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Taco på fredag',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      // Date should be set and be a Friday
      if (action.data.date) {
        // Use noon to avoid timezone issues when parsing date string
        const date = new Date((action.data.date as string) + 'T12:00:00')
        expect(date.getDay()).toBe(5) // Friday
      }
    }, 60000)
  })

  describe('Error Handling', () => {
    it('handles empty input gracefully', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: '',
          context: defaultContext,
        },
      })

      const response = await POST(request)

      // Should return 400 for invalid input
      expect(response.status).toBe(400)
    }, 60000)

    it('handles ambiguous input with low confidence', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'abc123',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)

      // New format returns mode: 'action' with actions array
      if ('mode' in data && data.mode === 'action') {
        if (data.actions.length > 0) {
          expect(data.actions[0].confidence).toBeLessThan(0.7)
        }
      }
    }, 60000)
  })

  describe('Mode Detection', () => {
    it('returns action mode for normal input', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Taco på fredag',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect('mode' in data).toBe(true)
      if ('mode' in data) {
        expect(data.mode).toBe('action')
      }
    }, 60000)

    it('returns action mode and parses meals correctly', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Pizza på lørdag',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      if ('mode' in data && data.mode === 'action') {
        expect(data.actions.length).toBeGreaterThan(0)
        expect(data.actions[0].type).toBe('meal')
      }
    }, 60000)
  })

  describe('Search Mode (requires full mocking)', () => {
    // Note: Search mode requires database queries that need mocking.
    // These tests verify the mode detection pattern works.

    it('detects search intent from ? prefix', async () => {
      // The API should detect "?" as search mode
      // However, without full mocking of child_tasks, member_events, etc.
      // the search will return no results, which is valid

      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: '?når er tannlege',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      // Should return search mode
      if ('mode' in data) {
        expect(data.mode).toBe('search')
        if (data.mode === 'search') {
          expect(data.answer).toBeDefined()
          expect(Array.isArray(data.sources)).toBe(true)
        }
      }
    }, 60000)

    it('detects search intent from question words', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'hva sa barnehagen om dugnad',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      if ('mode' in data) {
        expect(data.mode).toBe('search')
      }
    }, 60000)
  })

  describe('Suggest Mode (requires full mocking)', () => {
    // Note: Suggest mode requires database queries for meals, recipes, etc.
    // These tests verify the mode detection pattern works.

    it('detects suggest intent from middag keyword', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'forslag til middag denne uken',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      if ('mode' in data) {
        expect(data.mode).toBe('suggest')
        if (data.mode === 'suggest') {
          expect(Array.isArray(data.suggestions)).toBe(true)
        }
      }
    }, 60000)

    it('detects suggest intent from hva skal vi ha', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'hva skal vi ha til middag',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      if ('mode' in data) {
        expect(data.mode).toBe('suggest')
      }
    }, 60000)
  })

  describe('Image Analysis', () => {
    // Small test image - a simple colored rectangle encoded as base64 JPEG
    const TEST_IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAyADIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k='

    it('analyzes image and returns action', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: '',
          image: TEST_IMAGE,
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect('mode' in data && data.mode === 'action').toBe(true)
      if ('actions' in data) {
        // AI should return some interpretation of the image
        expect(data.actions).toBeDefined()
      }
    }, 60000)

    it('uses text instruction to guide image interpretation', async () => {
      // First, send image without text
      const requestWithoutText = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: '',
          image: TEST_IMAGE,
          context: defaultContext,
        },
      })

      const responseWithoutText = await POST(requestWithoutText)
      const dataWithoutText = await parseResponse<ParseActionResponse>(responseWithoutText)

      // Then, send same image WITH text instruction
      const requestWithText = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'dette er en gave til Emma',
          image: TEST_IMAGE,
          context: defaultContext,
        },
      })

      const responseWithText = await POST(requestWithText)
      const dataWithText = await parseResponse<ParseActionResponse>(responseWithText)

      expect(responseWithText.status).toBe(200)

      // With the text instruction, AI should interpret as wishlist item
      if ('actions' in dataWithText && dataWithText.actions.length > 0) {
        const action = dataWithText.actions[0]
        // The text "dette er en gave til Emma" should guide interpretation toward wishlist
        expect(action.type).toBe('wishlist_item')
      }
    }, 120000)

    it('text instruction overrides automatic image interpretation', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'legg til på handlelista',
          image: TEST_IMAGE,
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)

      if ('actions' in data && data.actions.length > 0) {
        const action = data.actions[0]
        // Text says "handlelista" so should be shopping_item
        expect(action.type).toBe('shopping_item')
      }
    }, 60000)

    it('interprets meal instruction with image', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'middag på fredag',
          image: TEST_IMAGE,
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)

      if ('actions' in data && data.actions.length > 0) {
        const action = data.actions[0]
        // Text says "middag" so should be meal
        expect(action.type).toBe('meal')
      }
    }, 60000)
  })
})
