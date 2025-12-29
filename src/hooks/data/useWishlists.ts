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
 */

import { useState, useEffect, useCallback } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { createWishlistItemSchema, updateWishlistItemSchema } from '@/lib/schemas'
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
