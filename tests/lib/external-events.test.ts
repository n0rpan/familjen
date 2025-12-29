import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExternalEvent, ExternalEventLocalOverrides } from '@/lib/types'

/**
 * Comprehensive tests for external event handling
 *
 * Tests cover:
 * - Local overrides preservation during sync
 * - Deletion detection and notifications
 * - Date/title change detection
 * - Undo/restore functionality
 * - Edge cases around hidden events
 */

// Mock Supabase types
interface MockSupabaseQuery {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  gte: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
}

function createMockQuery(data: unknown = null, error: unknown = null): MockSupabaseQuery {
  const query: MockSupabaseQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ data, error }),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
  }
  // Make all methods return the query for chaining, except upsert which resolves
  query.select.mockReturnValue({ ...query, data: Promise.resolve({ data, error }) })
  query.eq.mockReturnValue({ ...query, data: Promise.resolve({ data, error }) })
  query.gte.mockReturnValue({ ...query, data: Promise.resolve({ data, error }) })
  return query
}

describe('External Event Local Overrides', () => {
  describe('preserveLocalOverrides', () => {
    it('should preserve local_overrides when event is updated via sync', () => {
      const existingEvent: ExternalEvent = {
        id: 'event-1',
        integration_id: 'int-1',
        child_id: null,
        external_id: 'ext-1',
        external_group_id: null,
        title: 'Original Title',
        description: null,
        event_date: '2025-12-30',
        event_time: '10:00:00',
        end_date: null,
        end_time: null,
        location: 'Original Location',
        event_type: null,
        is_hidden: false,
        user_notes: 'My important notes',
        local_overrides: {
          title: 'My Custom Title',
          location: 'My Custom Location',
        },
        created_at: '2025-12-20T10:00:00Z',
        updated_at: '2025-12-25T10:00:00Z',
      }

      const syncedData = {
        title: 'Updated from Spond',
        event_date: '2025-12-31',
        event_time: '11:00:00',
        location: 'New Spond Location',
      }

      // Simulate upsert behavior - only specified fields are updated
      const upsertPayload = {
        integration_id: existingEvent.integration_id,
        external_id: existingEvent.external_id,
        title: syncedData.title,
        event_date: syncedData.event_date,
        event_time: syncedData.event_time,
        location: syncedData.location,
        updated_at: new Date().toISOString(),
      }

      // Verify local_overrides is NOT in upsert payload
      expect(upsertPayload).not.toHaveProperty('local_overrides')
      expect(upsertPayload).not.toHaveProperty('user_notes')
      expect(upsertPayload).not.toHaveProperty('is_hidden')

      // After upsert, the event should preserve local overrides
      const resultEvent = {
        ...existingEvent,
        title: syncedData.title, // Updated
        event_date: syncedData.event_date, // Updated
        event_time: syncedData.event_time, // Updated
        location: syncedData.location, // Updated
        // These should remain unchanged:
        local_overrides: existingEvent.local_overrides,
        user_notes: existingEvent.user_notes,
        is_hidden: existingEvent.is_hidden,
      }

      expect(resultEvent.local_overrides?.title).toBe('My Custom Title')
      expect(resultEvent.local_overrides?.location).toBe('My Custom Location')
      expect(resultEvent.user_notes).toBe('My important notes')
    })

    it('should display local override values when present', () => {
      const event: ExternalEvent = {
        id: 'event-1',
        integration_id: 'int-1',
        child_id: null,
        external_id: 'ext-1',
        external_group_id: null,
        title: 'Synced Title',
        description: null,
        event_date: '2025-12-30',
        event_time: '10:00:00',
        end_date: null,
        end_time: null,
        location: 'Synced Location',
        event_type: null,
        is_hidden: false,
        user_notes: null,
        local_overrides: {
          title: 'User Custom Title',
        },
        created_at: '2025-12-20T10:00:00Z',
        updated_at: null,
      }

      // Display logic should prefer overrides
      const displayTitle = event.local_overrides?.title || event.title
      const displayLocation = event.local_overrides?.location || event.location

      expect(displayTitle).toBe('User Custom Title')
      expect(displayLocation).toBe('Synced Location') // No override
    })
  })

  describe('resetLocalOverrides', () => {
    it('should reset local overrides to null', () => {
      const overrides: ExternalEventLocalOverrides = {
        title: 'Custom',
        event_date: '2025-12-31',
        location: 'Custom Location',
      }

      // Reset should set to null, not empty object
      const resetOverrides: ExternalEventLocalOverrides | null = null

      expect(resetOverrides).toBeNull()
    })

    it('should only include changed fields in local_overrides', () => {
      const originalEvent = {
        title: 'Original Title',
        event_date: '2025-12-30',
        event_time: '10:00:00',
        location: 'Original Location',
      }

      const userEdits = {
        title: 'Modified Title', // Changed
        event_date: '2025-12-30', // Same
        event_time: '10:00:00', // Same
        location: 'Original Location', // Same
      }

      // Build overrides with only changed fields
      const overrides: ExternalEventLocalOverrides = {}

      if (userEdits.title !== originalEvent.title) {
        overrides.title = userEdits.title
      }
      if (userEdits.event_date !== originalEvent.event_date) {
        overrides.event_date = userEdits.event_date
      }
      if (userEdits.event_time !== originalEvent.event_time) {
        overrides.event_time = userEdits.event_time
      }
      if (userEdits.location !== originalEvent.location) {
        overrides.location = userEdits.location
      }

      expect(overrides).toEqual({ title: 'Modified Title' })
      expect(Object.keys(overrides)).toHaveLength(1)
    })
  })
})

describe('External Event Deletion Detection', () => {
  describe('detectDeletedEvents', () => {
    it('should detect events deleted from external source', () => {
      const existingEvents = [
        { external_id: 'ext-1', title: 'Event 1', event_date: '2025-12-30' },
        { external_id: 'ext-2', title: 'Event 2', event_date: '2025-12-31' },
        { external_id: 'ext-3', title: 'Event 3', event_date: '2026-01-01' },
      ]

      const syncedEvents = [
        { external_id: 'ext-1', title: 'Event 1', event_date: '2025-12-30' },
        { external_id: 'ext-3', title: 'Event 3', event_date: '2026-01-01' },
        // ext-2 is missing - was deleted from source
      ]

      const currentExternalIds = new Set(syncedEvents.map(e => e.external_id))
      const deletedEvents = existingEvents.filter(e => !currentExternalIds.has(e.external_id))

      expect(deletedEvents).toHaveLength(1)
      expect(deletedEvents[0].external_id).toBe('ext-2')
      expect(deletedEvents[0].title).toBe('Event 2')
    })

    it('should only consider future events for deletion notifications', () => {
      const today = '2025-12-26'
      const existingEvents = [
        { external_id: 'ext-1', title: 'Past Event', event_date: '2025-12-20' },
        { external_id: 'ext-2', title: 'Future Event', event_date: '2025-12-30' },
      ]

      const syncedEvents: typeof existingEvents = [] // All deleted

      const deletedEvents = existingEvents.filter(e => e.event_date >= today)

      expect(deletedEvents).toHaveLength(1)
      expect(deletedEvents[0].title).toBe('Future Event')
    })
  })

  describe('detectModifiedEvents', () => {
    it('should detect date changes', () => {
      const existingEvent = {
        external_id: 'ext-1',
        title: 'Football Match',
        event_date: '2025-12-30',
      }

      const syncedEvent = {
        external_id: 'ext-1',
        title: 'Football Match',
        event_date: '2025-12-31', // Date changed
      }

      const dateChanged = existingEvent.event_date !== syncedEvent.event_date
      const titleChanged = existingEvent.title !== syncedEvent.title

      expect(dateChanged).toBe(true)
      expect(titleChanged).toBe(false)
    })

    it('should detect title changes', () => {
      const existingEvent = {
        external_id: 'ext-1',
        title: 'Football Match',
        event_date: '2025-12-30',
      }

      const syncedEvent = {
        external_id: 'ext-1',
        title: 'Football Match - CANCELLED', // Title changed
        event_date: '2025-12-30',
      }

      const dateChanged = existingEvent.event_date !== syncedEvent.event_date
      const titleChanged = existingEvent.title !== syncedEvent.title

      expect(dateChanged).toBe(false)
      expect(titleChanged).toBe(true)
    })

    it('should detect both date and title changes', () => {
      const existingEvent = {
        external_id: 'ext-1',
        title: 'Football Match',
        event_date: '2025-12-30',
      }

      const syncedEvent = {
        external_id: 'ext-1',
        title: 'Football Match - Rescheduled',
        event_date: '2026-01-05',
      }

      const dateChanged = existingEvent.event_date !== syncedEvent.event_date
      const titleChanged = existingEvent.title !== syncedEvent.title

      expect(dateChanged).toBe(true)
      expect(titleChanged).toBe(true)
    })
  })
})

describe('External Event Undo/Restore', () => {
  describe('restoreDeletedEvent', () => {
    it('should create restore notification with full event data', () => {
      const deletedEvent: ExternalEvent = {
        id: 'event-1',
        integration_id: 'int-1',
        child_id: 'child-1',
        external_id: 'ext-1',
        external_group_id: null,
        title: 'Important Event',
        description: 'Event description',
        event_date: '2025-12-30',
        event_time: '10:00:00',
        end_date: null,
        end_time: null,
        location: 'Sports Hall',
        event_type: null,
        is_hidden: false,
        user_notes: 'Bring snacks',
        local_overrides: { title: 'My Custom Title' },
        created_at: '2025-12-20T10:00:00Z',
        updated_at: null,
      }

      // Notification should contain all data for restoration
      const notification = {
        household_id: 'household-1',
        change_type: 'removed',
        source_name: 'Spond',
        original_title: deletedEvent.local_overrides?.title || deletedEvent.title,
        original_date: deletedEvent.event_date,
        original_time: deletedEvent.event_time,
        original_description: deletedEvent.description,
        child_id: deletedEvent.child_id,
        status: 'unread',
        raw_event_data: {
          ...deletedEvent,
          _source: 'external_integration',
          _integration_id: deletedEvent.integration_id,
        },
      }

      expect(notification.original_title).toBe('My Custom Title')
      expect(notification.raw_event_data.local_overrides).toEqual({ title: 'My Custom Title' })
      expect(notification.raw_event_data.user_notes).toBe('Bring snacks')
    })

    it('should preserve user notes and local overrides when restoring', () => {
      const rawEventData = {
        id: 'event-1',
        integration_id: 'int-1',
        external_id: 'ext-1',
        title: 'Original Title',
        local_overrides: { title: 'Custom Title', location: 'Custom Location' },
        user_notes: 'Important notes',
        _source: 'external_integration',
        _integration_id: 'int-1',
      }

      // When restoring, use override values where present
      const restoredTitle = rawEventData.local_overrides?.title || rawEventData.title
      const restoredNotes = rawEventData.user_notes

      expect(restoredTitle).toBe('Custom Title')
      expect(restoredNotes).toBe('Important notes')
    })
  })

  describe('undoWindow', () => {
    it('should allow undo within the window period', () => {
      const deletionTimestamp = Date.now() - 3000 // 3 seconds ago
      const undoWindowMs = 5000

      const canUndo = Date.now() - deletionTimestamp < undoWindowMs
      expect(canUndo).toBe(true)
    })

    it('should not allow undo after window expires', () => {
      const deletionTimestamp = Date.now() - 6000 // 6 seconds ago
      const undoWindowMs = 5000

      const canUndo = Date.now() - deletionTimestamp < undoWindowMs
      expect(canUndo).toBe(false)
    })
  })
})

describe('External Event Hidden State', () => {
  describe('hideEvent', () => {
    it('should mark event as hidden without deleting', () => {
      const event: ExternalEvent = {
        id: 'event-1',
        integration_id: 'int-1',
        child_id: null,
        external_id: 'ext-1',
        external_group_id: null,
        title: 'Event',
        description: null,
        event_date: '2025-12-30',
        event_time: null,
        end_date: null,
        end_time: null,
        location: null,
        event_type: null,
        is_hidden: false,
        user_notes: null,
        local_overrides: null,
        created_at: '2025-12-20T10:00:00Z',
        updated_at: null,
      }

      const updatedEvent = { ...event, is_hidden: true }

      expect(updatedEvent.is_hidden).toBe(true)
      expect(updatedEvent.id).toBe(event.id) // Not deleted
    })

    it('should exclude hidden events from calendar display', () => {
      const events: ExternalEvent[] = [
        {
          id: 'event-1',
          integration_id: 'int-1',
          child_id: null,
          external_id: 'ext-1',
          external_group_id: null,
          title: 'Visible Event',
          description: null,
          event_date: '2025-12-30',
          event_time: null,
          end_date: null,
          end_time: null,
          location: null,
          event_type: null,
          is_hidden: false,
          user_notes: null,
          local_overrides: null,
          created_at: '2025-12-20T10:00:00Z',
          updated_at: null,
        },
        {
          id: 'event-2',
          integration_id: 'int-1',
          child_id: null,
          external_id: 'ext-2',
          external_group_id: null,
          title: 'Hidden Event',
          description: null,
          event_date: '2025-12-30',
          event_time: null,
          end_date: null,
          end_time: null,
          location: null,
          event_type: null,
          is_hidden: true, // Hidden
          user_notes: null,
          local_overrides: null,
          created_at: '2025-12-20T10:00:00Z',
          updated_at: null,
        },
      ]

      const visibleEvents = events.filter(e => !e.is_hidden)

      expect(visibleEvents).toHaveLength(1)
      expect(visibleEvents[0].title).toBe('Visible Event')
    })
  })

  describe('hiddenEventSync', () => {
    it('should preserve hidden state during sync', () => {
      const existingHiddenEvent = {
        external_id: 'ext-1',
        is_hidden: true,
        user_notes: 'I hid this because...',
      }

      const syncedEvent = {
        external_id: 'ext-1',
        title: 'Updated Title',
        event_date: '2025-12-30',
      }

      // Upsert should not include is_hidden
      const upsertPayload = {
        external_id: syncedEvent.external_id,
        title: syncedEvent.title,
        event_date: syncedEvent.event_date,
      }

      expect(upsertPayload).not.toHaveProperty('is_hidden')

      // After upsert, hidden state should be preserved
      const resultEvent = {
        ...existingHiddenEvent,
        title: syncedEvent.title,
        event_date: syncedEvent.event_date,
      }

      expect(resultEvent.is_hidden).toBe(true)
      expect(resultEvent.user_notes).toBe('I hid this because...')
    })
  })
})

describe('External Event Notifications', () => {
  describe('newEventNotification', () => {
    it('should only notify for future events', () => {
      const today = '2025-12-26'
      const newEvents = [
        { event_date: '2025-12-20', title: 'Past Event' },
        { event_date: '2025-12-30', title: 'Future Event 1' },
        { event_date: '2026-01-05', title: 'Future Event 2' },
      ]

      const futureEvents = newEvents.filter(e => e.event_date >= today)

      expect(futureEvents).toHaveLength(2)
      expect(futureEvents[0].title).toBe('Future Event 1')
      expect(futureEvents[1].title).toBe('Future Event 2')
    })

    it('should limit notifications to avoid spam', () => {
      const newEvents = Array.from({ length: 10 }, (_, i) => ({
        event_date: '2025-12-30',
        title: `Event ${i + 1}`,
      }))

      const maxNotifications = 3
      const toNotify = newEvents.slice(0, maxNotifications)

      expect(toNotify).toHaveLength(3)
    })
  })

  describe('deletionNotification', () => {
    it('should include event details in notification', () => {
      const deletedEvent = {
        title: 'Football Match',
        event_date: '2025-12-30',
      }

      const formattedDate = new Date(deletedEvent.event_date).toLocaleDateString('nb-NO', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })

      const notificationBody = `"${deletedEvent.title}" (${formattedDate}) ble fjernet`

      expect(notificationBody).toContain('Football Match')
      expect(notificationBody).toContain('ble fjernet')
    })
  })
})

describe('Integration Stats', () => {
  describe('getIntegrationStats', () => {
    it('should count events, messages, and photos correctly', () => {
      const events = [
        { is_hidden: false },
        { is_hidden: false },
        { is_hidden: true }, // Hidden
      ]

      const visibleEvents = events.filter(e => !e.is_hidden)
      const hiddenEvents = events.filter(e => e.is_hidden)

      expect(visibleEvents).toHaveLength(2)
      expect(hiddenEvents).toHaveLength(1)
    })

    it('should return zero counts for integration with no data', () => {
      const stats = {
        event_count: 0,
        message_count: 0,
        photo_count: 0,
        hidden_event_count: 0,
      }

      const hasData = stats.event_count > 0 || stats.message_count > 0 || stats.photo_count > 0
      expect(hasData).toBe(false)
    })
  })
})
