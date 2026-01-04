'use client'

/**
 * useShoppingLists Hook
 *
 * Abstracts shopping list data fetching and mutations for both demo and production modes.
 *
 * Loading state is derived to avoid UI flash:
 * - householdLoading: waiting for household to load
 * - shouldFetch: household loaded but initial fetch not done
 * - isFetching: actively fetching data
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import { getCached, setCache, isCacheFresh } from '@/lib/cache'
import { CACHE_KEYS } from '@/lib/prefetch/pages'
import type { ShoppingList, ShoppingListItem } from '@/lib/types'

// Cache max age - 3 minutes (same as prefetch)
const SHOPPING_CACHE_MAX_AGE = 3 * 60 * 1000

// Cache data structure (matches what prefetch stores)
interface ShoppingCacheData {
  lists: ShoppingList[]
  items: ShoppingListItem[]
}

export interface ShoppingListWithItems extends ShoppingList {
  items: ShoppingListItem[]
}

export interface UseShoppingListsReturn {
  lists: ShoppingListWithItems[]
  loading: boolean
  error: string | null
  addList: (name: string) => Promise<ShoppingList | null>
  updateList: (listId: string, updates: Partial<ShoppingList>) => Promise<void>
  deleteList: (listId: string) => Promise<void>
  addItem: (listId: string, item: Omit<ShoppingListItem, 'id' | 'created_at' | 'updated_at' | 'list_id'>) => Promise<void>
  addItemToList: (item: Omit<ShoppingListItem, 'id' | 'created_at' | 'updated_at' | 'list_id'>) => Promise<void>
  updateItem: (itemId: string, updates: Partial<ShoppingListItem>) => Promise<void>
  deleteItem: (itemId: string) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get shopping lists with their items
 */
export function useShoppingLists(): UseShoppingListsReturn {
  const { isDemo, supabase, demoState, demoMutations } = useDataSource()
  const { household, loading: householdLoading } = useHousehold()

  const [lists, setLists] = useState<ShoppingListWithItems[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [initialFetchDone, setInitialFetchDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cacheCheckedRef = useRef(false)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setIsFetching(true)
    setError(null)

    try {
      // Fetch lists
      const { data: listsData, error: listsError } = await supabase
        .from('shopping_lists')
        .select('*')
        .eq('household_id', household.id)
        .eq('is_archived', false)
        .order('sort_order', { ascending: true })

      if (listsError) throw listsError

      if (!listsData || listsData.length === 0) {
        setLists([])
        setIsFetching(false)
        setInitialFetchDone(true)
        return
      }

      // Fetch items for all lists
      const listIds = listsData.map(l => l.id)
      const { data: itemsData, error: itemsError } = await supabase
        .from('shopping_list_items')
        .select('*')
        .in('list_id', listIds)
        .order('created_at', { ascending: true })

      if (itemsError) throw itemsError

      // Combine lists with items
      const listsWithItems = listsData.map(list => ({
        ...list,
        items: (itemsData || []).filter(item => item.list_id === list.id),
      }))

      setLists(listsWithItems)

      // Update cache for next navigation (silent, don't await)
      setCache<ShoppingCacheData>(CACHE_KEYS.shopping(household.id), {
        lists: listsData,
        items: itemsData || [],
      }).catch(() => {})
    } catch (err) {
      console.error('Error fetching shopping lists:', err)
      setError(err instanceof Error ? err.message : 'Failed to load shopping lists')
    } finally {
      setIsFetching(false)
      setInitialFetchDone(true)
    }
  }, [isDemo, supabase, household?.id])

  // Check for prefetched cache and do initial fetch
  useEffect(() => {
    if (isDemo || !household?.id || initialFetchDone || cacheCheckedRef.current) return

    cacheCheckedRef.current = true
    const hId = household.id
    const cacheKey = CACHE_KEYS.shopping(hId)

    // Try to use prefetched data first (stale-while-revalidate)
    getCached<ShoppingCacheData>(cacheKey).then((cached) => {
      if (cached && isCacheFresh(cached, SHOPPING_CACHE_MAX_AGE)) {
        // Apply cached data immediately for instant render
        const listsWithItems = cached.data.lists.map(list => ({
          ...list,
          items: cached.data.items.filter(item => item.list_id === list.id),
        }))
        setLists(listsWithItems)
        setInitialFetchDone(true)
        // Still fetch fresh data in background
        fetchData()
      } else {
        // No cache or stale - fetch fresh
        fetchData()
      }
    }).catch(() => {
      // Cache error - just fetch normally
      fetchData()
    })
  }, [isDemo, household?.id, initialFetchDone, fetchData])

  // Add list mutation
  const addList = useCallback(async (name: string): Promise<ShoppingList | null> => {
    if (isDemo) {
      console.log('Demo mode: Would add list', name)
      return null
    }

    if (!supabase || !household?.id) return null

    try {
      const { data, error: insertError } = await supabase
        .from('shopping_lists')
        .insert({
          household_id: household.id,
          name,
          sort_order: lists.length,
        })
        .select()
        .single()

      if (insertError) throw insertError

      await fetchData()
      return data
    } catch (err) {
      console.error('Error adding list:', err)
      throw err
    }
  }, [isDemo, supabase, household?.id, lists.length, fetchData])

  // Update list mutation
  const updateList = useCallback(async (listId: string, updates: Partial<ShoppingList>) => {
    if (isDemo) {
      console.log('Demo mode: Would update list', listId, updates)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('shopping_lists')
        .update(updates)
        .eq('id', listId)

      await fetchData()
    } catch (err) {
      console.error('Error updating list:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Delete list mutation
  const deleteList = useCallback(async (listId: string) => {
    if (isDemo) {
      console.log('Demo mode: Would delete list', listId)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('shopping_lists')
        .delete()
        .eq('id', listId)

      await fetchData()
    } catch (err) {
      console.error('Error deleting list:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Add item mutation
  const addItem = useCallback(async (
    listId: string,
    item: Omit<ShoppingListItem, 'id' | 'created_at' | 'updated_at' | 'list_id'>
  ) => {
    if (isDemo) {
      demoMutations.addShoppingItem(listId, { ...item, list_id: listId })
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('shopping_list_items')
        .insert({
          ...item,
          list_id: listId,
        })

      await fetchData()
    } catch (err) {
      console.error('Error adding item:', err)
      throw err
    }
  }, [isDemo, supabase, demoMutations, fetchData])

  // Add item to default list (convenience function)
  const addItemToList = useCallback(async (
    item: Omit<ShoppingListItem, 'id' | 'created_at' | 'updated_at' | 'list_id'>
  ) => {
    // Get or create the default list
    let listId: string | null = null

    if (isDemo && demoState) {
      // In demo mode, use the first list
      listId = demoState.shoppingLists[0]?.id || null
    } else if (lists.length > 0) {
      // Use first existing list
      listId = lists[0].id
    } else if (supabase && household?.id) {
      // Create a new list
      const newList = await addList('Handleliste')
      listId = newList?.id || null
    }

    if (listId) {
      await addItem(listId, item)
    }
  }, [isDemo, demoState, lists, supabase, household?.id, addList, addItem])

  // Update item mutation
  const updateItem = useCallback(async (itemId: string, updates: Partial<ShoppingListItem>) => {
    if (isDemo) {
      demoMutations.updateShoppingItem(itemId, updates)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('shopping_list_items')
        .update(updates)
        .eq('id', itemId)

      await fetchData()
    } catch (err) {
      console.error('Error updating item:', err)
      throw err
    }
  }, [isDemo, supabase, demoMutations, fetchData])

  // Delete item mutation
  const deleteItem = useCallback(async (itemId: string) => {
    if (isDemo) {
      demoMutations.deleteShoppingItem(itemId)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('shopping_list_items')
        .delete()
        .eq('id', itemId)

      await fetchData()
    } catch (err) {
      console.error('Error deleting item:', err)
      throw err
    }
  }, [isDemo, supabase, demoMutations, fetchData])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    return {
      lists: demoState.shoppingLists,
      loading: false,
      error: null,
      addList,
      updateList,
      deleteList,
      addItem,
      addItemToList,
      updateItem,
      deleteItem,
      refetch: () => {}, // No-op in demo
    }
  }

  // Demo mode initializing: show loading
  if (isDemo && !demoState) {
    return {
      lists: [],
      loading: true,
      error: null,
      addList,
      updateList,
      deleteList,
      addItem,
      addItemToList,
      updateItem,
      deleteItem,
      refetch: () => {},
    }
  }

  // Derive loading state
  const shouldFetch = !!household?.id && !initialFetchDone && !isFetching
  const loading = householdLoading || shouldFetch || isFetching

  return {
    lists,
    loading,
    error,
    addList,
    updateList,
    deleteList,
    addItem,
    addItemToList,
    updateItem,
    deleteItem,
    refetch: fetchData,
  }
}
