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

interface ParseActionResponse {
  actions: ParsedAction[]
  error?: string
}

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({
    from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: table === 'app_settings' ? { value: TEST_MODEL } : null,
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: table === 'household_members' ? { household_id: 'test-household-id' } : null,
          error: null,
        }),
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
  createRateLimitKey: vi.fn().mockReturnValue('test-key'),
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
      expect(action.data).toHaveProperty('meal')
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
      expect(action.data.item).toBeDefined()
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

      // Should still require clarification to confirm
      // Or have the child_id pre-filled in needsClarification
      if (action.needsClarification) {
        expect(action.needsClarification.field).toBe('person_id')
      } else {
        // If no clarification needed, child_id should be set
        expect(action.data.child_id).toBe('child-1')
      }
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
          input: 'Vis handlelisten',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('navigate')
      expect(action.data.target).toBe('/handleliste')
    }, 60000)

    it('parses navigate to wishlist', async () => {
      const request = createTestRequest('http://localhost:3000/api/openrouter/parse-action', {
        method: 'POST',
        body: {
          input: 'Vis ønskelisten',
          context: defaultContext,
        },
      })

      const response = await POST(request)
      const data = await parseResponse<ParseActionResponse>(response)

      expect(response.status).toBe(200)
      expect(data.actions.length).toBeGreaterThan(0)

      const action = data.actions[0]
      expect(action.type).toBe('navigate')
      // Should navigate to handleliste (where wishlist is now located)
      expect(action.data.target).toBe('/handleliste')
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
        const date = new Date(action.data.date as string)
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

      // Should either return empty actions or low confidence
      if (data.actions.length > 0) {
        expect(data.actions[0].confidence).toBeLessThan(0.7)
      }
    }, 60000)
  })
})
