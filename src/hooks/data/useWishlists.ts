'use client'

/**
 * useWishlists Hook
 *
 * Abstracts wishlist data fetching and mutations for both demo and production modes.
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - shouldFetch: household loaded but initial fetch not done
 * - isFetching: actively fetching data
 *
 * Offline support:
 * - Mutations queue to IndexedDB when offline via queueChange()
 * - useBackgroundSync processes queue when back online
 * - This hook refetches 2s after online event to sync temp items with server data
 * - Optimistic updates show immediately with temp IDs (temp-{timestamp})
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { createWishlistItemSchema, updateWishlistItemSchema } from '@/lib/schemas'
import { queueChange, updateQueuedInsert, removeQueuedInsert } from '@/lib/offline-queue'
import type { WishlistItem } from '@/lib/types'

export interface UseWishlistsReturn {
  items: WishlistItem[]
  loading: boolean
  error: string | null
  addItem: (item: Omit<WishlistItem, 'id' | 'created_at' | 'updated_at'>) => Promise<void>
  updateItem: (itemId: string, updates: Partial<WishlistItem>) => Promise<void>
  deleteItem: (itemId: string) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get wishlist items
 */
export function useWishlists(): UseWishlistsReturn {
  const { isDemo, supabase, demoState } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [items, setItems] = useState<WishlistItem[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [initialFetchDone, setInitialFetchDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ref to track current items for offline conflict detection (avoids callback dependency)
  const itemsRef = useRef<WishlistItem[]>(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setIsFetching(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('wishlist_items')
        .select('*')
        .eq('household_id', household.id)
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError

      setItems(data || [])
    } catch (err) {
      console.error('Error fetching wishlists:', err)
      setError(err instanceof Error ? err.message : 'Failed to load wishlists')
    } finally {
      setIsFetching(false)
      setInitialFetchDone(true)
    }
  }, [isDemo, supabase, household?.id])

  // Fetch when household becomes available
  useEffect(() => {
    if (!isDemo && household?.id && !initialFetchDone) {
      fetchData()
    }
  }, [isDemo, household?.id, initialFetchDone, fetchData])

  // Refetch when coming back online (syncs temp items with server data)
  useEffect(() => {
    if (isDemo || typeof window === 'undefined') return

    const handleOnline = () => {
      // Small delay to let useBackgroundSync process queue first
      setTimeout(() => {
        if (household?.id) fetchData()
      }, 2000)
    }

    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [isDemo, household?.id, fetchData])

  // Add item mutation
  const addItem = useCallback(async (
    item: Omit<WishlistItem, 'id' | 'created_at' | 'updated_at'>
  ) => {
    // Validate item data (excluding household_id which is added separately)
    const validation = createWishlistItemSchema.safeParse({
      child_id: item.child_id,
      member_id: item.member_id,
      name: item.name,
      description: item.description,
      link: item.link,
      price: item.price,
      image_path: item.image_path,
      occasion: item.occasion,
      priority: item.priority,
    })
    if (!validation.success) {
      const errors = validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      throw new Error(errors)
    }

    if (isDemo) {
      console.log('Demo mode: Would add wishlist item', item)
      return
    }

    if (!supabase) return

    // If offline, queue the change for later sync
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Generate temp ID first so we can store it in the queue for later matching
      const tempId = `temp-${Date.now()}`
      await queueChange({
        table: 'wishlist_items',
        operation: 'insert',
        data: { ...item, _tempId: tempId } as Record<string, unknown>,
      })
      // Optimistically add to local state with temporary ID
      const tempItem: WishlistItem = {
        ...item,
        id: tempId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as WishlistItem
      setItems(prev => [tempItem, ...prev])
      return
    }

    try {
      await supabase
        .from('wishlist_items')
        .insert(item)

      await fetchData()
    } catch (err) {
      console.error('Error adding item:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Update item mutation
  const updateItem = useCallback(async (itemId: string, updates: Partial<WishlistItem>) => {
    // Validate update data (only validates fields that are being updated)
    const fieldsToValidate: Record<string, unknown> = {}
    if (updates.name !== undefined) fieldsToValidate.name = updates.name
    if (updates.description !== undefined) fieldsToValidate.description = updates.description
    if (updates.link !== undefined) fieldsToValidate.link = updates.link
    if (updates.price !== undefined) fieldsToValidate.price = updates.price
    if (updates.image_path !== undefined) fieldsToValidate.image_path = updates.image_path
    if (updates.occasion !== undefined) fieldsToValidate.occasion = updates.occasion
    if (updates.priority !== undefined) fieldsToValidate.priority = updates.priority
    if (updates.status !== undefined) fieldsToValidate.status = updates.status

    if (Object.keys(fieldsToValidate).length > 0) {
      const validation = updateWishlistItemSchema.safeParse(fieldsToValidate)
      if (!validation.success) {
        const errors = validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
        throw new Error(errors)
      }
    }

    if (isDemo) {
      console.log('Demo mode: Would update wishlist item', itemId, updates)
      return
    }

    if (!supabase) return

    // If offline, queue the change for later sync
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (itemId.startsWith('temp-')) {
        // For temp items, update the queued insert's data directly
        await updateQueuedInsert('wishlist_items', '_tempId', itemId, updates)
      } else {
        // For real items, queue a separate update operation
        // Include original updated_at for conflict detection during sync
        // Use ref to avoid dependency on items array (prevents unnecessary re-renders)
        const existingItem = itemsRef.current.find(i => i.id === itemId)
        await queueChange({
          table: 'wishlist_items',
          operation: 'update',
          data: { id: itemId, ...updates } as Record<string, unknown>,
          originalUpdatedAt: existingItem?.updated_at ?? undefined,
        })
      }
      // Optimistically update local state
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updates } : i))
      return
    }

    try {
      await supabase
        .from('wishlist_items')
        .update(updates)
        .eq('id', itemId)

      await fetchData()
    } catch (err) {
      console.error('Error updating item:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Delete item mutation
  const deleteItem = useCallback(async (itemId: string) => {
    if (isDemo) {
      console.log('Demo mode: Would delete wishlist item', itemId)
      return
    }

    if (!supabase) return

    // If offline, queue the change for later sync
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (itemId.startsWith('temp-')) {
        // For temp items, remove the queued insert entirely
        await removeQueuedInsert('wishlist_items', '_tempId', itemId)
      } else {
        // For real items, queue a delete operation
        await queueChange({
          table: 'wishlist_items',
          operation: 'delete',
          data: { id: itemId },
        })
      }
      // Optimistically remove from local state
      setItems(prev => prev.filter(i => i.id !== itemId))
      return
    }

    try {
      await supabase
        .from('wishlist_items')
        .delete()
        .eq('id', itemId)

      await fetchData()
    } catch (err) {
      console.error('Error deleting item:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      items: demoState.wishlists,
      loading: false,
      error: null,
      addItem,
      updateItem,
      deleteItem,
      refetch: () => {}, // No-op in demo
    }
  }

  // Derive loading state
  const shouldFetch = !!household?.id && !initialFetchDone && !isFetching
  const loading = householdLoading || shouldFetch || isFetching

  return {
    items,
    loading,
    error,
    addItem,
    updateItem,
    deleteItem,
    refetch: fetchData,
  }
}
