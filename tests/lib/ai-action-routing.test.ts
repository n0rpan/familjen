import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  determineActionRouting,
  prepareNavigation,
  consumePrefillData,
  hasPrefillQueryParam,
  PREFILL_STORAGE_KEYS,
  PREFILL_ROUTES,
  type RoutingDecision,
  type NavigateDecision,
  type QuickCardDecision,
} from '@/lib/ai-action-routing'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get _store() {
      return store
    },
  }
})()

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
})

describe('ai-action-routing', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  describe('determineActionRouting', () => {
    describe('non-add operations', () => {
      it('returns shouldNavigate=false for modify operations', () => {
        const result = determineActionRouting('recipe', 'modify', { name: 'Test' })
        expect(result.shouldNavigate).toBe(false)
        expect(result.reason).toContain('modify')
      })

      it('returns shouldNavigate=false for delete operations', () => {
        const result = determineActionRouting('child_task', 'delete', { title: 'Test' })
        expect(result.shouldNavigate).toBe(false)
        expect(result.reason).toContain('delete')
      })

      it('returns shouldNavigate=false for complete operations', () => {
        const result = determineActionRouting('shopping_item', 'complete', { item_name: 'Milk' })
        expect(result.shouldNavigate).toBe(false)
        expect(result.reason).toContain('complete')
      })
    })

    describe('recipe routing', () => {
      it('always navigates for recipe add operations', () => {
        const result = determineActionRouting('recipe', 'add', { name: 'Pasta' })
        expect(result.shouldNavigate).toBe(true)
        expect(result.route).toBe(PREFILL_ROUTES.recipe)
        expect(result.queryParam).toBe('addRecipe=true')
        expect(result.storageKey).toBe(PREFILL_STORAGE_KEYS.recipe)
      })

      it('preserves recipe data in prefill', () => {
        const result = determineActionRouting('recipe', 'add', {
          name: 'Pasta Carbonara',
          instructions: 'Boil pasta...',
          is_quick: true,
          is_kid_friendly: false,
          ingredients: [{ item: 'pasta', amount: '500g' }],
        })

        expect(result.prefillData?.type).toBe('recipe')
        expect(result.prefillData?.data).toMatchObject({
          name: 'Pasta Carbonara',
          instructions: 'Boil pasta...',
          is_quick: true,
          is_kid_friendly: false,
        })
      })

      it('converts string ingredients to objects', () => {
        const result = determineActionRouting('recipe', 'add', {
          name: 'Salad',
          ingredients: ['lettuce', 'tomato', 'cucumber'],
        })

        const prefill = result.prefillData?.data as { ingredients?: Array<{ item: string; amount: string }> }
        expect(prefill.ingredients).toEqual([
          { item: 'lettuce', amount: '' },
          { item: 'tomato', amount: '' },
          { item: 'cucumber', amount: '' },
        ])
      })

      it('uses link field as fallback for external_link', () => {
        const result = determineActionRouting('recipe', 'add', {
          name: 'Online Recipe',
          link: 'https://example.com/recipe',
        })

        const prefill = result.prefillData?.data as { external_link?: string }
        expect(prefill.external_link).toBe('https://example.com/recipe')
      })
    })

    describe('wishlist_item routing', () => {
      it('always navigates for wishlist add operations', () => {
        const result = determineActionRouting('wishlist_item', 'add', { name: 'Lego set' })
        expect(result.shouldNavigate).toBe(true)
        expect(result.route).toBe(PREFILL_ROUTES.wishlist)
        expect(result.queryParam).toBe('addWishlist=true')
      })

      it('preserves wishlist data with price and link', () => {
        const result = determineActionRouting('wishlist_item', 'add', {
          name: 'Nintendo Switch',
          price: 2999,
          link: 'https://example.com/switch',
          occasion: 'birthday',
          child_id: 'child-123',
        })

        expect(result.prefillData?.data).toMatchObject({
          name: 'Nintendo Switch',
          price: 2999,
          link: 'https://example.com/switch',
          occasion: 'birthday',
          childId: 'child-123',
        })
      })

      it('handles product_name alias for name', () => {
        const result = determineActionRouting('wishlist_item', 'add', {
          product_name: 'iPhone 16',
        })

        expect(result.prefillData?.data).toMatchObject({
          name: 'iPhone 16',
        })
      })
    })

    describe('member_event routing', () => {
      it('does not navigate for simple events with few fields', () => {
        const result = determineActionRouting('member_event', 'add', {
          title: 'Meeting',
          date: '2025-01-15',
          confidence: 0.9,
        })
        expect(result.shouldNavigate).toBe(false)
        expect(result.reason).toContain('Simple event')
      })

      it('navigates for events with date range', () => {
        const result = determineActionRouting('member_event', 'add', {
          title: 'Vacation',
          date: '2025-06-01',
          end_date: '2025-06-15',
        })
        expect(result.shouldNavigate).toBe(true)
        expect(result.reason).toContain('Multi-day')
      })

      it('navigates for events with many fields', () => {
        const result = determineActionRouting('member_event', 'add', {
          title: 'Conference',
          date: '2025-03-20',
          event_type: 'work',
          member_id: 'member-123',
          notes: 'Important presentation',
        })
        expect(result.shouldNavigate).toBe(true)
      })

      it('navigates for low confidence events', () => {
        const result = determineActionRouting('member_event', 'add', {
          title: 'Something',
          date: '2025-01-20',
          confidence: 0.5,
        })
        expect(result.shouldNavigate).toBe(true)
      })

      it('navigates when end_date equals date due to field count (3 fields)', () => {
        // When end_date equals date, hasDateRange is false
        // But title + date + end_date = 3 meaningful fields, which triggers navigation
        const result = determineActionRouting('member_event', 'add', {
          title: 'Same Day Event',
          date: '2025-01-15',
          end_date: '2025-01-15', // Same as start date - not a date range, but still counts as field
          confidence: 0.9,
        })
        expect(result.shouldNavigate).toBe(true)
        // Should NOT mention multi-day since hasDateRange is false
        expect(result.reason).not.toContain('Multi-day')
      })

      it('navigates when field count reaches exactly 3', () => {
        const result = determineActionRouting('member_event', 'add', {
          title: 'Work Meeting',
          date: '2025-01-15',
          event_type: 'work', // 3rd meaningful field triggers navigation
        })
        expect(result.shouldNavigate).toBe(true)
      })
    })

    describe('child_task routing', () => {
      it('does not navigate for simple reminders', () => {
        const result = determineActionRouting('child_task', 'add', {
          title: 'Do homework',
          date: '2025-01-15',
          task_type: 'reminder',
        })
        expect(result.shouldNavigate).toBe(false)
        expect(result.reason).toContain('Simple task')
      })

      it('navigates for appointments', () => {
        const result = determineActionRouting('child_task', 'add', {
          title: 'Doctor visit',
          task_type: 'appointment',
          date: '2025-02-10',
        })
        expect(result.shouldNavigate).toBe(true)
        expect(result.reason).toContain('Appointments')
      })

      it('navigates for tasks with time', () => {
        const result = determineActionRouting('child_task', 'add', {
          title: 'Piano lesson',
          date: '2025-01-18',
          time: '15:00',
        })
        expect(result.shouldNavigate).toBe(true)
      })

      it('navigates for tasks with notes', () => {
        const result = determineActionRouting('child_task', 'add', {
          title: 'Bring gym clothes',
          date: '2025-01-17',
          notes: 'Remember water bottle too',
        })
        expect(result.shouldNavigate).toBe(true)
      })

      it('uses name field as fallback for title', () => {
        const result = determineActionRouting('child_task', 'add', {
          name: 'Task from name field',
          task_type: 'appointment',
          date: '2025-02-10',
        })

        expect(result.shouldNavigate).toBe(true)
        const prefill = result.prefillData?.data as { title?: string }
        expect(prefill.title).toBe('Task from name field')
      })
    })

    describe('quick action types', () => {
      it('never navigates for pickup actions', () => {
        const result = determineActionRouting('pickup', 'add', {
          child_id: 'child-123',
          date: '2025-01-15',
          picker_id: 'member-456',
        })
        expect(result.shouldNavigate).toBe(false)
        expect(result.reason).toContain('quick card')
      })

      it('never navigates for shopping_item actions', () => {
        const result = determineActionRouting('shopping_item', 'add', {
          item_name: 'Milk',
          quantity: '2L',
        })
        expect(result.shouldNavigate).toBe(false)
      })

      it('never navigates for meal actions', () => {
        const result = determineActionRouting('meal', 'add', {
          meal_name: 'Tacos',
          date: '2025-01-16',
        })
        expect(result.shouldNavigate).toBe(false)
      })
    })

    describe('unknown action types', () => {
      it('returns shouldNavigate=false for unknown types', () => {
        const result = determineActionRouting('unknown_type', 'add', { name: 'Test' })
        expect(result.shouldNavigate).toBe(false)
        expect(result.reason).toContain('Unknown action type')
      })
    })
  })

  describe('prepareNavigation', () => {
    it('returns null when shouldNavigate is false', () => {
      const decision: QuickCardDecision = {
        shouldNavigate: false,
        reason: 'Quick action',
      }
      const result = prepareNavigation(decision, false)
      expect(result).toBeNull()
    })

    it('stores prefill data in localStorage and returns URL', () => {
      const decision: NavigateDecision = {
        shouldNavigate: true,
        route: '/oppskrifter',
        queryParam: 'addRecipe=true',
        storageKey: 'recipe-prefill',
        prefillData: { type: 'recipe', data: { name: 'Pasta' } },
        reason: 'Recipe needs full form',
      }

      const result = prepareNavigation(decision, false)

      expect(result).toBe('/oppskrifter?addRecipe=true')
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'recipe-prefill',
        JSON.stringify({ name: 'Pasta' })
      )
    })

    it('adds demo param when isDemo is true', () => {
      const decision: NavigateDecision = {
        shouldNavigate: true,
        route: '/handleliste',
        queryParam: 'addWishlist=true',
        storageKey: 'wishlist-prefill',
        prefillData: { type: 'wishlist', data: { name: 'Gift' } },
        reason: 'Wishlist needs full form',
      }

      const result = prepareNavigation(decision, true)

      expect(result).toBe('/handleliste?demo=true&addWishlist=true')
    })

    it('returns null when localStorage throws', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('Storage full')
      })

      const decision: NavigateDecision = {
        shouldNavigate: true,
        route: '/oppskrifter',
        queryParam: 'addRecipe=true',
        storageKey: 'recipe-prefill',
        prefillData: { type: 'recipe', data: { name: 'Pasta' } },
        reason: 'Recipe needs full form',
      }

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = prepareNavigation(decision, false)

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('type guards correctly narrow the decision type', () => {
      // This test verifies the discriminated union works correctly at compile time
      const navigateDecision = determineActionRouting('recipe', 'add', { name: 'Pasta' })

      if (navigateDecision.shouldNavigate) {
        // TypeScript knows these fields exist (NavigateDecision)
        expect(navigateDecision.route).toBeDefined()
        expect(navigateDecision.queryParam).toBeDefined()
        expect(navigateDecision.storageKey).toBeDefined()
        expect(navigateDecision.prefillData).toBeDefined()
      }

      const quickDecision = determineActionRouting('shopping_item', 'add', { item_name: 'Milk' })

      if (!quickDecision.shouldNavigate) {
        // TypeScript knows only reason exists (QuickCardDecision)
        expect(quickDecision.reason).toBeDefined()
      }
    })
  })

  describe('consumePrefillData', () => {
    it('returns null when no data exists', () => {
      const result = consumePrefillData<{ name: string }>('nonexistent-key')
      expect(result).toBeNull()
    })

    it('returns parsed data and removes from localStorage', () => {
      localStorageMock.setItem('test-key', JSON.stringify({ name: 'Test', value: 42 }))

      const result = consumePrefillData<{ name: string; value: number }>('test-key')

      expect(result).toEqual({ name: 'Test', value: 42 })
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('test-key')
    })

    it('returns null and logs error for invalid JSON', () => {
      localStorageMock.getItem.mockReturnValueOnce('invalid json {')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = consumePrefillData<{ name: string }>('bad-key')

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('hasPrefillQueryParam', () => {
    it('detects addRecipe param', () => {
      const params = new URLSearchParams('addRecipe=true')
      const result = hasPrefillQueryParam(params)
      expect(result).toEqual({
        hasRecipe: true,
        hasWishlist: false,
        hasEvent: false,
        hasTask: false,
      })
    })

    it('detects addWishlist param', () => {
      const params = new URLSearchParams('addWishlist=true')
      const result = hasPrefillQueryParam(params)
      expect(result).toEqual({
        hasRecipe: false,
        hasWishlist: true,
        hasEvent: false,
        hasTask: false,
      })
    })

    it('detects addEvent param', () => {
      const params = new URLSearchParams('addEvent=true')
      const result = hasPrefillQueryParam(params)
      expect(result).toEqual({
        hasRecipe: false,
        hasWishlist: false,
        hasEvent: true,
        hasTask: false,
      })
    })

    it('detects addTask param', () => {
      const params = new URLSearchParams('addTask=true')
      const result = hasPrefillQueryParam(params)
      expect(result).toEqual({
        hasRecipe: false,
        hasWishlist: false,
        hasEvent: false,
        hasTask: true,
      })
    })

    it('detects multiple params', () => {
      const params = new URLSearchParams('addRecipe=true&addWishlist=true')
      const result = hasPrefillQueryParam(params)
      expect(result.hasRecipe).toBe(true)
      expect(result.hasWishlist).toBe(true)
    })

    it('returns false for param with wrong value', () => {
      const params = new URLSearchParams('addRecipe=false')
      const result = hasPrefillQueryParam(params)
      expect(result.hasRecipe).toBe(false)
    })

    it('returns all false for empty params', () => {
      const params = new URLSearchParams('')
      const result = hasPrefillQueryParam(params)
      expect(result).toEqual({
        hasRecipe: false,
        hasWishlist: false,
        hasEvent: false,
        hasTask: false,
      })
    })
  })

  describe('PREFILL_STORAGE_KEYS', () => {
    it('has correct storage keys', () => {
      expect(PREFILL_STORAGE_KEYS.recipe).toBe('recipe-prefill')
      expect(PREFILL_STORAGE_KEYS.wishlist).toBe('wishlist-prefill')
      expect(PREFILL_STORAGE_KEYS.memberEvent).toBe('member-event-prefill')
      expect(PREFILL_STORAGE_KEYS.childTask).toBe('child-task-prefill')
    })
  })

  describe('PREFILL_ROUTES', () => {
    it('has correct routes', () => {
      expect(PREFILL_ROUTES.recipe).toBe('/oppskrifter')
      expect(PREFILL_ROUTES.wishlist).toBe('/handleliste')
      expect(PREFILL_ROUTES.memberEvent).toBe('/uke')
      expect(PREFILL_ROUTES.childTask).toBe('/uke')
    })
  })
})
