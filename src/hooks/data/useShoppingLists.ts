'use client'

/**
 * useShoppingLists Hook
 *
 * Abstracts shopping list data fetching and mutations for both demo and production modes.
 */

import { useState, useEffect, useCallback } from 'react'
import { useDataSource } from './useDataSource'
import { useHousehold } from './useHousehold'
import type { ShoppingList, ShoppingListItem } from '@/lib/types'

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
  updateItem: (itemId: string, updates: Partial<ShoppingListItem>) => Promise<void>
  deleteItem: (itemId: string) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get shopping lists with their items
 */
export function useShoppingLists(): UseShoppingListsReturn {
  const { isDemo, supabase, demoState, demoMutations } = useDataSource()
  const { household } = useHousehold()

  const [lists, setLists] = useState<ShoppingListWithItems[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase || !household?.id) return

    setLoading(true)
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
        setLoading(false)
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
    } catch (err) {
      console.error('Error fetching shopping lists:', err)
      setError(err instanceof Error ? err.message : 'Failed to load shopping lists')
    } finally {
      setLoading(false)
    }
  }, [isDemo, supabase, household?.id])

  // Initial fetch for production mode
  useEffect(() => {
    if (!isDemo && household?.id) {
      fetchData()
    }
  }, [isDemo, household?.id, fetchData])

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
      updateItem,
      deleteItem,
      refetch: () => {}, // No-op in demo
    }
  }

  return {
    lists,
    loading,
    error,
    addList,
    updateList,
    deleteList,
    addItem,
    updateItem,
    deleteItem,
    refetch: fetchData,
  }
}
