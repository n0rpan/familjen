import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

// Reset module between tests to get fresh IndexedDB
beforeEach(async () => {
  vi.resetModules()
  // Clear all IndexedDB databases
  const databases = await indexedDB.databases()
  for (const db of databases) {
    if (db.name) indexedDB.deleteDatabase(db.name)
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('offline-queue', () => {
  describe('queueChange', () => {
    it('queues a change with generated id and timestamp', async () => {
      const { queueChange, getPendingChanges } = await import('@/lib/offline-queue')

      const id = await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { title: 'Test task', child_id: 'child-1' },
      })

      expect(id).toBeDefined()
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

      const changes = await getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].table).toBe('child_tasks')
      expect(changes[0].operation).toBe('insert')
      expect(changes[0].data.title).toBe('Test task')
      expect(changes[0].retries).toBe(0)
    })

    it('queues multiple changes and retrieves all', async () => {
      const { queueChange, getPendingChanges } = await import('@/lib/offline-queue')

      await queueChange({ table: 'tasks', operation: 'insert', data: { order: 1 } })
      await queueChange({ table: 'tasks', operation: 'insert', data: { order: 2 } })
      await queueChange({ table: 'tasks', operation: 'insert', data: { order: 3 } })

      const changes = await getPendingChanges()
      expect(changes).toHaveLength(3)
      // Verify all orders are present (order may vary based on timing)
      const orders = changes.map(c => c.data.order).sort()
      expect(orders).toEqual([1, 2, 3])
    })
  })

  describe('getPendingCount', () => {
    it('returns 0 when queue is empty', async () => {
      const { getPendingCount } = await import('@/lib/offline-queue')

      const count = await getPendingCount()
      expect(count).toBe(0)
    })

    it('returns correct count after queuing changes', async () => {
      const { queueChange, getPendingCount } = await import('@/lib/offline-queue')

      await queueChange({ table: 'tasks', operation: 'insert', data: {} })
      await queueChange({ table: 'tasks', operation: 'insert', data: {} })

      const count = await getPendingCount()
      expect(count).toBe(2)
    })
  })

  describe('removeChange', () => {
    it('removes a specific change by id', async () => {
      const { queueChange, getPendingChanges, removeChange } = await import('@/lib/offline-queue')

      const id1 = await queueChange({ table: 'tasks', operation: 'insert', data: { title: 'Keep' } })
      const id2 = await queueChange({ table: 'tasks', operation: 'insert', data: { title: 'Remove' } })

      await removeChange(id2)

      const changes = await getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].id).toBe(id1)
      expect(changes[0].data.title).toBe('Keep')
    })
  })

  describe('incrementRetry', () => {
    it('increments retry count for a change', async () => {
      const { queueChange, getPendingChanges, incrementRetry } = await import('@/lib/offline-queue')

      const id = await queueChange({ table: 'tasks', operation: 'insert', data: {} })

      await incrementRetry(id)
      await incrementRetry(id)

      const changes = await getPendingChanges()
      expect(changes[0].retries).toBe(2)
    })

    it('does nothing for non-existent id', async () => {
      const { incrementRetry } = await import('@/lib/offline-queue')

      // Should not throw
      await expect(incrementRetry('non-existent-id')).resolves.toBeUndefined()
    })
  })

  describe('clearAllChanges', () => {
    it('clears all pending changes', async () => {
      const { queueChange, getPendingCount, clearAllChanges } = await import('@/lib/offline-queue')

      await queueChange({ table: 'tasks', operation: 'insert', data: {} })
      await queueChange({ table: 'tasks', operation: 'update', data: {} })
      await queueChange({ table: 'tasks', operation: 'delete', data: {} })

      await clearAllChanges()

      const count = await getPendingCount()
      expect(count).toBe(0)
    })
  })

  describe('updateQueuedInsert', () => {
    it('updates data in a queued insert by matching field', async () => {
      const { queueChange, getPendingChanges, updateQueuedInsert } = await import('@/lib/offline-queue')

      // Queue an insert with a temp ID
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-123', title: 'Original title', status: 'open' },
      })

      // Update the queued insert
      const updated = await updateQueuedInsert('child_tasks', '_tempId', 'temp-123', {
        title: 'Updated title',
        notes: 'Added notes',
      })

      expect(updated).toBe(true)

      const changes = await getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].data.title).toBe('Updated title')
      expect(changes[0].data.notes).toBe('Added notes')
      expect(changes[0].data.status).toBe('open') // Original field preserved
      expect(changes[0].data._tempId).toBe('temp-123') // Match field preserved
    })

    it('returns false when no matching insert found', async () => {
      const { queueChange, updateQueuedInsert } = await import('@/lib/offline-queue')

      // Queue an insert with different temp ID
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-999' },
      })

      // Try to update non-existent temp ID
      const updated = await updateQueuedInsert('child_tasks', '_tempId', 'temp-123', { title: 'Updated' })

      expect(updated).toBe(false)
    })

    it('only updates inserts, not updates or deletes', async () => {
      const { queueChange, getPendingChanges, updateQueuedInsert } = await import('@/lib/offline-queue')

      // Queue an update operation (not insert)
      await queueChange({
        table: 'child_tasks',
        operation: 'update',
        data: { _tempId: 'temp-123', title: 'Update operation' },
      })

      // Try to update - should not match because it's not an insert
      const updated = await updateQueuedInsert('child_tasks', '_tempId', 'temp-123', { title: 'Changed' })

      expect(updated).toBe(false)

      const changes = await getPendingChanges()
      expect(changes[0].data.title).toBe('Update operation') // Unchanged
    })

    it('only updates matching table', async () => {
      const { queueChange, getPendingChanges, updateQueuedInsert } = await import('@/lib/offline-queue')

      // Queue insert in different table
      await queueChange({
        table: 'wishlist_items',
        operation: 'insert',
        data: { _tempId: 'temp-123', name: 'Original' },
      })

      // Try to update with wrong table
      const updated = await updateQueuedInsert('child_tasks', '_tempId', 'temp-123', { name: 'Changed' })

      expect(updated).toBe(false)

      const changes = await getPendingChanges()
      expect(changes[0].data.name).toBe('Original') // Unchanged
    })

    it('handles multiple inserts and updates correct one', async () => {
      const { queueChange, getPendingChanges, updateQueuedInsert } = await import('@/lib/offline-queue')

      // Queue multiple inserts
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-1', title: 'Task 1' },
      })
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-2', title: 'Task 2' },
      })
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-3', title: 'Task 3' },
      })

      // Update the middle one
      const updated = await updateQueuedInsert('child_tasks', '_tempId', 'temp-2', { title: 'Updated Task 2' })

      expect(updated).toBe(true)

      const changes = await getPendingChanges()
      expect(changes).toHaveLength(3)
      // Find by tempId since order may vary
      const task1 = changes.find(c => c.data._tempId === 'temp-1')
      const task2 = changes.find(c => c.data._tempId === 'temp-2')
      const task3 = changes.find(c => c.data._tempId === 'temp-3')
      expect(task1?.data.title).toBe('Task 1')
      expect(task2?.data.title).toBe('Updated Task 2')
      expect(task3?.data.title).toBe('Task 3')
    })
  })

  describe('removeQueuedInsert', () => {
    it('removes a queued insert by matching field', async () => {
      const { queueChange, getPendingChanges, removeQueuedInsert } = await import('@/lib/offline-queue')

      // Queue an insert with a temp ID
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-123', title: 'To be removed' },
      })

      // Remove the queued insert
      const removed = await removeQueuedInsert('child_tasks', '_tempId', 'temp-123')

      expect(removed).toBe(true)

      const changes = await getPendingChanges()
      expect(changes).toHaveLength(0)
    })

    it('returns false when no matching insert found', async () => {
      const { queueChange, removeQueuedInsert } = await import('@/lib/offline-queue')

      // Queue an insert with different temp ID
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-999' },
      })

      // Try to remove non-existent temp ID
      const removed = await removeQueuedInsert('child_tasks', '_tempId', 'temp-123')

      expect(removed).toBe(false)
    })

    it('only removes inserts, not updates or deletes', async () => {
      const { queueChange, getPendingChanges, removeQueuedInsert } = await import('@/lib/offline-queue')

      // Queue a delete operation (not insert)
      await queueChange({
        table: 'child_tasks',
        operation: 'delete',
        data: { _tempId: 'temp-123' },
      })

      // Try to remove - should not match because it's not an insert
      const removed = await removeQueuedInsert('child_tasks', '_tempId', 'temp-123')

      expect(removed).toBe(false)

      const changes = await getPendingChanges()
      expect(changes).toHaveLength(1) // Still there
    })

    it('only removes from matching table', async () => {
      const { queueChange, getPendingChanges, removeQueuedInsert } = await import('@/lib/offline-queue')

      // Queue insert in different table
      await queueChange({
        table: 'wishlist_items',
        operation: 'insert',
        data: { _tempId: 'temp-123' },
      })

      // Try to remove with wrong table
      const removed = await removeQueuedInsert('child_tasks', '_tempId', 'temp-123')

      expect(removed).toBe(false)

      const changes = await getPendingChanges()
      expect(changes).toHaveLength(1) // Still there
    })

    it('removes only matching insert when multiple exist', async () => {
      const { queueChange, getPendingChanges, removeQueuedInsert } = await import('@/lib/offline-queue')

      // Queue multiple inserts
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-1', title: 'Keep 1' },
      })
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-2', title: 'Remove' },
      })
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-3', title: 'Keep 2' },
      })

      // Remove the middle one
      const removed = await removeQueuedInsert('child_tasks', '_tempId', 'temp-2')

      expect(removed).toBe(true)

      const changes = await getPendingChanges()
      expect(changes).toHaveLength(2)
      // Find by tempId since order may vary
      const task1 = changes.find(c => c.data._tempId === 'temp-1')
      const task3 = changes.find(c => c.data._tempId === 'temp-3')
      expect(task1?.data.title).toBe('Keep 1')
      expect(task3?.data.title).toBe('Keep 2')
      // Task 2 should be gone
      expect(changes.find(c => c.data._tempId === 'temp-2')).toBeUndefined()
    })
  })

  describe('offline edit/delete workflow', () => {
    it('simulates create → edit → sync workflow', async () => {
      const { queueChange, getPendingChanges, updateQueuedInsert } = await import('@/lib/offline-queue')

      // 1. User creates a task offline
      const tempId = `temp-${Date.now()}`
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: tempId, title: 'Buy milk', status: 'open' },
      })

      // 2. User edits the task (still offline)
      await updateQueuedInsert('child_tasks', '_tempId', tempId, {
        title: 'Buy oat milk',
        notes: 'From the health store',
      })

      // 3. When synced, the insert should have the updated data
      const changes = await getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].operation).toBe('insert')
      expect(changes[0].data.title).toBe('Buy oat milk')
      expect(changes[0].data.notes).toBe('From the health store')
      expect(changes[0].data.status).toBe('open')
    })

    it('simulates create → delete → sync workflow', async () => {
      const { queueChange, getPendingChanges, removeQueuedInsert } = await import('@/lib/offline-queue')

      // 1. User creates a task offline
      const tempId = `temp-${Date.now()}`
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: tempId, title: 'Accidental task' },
      })

      // 2. User deletes the task (still offline)
      await removeQueuedInsert('child_tasks', '_tempId', tempId)

      // 3. When synced, nothing should be sent
      const changes = await getPendingChanges()
      expect(changes).toHaveLength(0)
    })

    it('simulates create → multiple edits → sync workflow', async () => {
      const { queueChange, getPendingChanges, updateQueuedInsert } = await import('@/lib/offline-queue')

      const tempId = `temp-${Date.now()}`

      // 1. Create
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: tempId, title: 'v1' },
      })

      // 2. Edit multiple times
      await updateQueuedInsert('child_tasks', '_tempId', tempId, { title: 'v2' })
      await updateQueuedInsert('child_tasks', '_tempId', tempId, { title: 'v3' })
      await updateQueuedInsert('child_tasks', '_tempId', tempId, { title: 'v4', notes: 'Final version' })

      // 3. Only final version should be synced
      const changes = await getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].data.title).toBe('v4')
      expect(changes[0].data.notes).toBe('Final version')
    })

    it('handles mixed operations correctly', async () => {
      const { queueChange, getPendingChanges, updateQueuedInsert, removeQueuedInsert } = await import('@/lib/offline-queue')

      // Create 3 items offline
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-1', title: 'Task 1' },
      })
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-2', title: 'Task 2' },
      })
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: { _tempId: 'temp-3', title: 'Task 3' },
      })

      // Edit task 1, delete task 2, leave task 3
      await updateQueuedInsert('child_tasks', '_tempId', 'temp-1', { title: 'Task 1 Updated' })
      await removeQueuedInsert('child_tasks', '_tempId', 'temp-2')

      // Verify final state
      const changes = await getPendingChanges()
      expect(changes).toHaveLength(2)
      // Find by tempId since order may vary
      const task1 = changes.find(c => c.data._tempId === 'temp-1')
      const task3 = changes.find(c => c.data._tempId === 'temp-3')
      expect(task1?.data.title).toBe('Task 1 Updated')
      expect(task3?.data.title).toBe('Task 3')
      // Task 2 should be gone
      expect(changes.find(c => c.data._tempId === 'temp-2')).toBeUndefined()
    })
  })

  describe('data integrity', () => {
    it('preserves all fields when updating', async () => {
      const { queueChange, getPendingChanges, updateQueuedInsert } = await import('@/lib/offline-queue')

      // Create with many fields
      await queueChange({
        table: 'child_tasks',
        operation: 'insert',
        data: {
          _tempId: 'temp-1',
          child_id: 'child-abc',
          date: '2024-12-30',
          time: '14:00',
          title: 'Original',
          notes: 'Keep these notes',
          task_type: 'reminder',
          status: 'open',
        },
      })

      // Update only title
      await updateQueuedInsert('child_tasks', '_tempId', 'temp-1', { title: 'Changed' })

      // All other fields should be preserved
      const changes = await getPendingChanges()
      const data = changes[0].data
      expect(data.child_id).toBe('child-abc')
      expect(data.date).toBe('2024-12-30')
      expect(data.time).toBe('14:00')
      expect(data.notes).toBe('Keep these notes')
      expect(data.task_type).toBe('reminder')
      expect(data.status).toBe('open')
      expect(data.title).toBe('Changed')
    })

    it('handles empty queue gracefully', async () => {
      const { getPendingChanges, getPendingCount, updateQueuedInsert, removeQueuedInsert } = await import('@/lib/offline-queue')

      // All operations on empty queue should work
      expect(await getPendingChanges()).toEqual([])
      expect(await getPendingCount()).toBe(0)
      expect(await updateQueuedInsert('tasks', '_tempId', 'temp-1', {})).toBe(false)
      expect(await removeQueuedInsert('tasks', '_tempId', 'temp-1')).toBe(false)
    })
  })
})
