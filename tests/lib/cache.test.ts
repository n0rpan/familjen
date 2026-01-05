import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { updateCacheWithRealtimeChange, getCached, setCache } from '@/lib/cache'

// Mock IndexedDB
const mockStore = new Map<string, unknown>()

const mockObjectStore = {
  get: vi.fn((key: string) => ({
    result: mockStore.get(key),
    onerror: null as (() => void) | null,
    onsuccess: null as (() => void) | null,
  })),
  put: vi.fn((entry: { key: string; data: unknown }) => {
    mockStore.set(entry.key, entry)
    return {
      onerror: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
    }
  }),
}

const mockTransaction = {
  objectStore: vi.fn(() => mockObjectStore),
  onabort: null as (() => void) | null,
}

const mockDb = {
  transaction: vi.fn(() => mockTransaction),
  objectStoreNames: { contains: vi.fn(() => true) },
  createObjectStore: vi.fn(),
  close: vi.fn(),
  onclose: null as (() => void) | null,
  onversionchange: null as (() => void) | null,
  onerror: null as ((event: unknown) => void) | null,
}

// Mock indexedDB.open
const mockOpenRequest = {
  result: mockDb,
  error: null,
  onerror: null as (() => void) | null,
  onsuccess: null as (() => void) | null,
  onupgradeneeded: null as ((event: unknown) => void) | null,
}

vi.stubGlobal('indexedDB', {
  open: vi.fn(() => {
    // Simulate async behavior
    setTimeout(() => {
      mockOpenRequest.onsuccess?.()
    }, 0)
    return mockOpenRequest
  }),
})

describe('updateCacheWithRealtimeChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.clear()

    // Setup mock to trigger success callbacks
    mockObjectStore.get.mockImplementation((key: string) => {
      const request = {
        result: mockStore.get(key),
        error: null,
        onerror: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
      }
      setTimeout(() => request.onsuccess?.(), 0)
      return request
    })

    mockObjectStore.put.mockImplementation((entry: { key: string; data: unknown }) => {
      mockStore.set(entry.key, entry)
      const request = {
        error: null,
        onerror: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
      }
      setTimeout(() => request.onsuccess?.(), 0)
      return request
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('INSERT operations', () => {
    it('adds new pickup to cache', async () => {
      // Setup: cache with existing pickups
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [{ id: 'pickup-1', date: '2024-12-16', child_id: 'child-1' }],
        meals: [],
        tasks: [],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      // Act: insert new pickup
      const newPickup = { id: 'pickup-2', date: '2024-12-17', child_id: 'child-2' }
      await updateCacheWithRealtimeChange(cacheKey, 'pickups', 'INSERT', newPickup)

      // Assert: cache should have both pickups
      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.pickups).toHaveLength(2)
      expect(cached.data.pickups).toContainEqual(newPickup)
    })

    it('adds new meal to cache', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [],
        meals: [{ id: 'meal-1', date: '2024-12-16', recipe_id: 'recipe-1' }],
        tasks: [],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      const newMeal = { id: 'meal-2', date: '2024-12-17', custom_meal: 'Taco' }
      await updateCacheWithRealtimeChange(cacheKey, 'meals', 'INSERT', newMeal)

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.meals).toHaveLength(2)
      expect(cached.data.meals).toContainEqual(newMeal)
    })

    it('adds new child_task to tasks array', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [],
        meals: [],
        tasks: [{ id: 'task-1', title: 'Bring swimsuit' }],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      const newTask = { id: 'task-2', title: 'Doctor appointment' }
      await updateCacheWithRealtimeChange(cacheKey, 'child_tasks', 'INSERT', newTask)

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.tasks).toHaveLength(2)
      expect(cached.data.tasks).toContainEqual(newTask)
    })

    it('adds new member_event to memberEvents array', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [],
        meals: [],
        tasks: [],
        memberEvents: [{ id: 'event-1', title: 'Work trip' }],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      const newEvent = { id: 'event-2', title: 'Conference' }
      await updateCacheWithRealtimeChange(cacheKey, 'member_events', 'INSERT', newEvent)

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.memberEvents).toHaveLength(2)
      expect(cached.data.memberEvents).toContainEqual(newEvent)
    })

    it('adds new household_event to householdEvents array', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [],
        meals: [],
        tasks: [],
        householdEvents: [{ id: 'event-1', title: 'Family dinner' }],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      const newEvent = { id: 'event-2', title: 'Birthday party' }
      await updateCacheWithRealtimeChange(cacheKey, 'household_events', 'INSERT', newEvent)

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.householdEvents).toHaveLength(2)
    })
  })

  describe('UPDATE operations', () => {
    it('updates existing pickup in cache', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [
          { id: 'pickup-1', date: '2024-12-16', picker_id: 'member-1' },
          { id: 'pickup-2', date: '2024-12-17', picker_id: 'member-1' },
        ],
        meals: [],
        tasks: [],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      // Update pickup-1 to have different picker
      const updatedPickup = { id: 'pickup-1', picker_id: 'member-2' }
      await updateCacheWithRealtimeChange(cacheKey, 'pickups', 'UPDATE', updatedPickup)

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.pickups).toHaveLength(2)
      const updated = cached.data.pickups.find(p => p.id === 'pickup-1')
      expect(updated?.picker_id).toBe('member-2')
      expect(updated?.date).toBe('2024-12-16') // Original field preserved
    })

    it('merges update with existing data (partial update)', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [],
        meals: [{ id: 'meal-1', date: '2024-12-16', recipe_id: 'recipe-1', notes: 'original' }],
        tasks: [],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      // Partial update - only changing notes
      const update = { id: 'meal-1', notes: 'updated notes' }
      await updateCacheWithRealtimeChange(cacheKey, 'meals', 'UPDATE', update)

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      const meal = cached.data.meals[0]
      expect(meal.notes).toBe('updated notes')
      expect(meal.recipe_id).toBe('recipe-1') // Other fields preserved
      expect(meal.date).toBe('2024-12-16')
    })

    it('does nothing if item not found for update', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [{ id: 'pickup-1', date: '2024-12-16' }],
        meals: [],
        tasks: [],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      // Try to update non-existent pickup
      const update = { id: 'pickup-999', date: '2024-12-20' }
      await updateCacheWithRealtimeChange(cacheKey, 'pickups', 'UPDATE', update)

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.pickups).toHaveLength(1)
      expect(cached.data.pickups[0].id).toBe('pickup-1')
    })
  })

  describe('DELETE operations', () => {
    it('removes pickup from cache', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [
          { id: 'pickup-1', date: '2024-12-16' },
          { id: 'pickup-2', date: '2024-12-17' },
        ],
        meals: [],
        tasks: [],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'pickups', 'DELETE', { id: 'pickup-1' })

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.pickups).toHaveLength(1)
      expect(cached.data.pickups[0].id).toBe('pickup-2')
    })

    it('removes task from cache', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [],
        meals: [],
        tasks: [
          { id: 'task-1', title: 'Task A' },
          { id: 'task-2', title: 'Task B' },
          { id: 'task-3', title: 'Task C' },
        ],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'child_tasks', 'DELETE', { id: 'task-2' })

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.tasks).toHaveLength(2)
      expect(cached.data.tasks.map(t => t.id)).toEqual(['task-1', 'task-3'])
    })

    it('does nothing if item not found for delete', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [{ id: 'pickup-1', date: '2024-12-16' }],
        meals: [],
        tasks: [],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'pickups', 'DELETE', { id: 'pickup-999' })

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.pickups).toHaveLength(1)
    })
  })

  describe('Edge cases', () => {
    it('does nothing if cache does not exist', async () => {
      const cacheKey = 'home-nonexistent'
      // No cache set

      // Should not throw
      await updateCacheWithRealtimeChange(cacheKey, 'pickups', 'INSERT', { id: 'pickup-1' })

      // Cache should still not exist
      expect(mockStore.has(cacheKey)).toBe(false)
    })

    it('does nothing if table not in mapping', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [{ id: 'pickup-1' }],
        meals: [],
        tasks: [],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      // Unknown table
      await updateCacheWithRealtimeChange(cacheKey, 'unknown_table', 'INSERT', { id: 'item-1' })

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.pickups).toHaveLength(1) // Unchanged
    })

    it('does nothing if array field does not exist in cache', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [{ id: 'pickup-1' }],
        // meals array is missing
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'meals', 'INSERT', { id: 'meal-1' })

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data).not.toHaveProperty('meals')
    })

    it('uses custom idField when provided', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [],
        meals: [],
        tasks: [],
        externalEvents: [
          { external_id: 'ext-1', title: 'Event A' },
          { external_id: 'ext-2', title: 'Event B' },
        ],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      // Delete using external_id instead of id
      await updateCacheWithRealtimeChange(
        cacheKey,
        'external_events',
        'DELETE',
        { external_id: 'ext-1' },
        'external_id'
      )

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.externalEvents).toHaveLength(1)
      expect(cached.data.externalEvents[0].external_id).toBe('ext-2')
    })

    it('handles empty arrays gracefully', async () => {
      const cacheKey = 'home-household-123'
      const existingData = {
        pickups: [],
        meals: [],
        tasks: [],
      }
      mockStore.set(cacheKey, { key: cacheKey, data: existingData, timestamp: Date.now() })

      // Delete from empty array
      await updateCacheWithRealtimeChange(cacheKey, 'pickups', 'DELETE', { id: 'pickup-1' })

      const cached = mockStore.get(cacheKey) as { data: typeof existingData }
      expect(cached.data.pickups).toHaveLength(0)
    })
  })

  describe('Table to field mapping', () => {
    it('maps pickups table to pickups field', async () => {
      const cacheKey = 'test'
      mockStore.set(cacheKey, { key: cacheKey, data: { pickups: [] }, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'pickups', 'INSERT', { id: '1' })

      const cached = mockStore.get(cacheKey) as { data: { pickups: unknown[] } }
      expect(cached.data.pickups).toHaveLength(1)
    })

    it('maps meals table to meals field', async () => {
      const cacheKey = 'test'
      mockStore.set(cacheKey, { key: cacheKey, data: { meals: [] }, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'meals', 'INSERT', { id: '1' })

      const cached = mockStore.get(cacheKey) as { data: { meals: unknown[] } }
      expect(cached.data.meals).toHaveLength(1)
    })

    it('maps child_tasks table to tasks field', async () => {
      const cacheKey = 'test'
      mockStore.set(cacheKey, { key: cacheKey, data: { tasks: [] }, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'child_tasks', 'INSERT', { id: '1' })

      const cached = mockStore.get(cacheKey) as { data: { tasks: unknown[] } }
      expect(cached.data.tasks).toHaveLength(1)
    })

    it('maps member_events table to memberEvents field', async () => {
      const cacheKey = 'test'
      mockStore.set(cacheKey, { key: cacheKey, data: { memberEvents: [] }, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'member_events', 'INSERT', { id: '1' })

      const cached = mockStore.get(cacheKey) as { data: { memberEvents: unknown[] } }
      expect(cached.data.memberEvents).toHaveLength(1)
    })

    it('maps household_events table to householdEvents field', async () => {
      const cacheKey = 'test'
      mockStore.set(cacheKey, { key: cacheKey, data: { householdEvents: [] }, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'household_events', 'INSERT', { id: '1' })

      const cached = mockStore.get(cacheKey) as { data: { householdEvents: unknown[] } }
      expect(cached.data.householdEvents).toHaveLength(1)
    })

    it('maps external_events table to externalEvents field', async () => {
      const cacheKey = 'test'
      mockStore.set(cacheKey, { key: cacheKey, data: { externalEvents: [] }, timestamp: Date.now() })

      await updateCacheWithRealtimeChange(cacheKey, 'external_events', 'INSERT', { id: '1' })

      const cached = mockStore.get(cacheKey) as { data: { externalEvents: unknown[] } }
      expect(cached.data.externalEvents).toHaveLength(1)
    })
  })
})
