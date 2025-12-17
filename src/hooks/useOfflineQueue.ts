'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  queueChange,
  getPendingChanges,
  getPendingCount,
  removeChange,
  incrementRetry,
  type PendingChange,
} from '@/lib/offline-queue'

const MAX_RETRIES = 3

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const supabase = useMemo(() => createClient(), [])

  // Track online status
  useEffect(() => {
    if (typeof window === 'undefined') return

    setIsOnline(navigator.onLine)

    const handleOnline = () => {
      setIsOnline(true)
      // Auto-sync when back online
      syncChanges()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Load pending count on mount
  useEffect(() => {
    loadPendingCount()
  }, [])

  const loadPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount()
      setPendingCount(count)
    } catch (err) {
      console.error('Failed to get pending count:', err)
    }
  }, [])

  // Queue a database mutation
  const queueMutation = useCallback(async (
    table: string,
    operation: 'insert' | 'update' | 'upsert' | 'delete',
    data: Record<string, unknown>
  ): Promise<{ queued: boolean; error?: string }> => {
    // If online, try direct write
    if (isOnline) {
      try {
        let result
        switch (operation) {
          case 'insert':
            result = await supabase.from(table).insert(data)
            break
          case 'update':
            // Requires id in data
            const updateId = data.id
            const { id: _ignoreId, ...updateData } = data
            result = await supabase.from(table).update(updateData).eq('id', updateId)
            break
          case 'upsert':
            result = await supabase.from(table).upsert(data)
            break
          case 'delete':
            result = await supabase.from(table).delete().eq('id', data.id)
            break
        }

        if (result.error) {
          throw result.error
        }

        return { queued: false }
      } catch (err) {
        // If network error, fall through to queue
        if (err instanceof Error && err.message.includes('fetch')) {
          // Network error - queue the change
        } else {
          // Other error - don't queue, report error
          return { queued: false, error: err instanceof Error ? err.message : 'Unknown error' }
        }
      }
    }

    // Queue the change for later
    try {
      await queueChange({ table, operation, data })
      await loadPendingCount()
      return { queued: true }
    } catch (err) {
      return { queued: false, error: err instanceof Error ? err.message : 'Failed to queue change' }
    }
  }, [isOnline, supabase, loadPendingCount])

  // Sync all pending changes
  const syncChanges = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (syncing || !isOnline) return { synced: 0, failed: 0 }

    setSyncing(true)
    let synced = 0
    let failed = 0

    try {
      const changes = await getPendingChanges()

      for (const change of changes) {
        try {
          let result
          switch (change.operation) {
            case 'insert':
              result = await supabase.from(change.table).insert(change.data)
              break
            case 'update':
              const updateId = change.data.id
              const { id: _ignoreId, ...updateData } = change.data
              result = await supabase.from(change.table).update(updateData).eq('id', updateId)
              break
            case 'upsert':
              result = await supabase.from(change.table).upsert(change.data)
              break
            case 'delete':
              result = await supabase.from(change.table).delete().eq('id', change.data.id)
              break
          }

          if (result.error) {
            throw result.error
          }

          // Success - remove from queue
          await removeChange(change.id)
          synced++
        } catch (err) {
          console.error('Failed to sync change:', change.id, err)

          // Increment retry count
          await incrementRetry(change.id)

          // If max retries reached, remove from queue
          if (change.retries >= MAX_RETRIES) {
            console.warn('Max retries reached for change:', change.id)
            await removeChange(change.id)
          }

          failed++
        }
      }
    } catch (err) {
      console.error('Sync error:', err)
    } finally {
      setSyncing(false)
      await loadPendingCount()
    }

    return { synced, failed }
  }, [syncing, isOnline, supabase, loadPendingCount])

  return {
    isOnline,
    pendingCount,
    syncing,
    queueMutation,
    syncChanges,
    refreshCount: loadPendingCount,
  }
}
