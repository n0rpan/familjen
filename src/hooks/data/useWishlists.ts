'use client'

/**
 * useWishlists Hook
 *
 * Abstracts wishlist data fetching and mutations for both demo and production modes.
 */

import { useState, useEffect, useCallback } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
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
  const { household } = useHousehold()

  const [items, setItems] = useState<WishlistItem[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setLoading(true)
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
      setLoading(false)
    }
  }, [isDemo, supabase, household?.id])

  // Initial fetch for production mode
  useEffect(() => {
    if (isDemo) return

    if (household?.id) {
      fetchData()
    } else {
      // No household - nothing to fetch, clear loading state
      setLoading(false)
    }
  }, [isDemo, household?.id, fetchData])

  // Add item mutation
  const addItem = useCallback(async (
    item: Omit<WishlistItem, 'id' | 'created_at' | 'updated_at'>
  ) => {
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
