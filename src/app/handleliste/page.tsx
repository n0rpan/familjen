'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ShoppingList, ShoppingListItem, Household } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'
import { ListPageSkeleton } from '@/components/Skeleton'
import { useMicroFeedback } from '@/hooks/useMicroFeedback'
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription'
import { useRealtimeOptional } from '@/lib/realtime/context'
import { getCachedCategory, setCachedCategory } from '@/lib/shopping-category-cache'
import { useUndoStack } from '@/hooks/useUndoStack'
import { ShoppingItem } from '@/components/shopping/ShoppingItem'
import { ShoppingUndoToast } from '@/components/shopping/ShoppingUndoToast'
import { ShoppingSuggestions } from '@/components/shopping/ShoppingSuggestions'
import type { ShoppingCategory } from '@/lib/constants'

interface ListWithItems extends ShoppingList {
  items: ShoppingListItem[]
}

export default function ShoppingListPage() {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [lists, setLists] = useState<ListWithItems[]>([])
  const [newItemText, setNewItemText] = useState<Record<string, string>>({})
  const [newItemQuantity, setNewItemQuantity] = useState<Record<string, string>>({})
  const [duplicateWarning, setDuplicateWarning] = useState<{
    listId: string
    matches: Array<{ id: string; name: string; quantity: string | null }>
  } | null>(null)
  const duplicateCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitialized = useRef(false)

  // Micro-feedback for recently changed items
  const { markChanged, isRecentlyChanged } = useMicroFeedback(800)

  // Mobile detection for swipe-to-delete
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    // Check for touch device (pointer: coarse means no fine pointer like mouse)
    const mediaQuery = window.matchMedia('(pointer: coarse)')
    setIsMobile(mediaQuery.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  const supabase = useMemo(() => createClient(), [])
  const realtime = useRealtimeOptional()

  // Track items we're currently modifying to prevent double-updates
  const pendingChanges = useRef<Set<string>>(new Set())

  // Undo stack for deleted items with retry on failure
  const undoStack = useUndoStack<ShoppingListItem>({
    expireMs: 5000,
    maxRetries: 3,
    retryDelayMs: 2000,
    onCommit: async (action) => {
      // Actually delete from database when undo window expires
      const item = action.data
      try {
        const { error } = await supabase.from('shopping_list_items').delete().eq('id', item.id)
        if (error) {
          console.error('Failed to delete item from database:', error)
          return false // Signal failure for retry
        }
        // Clean up pending status on success
        pendingChanges.current.delete(item.id)
        return true
      } catch (error) {
        console.error('Failed to delete item from database:', error)
        return false // Signal failure for retry
      }
    },
  })

  // Handle undo - restore item to UI and cancel the pending delete
  const handleUndo = useCallback((actionId: string) => {
    const action = undoStack.undo(actionId)
    if (action) {
      // Remove from pending changes (cancel the delete)
      pendingChanges.current.delete(action.id)
      // Restore item to UI
      setLists(prev => prev.map(list =>
        list.id === action.data.list_id
          ? { ...list, items: [action.data, ...list.items] }
          : list
      ))
    }
  }, [undoStack])

  // Check for duplicate items (debounced)
  const checkDuplicates = useCallback((listId: string, text: string) => {
    // Clear previous timer
    if (duplicateCheckTimer.current) {
      clearTimeout(duplicateCheckTimer.current)
    }

    // Clear warning if text is short
    if (text.length < 2) {
      setDuplicateWarning(null)
      return
    }

    // Debounce the check
    duplicateCheckTimer.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('check_shopping_duplicate', {
          p_item_name: text,
          p_similarity_threshold: 0.6,
        })

        if (data && data.length > 0) {
          setDuplicateWarning({
            listId,
            matches: data.map((d: { id: string; name: string; quantity: string | null }) => ({
              id: d.id,
              name: d.name,
              quantity: d.quantity,
            })),
          })
        } else {
          setDuplicateWarning(null)
        }
      } catch {
        // Ignore errors - function might not exist yet
        setDuplicateWarning(null)
      }
    }, 300)
  }, [supabase])

  // Handle input change with duplicate checking
  const handleItemTextChange = useCallback((listId: string, text: string) => {
    setNewItemText(prev => ({ ...prev, [listId]: text }))
    checkDuplicates(listId, text)
  }, [checkDuplicates])

  useEffect(() => {
    if (hasInitialized.current) return
    hasInitialized.current = true
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      // First get user's membership to find their specific household
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error(t.errors.unauthorized)
      }

      const { data: membership } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!membership) {
        setHousehold(null)
        setLists([])
        setLoading(false)
        return
      }

      // Get household by ID
      const { data: householdData, error: householdError } = await supabase
        .from('households')
        .select('*')
        .eq('id', membership.household_id)
        .single()

      if (householdError) {
        throw new Error(t.errors.couldNotLoadHousehold)
      }

      setHousehold(householdData)

      // Get shopping lists (only non-archived)
      let { data: listsData, error: listsError } = await supabase
        .from('shopping_lists')
        .select('*')
        .eq('household_id', householdData.id)
        .eq('is_archived', false)
        .order('sort_order')

      if (listsError) throw new Error(t.errors.loadFailed)

      // Create single "Handleliste" if no lists exist
      if (!listsData || listsData.length === 0) {
        const { data: newList, error: createError } = await supabase
          .from('shopping_lists')
          .insert({ household_id: householdData.id, name: 'Handleliste', sort_order: 0 })
          .select()
          .single()

        if (createError) throw new Error(t.errors.saveFailed)
        listsData = [newList]
      }

      // Get items for each list
      const { data: itemsData, error: itemsError } = await supabase
        .from('shopping_list_items')
        .select('*')
        .in('list_id', listsData.map(l => l.id))
        .order('created_at', { ascending: false })

      if (itemsError) throw new Error(t.errors.loadFailed)

      // Combine lists with their items
      const listsWithItems: ListWithItems[] = listsData.map(list => ({
        ...list,
        items: (itemsData || []).filter(item => item.list_id === list.id),
      }))

      setLists(listsWithItems)
    } catch (err) {
      console.error('Shopping list error:', err)
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setLoading(false)
    }
  }

  // Refetch data when app returns to foreground (catches changes missed while backgrounded)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && hasInitialized.current) {
        // Silently refresh data without showing loading state
        refreshData()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Silent refresh that doesn't show loading spinner
  const refreshData = async () => {
    if (!household) return

    try {
      // Refetch shopping lists with items (only non-archived)
      const { data: listsData } = await supabase
        .from('shopping_lists')
        .select('*')
        .eq('household_id', household.id)
        .eq('is_archived', false)
        .order('sort_order')

      if (!listsData) return

      // Get items for each list
      const { data: allItems } = await supabase
        .from('shopping_list_items')
        .select('*')
        .in('list_id', listsData.map(l => l.id))
        .order('created_at', { ascending: true })

      // Combine lists with items
      const listsWithItems: ListWithItems[] = listsData.map(list => ({
        ...list,
        items: (allItems || []).filter(item => item.list_id === list.id)
      }))

      setLists(listsWithItems)
    } catch {
      // Silent fail - user can pull to refresh if needed
    }
  }

  // Get list IDs for filtering realtime events
  const listIds = useMemo(() => lists.map(l => l.id), [lists])

  // Realtime handlers for shopping list items
  const handleItemInsert = useCallback((record: ShoppingListItem) => {
    // Only process items for our lists
    if (!listIds.includes(record.list_id)) return

    // Skip if this is our own change
    if (pendingChanges.current.has(record.id)) {
      pendingChanges.current.delete(record.id)
      return
    }

    // Add item to the appropriate list
    setLists(prev => prev.map(list =>
      list.id === record.list_id
        ? { ...list, items: [record, ...list.items] }
        : list
    ))

    // Show toast if from another user
    const updatedBy = (record as unknown as { updated_by?: string }).updated_by
    if (realtime && !realtime.isOwnChange(updatedBy)) {
      realtime.showToast(
        `${realtime.getMemberName(updatedBy)} la til ${record.name}`,
        'info'
      )
    }
  }, [realtime, listIds])

  const handleItemUpdate = useCallback((record: ShoppingListItem, oldRecord: ShoppingListItem | null) => {
    // Only process items for our lists
    if (!listIds.includes(record.list_id)) return

    // Skip if this is our own change
    if (pendingChanges.current.has(record.id)) {
      pendingChanges.current.delete(record.id)
      return
    }

    // Update item in state
    setLists(prev => prev.map(list => ({
      ...list,
      items: list.items.map(item =>
        item.id === record.id ? record : item
      ),
    })))

    // Mark as changed for visual feedback
    markChanged(record.id)

    // Show toast for is_bought changes from other users
    const updatedBy = (record as unknown as { updated_by?: string }).updated_by
    if (realtime && !realtime.isOwnChange(updatedBy)) {
      if (oldRecord && record.is_bought !== oldRecord.is_bought) {
        const action = record.is_bought ? 'krysset av' : 'fjernet kryss fra'
        realtime.showToast(
          `${realtime.getMemberName(updatedBy)} ${action} ${record.name}`,
          'info'
        )
      }
    }
  }, [realtime, markChanged, listIds])

  const handleItemDelete = useCallback((oldRecord: ShoppingListItem) => {
    // Only process items for our lists
    if (!listIds.includes(oldRecord.list_id)) return

    // Skip if this is our own change
    if (pendingChanges.current.has(oldRecord.id)) {
      pendingChanges.current.delete(oldRecord.id)
      return
    }

    // Remove item from state
    setLists(prev => prev.map(list => ({
      ...list,
      items: list.items.filter(item => item.id !== oldRecord.id),
    })))

    // Show toast if from another user
    const updatedBy = (oldRecord as unknown as { updated_by?: string }).updated_by
    if (realtime && !realtime.isOwnChange(updatedBy)) {
      realtime.showToast(
        `${realtime.getMemberName(updatedBy)} fjernet ${oldRecord.name}`,
        'info'
      )
    }
  }, [realtime, listIds])

  // Subscribe to shopping list item changes
  useRealtimeSubscription<ShoppingListItem>({
    table: 'shopping_list_items',
    filter: household?.id ? undefined : undefined, // Will use list_id filtering instead
    onInsert: handleItemInsert,
    onUpdate: handleItemUpdate,
    onDelete: handleItemDelete,
    enabled: !loading && lists.length > 0,
  })

  const addItem = async (listId: string) => {
    const text = newItemText[listId]?.trim()
    if (!text) return

    const quantity = newItemQuantity[listId]?.trim() || null

    // Check cache for category first
    const cachedCategory = getCachedCategory(text)
    const initialCategory: ShoppingCategory = cachedCategory ?? 'other'

    // Create a temporary ID for optimistic update
    const tempId = `temp-${Date.now()}`
    const newItem: ShoppingListItem = {
      id: tempId,
      list_id: listId,
      name: text,
      quantity,
      is_bought: false,
      category: initialCategory,
      source_recipe_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    // Optimistic update
    setLists(prev => prev.map(list =>
      list.id === listId
        ? { ...list, items: [newItem, ...list.items] }
        : list
    ))

    setNewItemText(prev => ({ ...prev, [listId]: '' }))
    setNewItemQuantity(prev => ({ ...prev, [listId]: '' }))
    setDuplicateWarning(null)

    // Insert and get the real ID
    const { data, error } = await supabase
      .from('shopping_list_items')
      .insert({
        list_id: listId,
        name: text,
        quantity,
        category: initialCategory,
      })
      .select()
      .single()

    if (data) {
      // Mark as pending to prevent duplicate handling from realtime
      pendingChanges.current.add(data.id)
      // Replace temp item with real one
      setLists(prev => prev.map(list =>
        list.id === listId
          ? { ...list, items: list.items.map(item => item.id === tempId ? data : item) }
          : list
      ))

      // Fire-and-forget categorization if not cached
      if (!cachedCategory) {
        fetch('/api/openrouter/categorize-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemName: text }),
        })
          .then(res => res.ok ? res.json() : null)
          .then(catData => {
            if (catData?.category && catData.category !== initialCategory) {
              // Cache the result
              setCachedCategory(text, catData.category)
              // Update the item in database
              supabase
                .from('shopping_list_items')
                .update({ category: catData.category })
                .eq('id', data.id)
                .then(() => {
                  // Update local state (realtime may also update this)
                  setLists(prev => prev.map(list =>
                    list.id === listId
                      ? {
                          ...list,
                          items: list.items.map(item =>
                            item.id === data.id ? { ...item, category: catData.category } : item
                          ),
                        }
                      : list
                  ))
                })
            }
          })
          .catch(() => {
            // Ignore categorization failures silently
          })
      }
    } else if (error) {
      // Remove optimistic item on error
      setLists(prev => prev.map(list =>
        list.id === listId
          ? { ...list, items: list.items.filter(item => item.id !== tempId) }
          : list
      ))
    }
  }

  const toggleBought = async (itemId: string, currentValue: boolean) => {
    // Mark as pending to prevent duplicate handling from realtime
    pendingChanges.current.add(itemId)

    // Optimistic update with micro-feedback
    markChanged(itemId)
    setLists(prev =>
      prev.map(list => ({
        ...list,
        items: list.items.map(item =>
          item.id === itemId ? { ...item, is_bought: !currentValue } : item
        ),
      }))
    )

    // Persist to database
    await supabase
      .from('shopping_list_items')
      .update({ is_bought: !currentValue })
      .eq('id', itemId)
  }

  const deleteItem = useCallback((itemId: string) => {
    // Mark as pending to prevent realtime from re-processing
    pendingChanges.current.add(itemId)

    // Find the item before removing it
    let deletedItem: ShoppingListItem | undefined
    setLists(prev => {
      for (const list of prev) {
        const item = list.items.find(i => i.id === itemId)
        if (item) {
          deletedItem = item
          break
        }
      }
      return prev.map(list => ({
        ...list,
        items: list.items.filter(item => item.id !== itemId),
      }))
    })

    // Add to undo stack (actual delete happens after 5s if not undone)
    if (deletedItem) {
      undoStack.push({
        id: itemId,
        data: deletedItem,
        description: deletedItem.name,
      })
    }
  }, [undoStack])

  const clearBoughtItems = async (listId: string) => {
    const list = lists.find(l => l.id === listId)
    if (!list) return

    const boughtIds = list.items.filter(i => i.is_bought).map(i => i.id)
    if (boughtIds.length === 0) return

    // Mark all as pending
    boughtIds.forEach(id => pendingChanges.current.add(id))

    // Optimistic update
    setLists(prev => prev.map(l =>
      l.id === listId
        ? { ...l, items: l.items.filter(item => !item.is_bought) }
        : l
    ))

    // Persist to database
    await supabase.from('shopping_list_items').delete().in('id', boughtIds)
  }

  const handleKeyDown = (e: React.KeyboardEvent, listId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem(listId)
    }
  }

  // Add item from suggestions (with category already set)
  const addSuggestionItem = useCallback(async (name: string, quantity: string | null, category: ShoppingCategory) => {
    // Find the first (main) list
    const mainList = lists[0]
    if (!mainList) return

    // Create a temporary ID for optimistic update
    const tempId = `temp-${Date.now()}`
    const newItem: ShoppingListItem = {
      id: tempId,
      list_id: mainList.id,
      name,
      quantity,
      is_bought: false,
      category,
      source_recipe_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    // Optimistic update
    setLists(prev => prev.map(list =>
      list.id === mainList.id
        ? { ...list, items: [newItem, ...list.items] }
        : list
    ))

    // Insert and get the real ID
    const { data, error } = await supabase
      .from('shopping_list_items')
      .insert({
        list_id: mainList.id,
        name,
        quantity,
        category,
      })
      .select()
      .single()

    if (data) {
      // Mark as pending to prevent duplicate handling from realtime
      pendingChanges.current.add(data.id)
      // Replace temp item with real one
      setLists(prev => prev.map(list =>
        list.id === mainList.id
          ? { ...list, items: list.items.map(item => item.id === tempId ? data : item) }
          : list
      ))
    } else if (error) {
      // Remove optimistic item on error
      setLists(prev => prev.map(list =>
        list.id === mainList.id
          ? { ...list, items: list.items.filter(item => item.id !== tempId) }
          : list
      ))
    }
  }, [lists, supabase])

  if (loading) {
    return <ListPageSkeleton />
  }

  if (error) {
    return (
      <div className="space-y-8 animate-fade-in">
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
            style={{ background: 'rgba(232, 120, 109, 0.15)' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h2 className="text-2xl font-semibold font-display mb-3" style={{ color: 'var(--foreground)' }}>
            {error}
          </h2>
          <button onClick={loadData} className="btn btn-primary">
            {t.common.retry}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          {t.shopping.title}
        </h1>
        <p className="mt-1" style={{ color: 'var(--muted)' }}>
          {t.shopping.emptyListDesc}
        </p>
      </div>

      {/* Shopping Lists */}
      <div className="grid gap-6 md:grid-cols-2">
        {lists.map(list => {
          const unboughtItems = list.items.filter(i => !i.is_bought)
          const boughtItems = list.items.filter(i => i.is_bought)

          return (
            <div
              key={list.id}
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              {/* List header */}
              <div
                className="flex items-center justify-between p-4"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{
                      background: list.name === 'Dagligvarer'
                        ? 'rgba(139, 168, 136, 0.2)'
                        : 'rgba(126, 182, 196, 0.2)',
                    }}
                  >
                    {list.name === 'Dagligvarer' ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <path d="M16 10a4 4 0 0 1-8 0"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="9" cy="21" r="1"/>
                        <circle cx="20" cy="21" r="1"/>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      {list.name}
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {unboughtItems.length} {t.common.items}
                    </p>
                  </div>
                </div>
                {boughtItems.length > 0 && (
                  <button
                    onClick={() => clearBoughtItems(list.id)}
                    className="text-xs font-medium px-2 py-1 rounded-lg transition-colors hover:bg-[var(--sand)]"
                    style={{ color: 'var(--muted)' }}
                  >
                    {t.shopping.clearChecked}
                  </button>
                )}
              </div>

              {/* Add item form */}
              <div className="p-4" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newItemText[list.id] || ''}
                    onChange={e => handleItemTextChange(list.id, e.target.value)}
                    onKeyDown={e => handleKeyDown(e, list.id)}
                    placeholder={t.shopping.itemPlaceholder}
                    className="input text-sm"
                    style={{ flex: '1 1 auto', minWidth: 0 }}
                  />
                  <input
                    type="text"
                    value={newItemQuantity[list.id] || ''}
                    onChange={e => setNewItemQuantity(prev => ({ ...prev, [list.id]: e.target.value }))}
                    onKeyDown={e => handleKeyDown(e, list.id)}
                    placeholder={t.shopping.quantity}
                    className="input text-sm text-center"
                    style={{ flex: '0 0 60px', width: '60px' }}
                  />
                  <button
                    onClick={() => addItem(list.id)}
                    disabled={!newItemText[list.id]?.trim()}
                    className="btn btn-primary"
                    style={{ flex: '0 0 auto', padding: '0 12px' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                </div>

                {/* Duplicate warning */}
                {duplicateWarning?.listId === list.id && duplicateWarning.matches.length > 0 && (
                  <div
                    className="mt-2 p-2 rounded-lg text-xs"
                    style={{
                      background: 'rgba(214, 180, 112, 0.15)',
                      border: '1px solid rgba(214, 180, 112, 0.3)',
                      color: 'var(--foreground)',
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      <span style={{ color: 'var(--color-honey)' }}>{t.shopping.alreadyOnList}:</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {duplicateWarning.matches.slice(0, 3).map(match => (
                        <span
                          key={match.id}
                          className="px-2 py-0.5 rounded"
                          style={{ background: 'var(--background)' }}
                        >
                          {match.name}
                          {match.quantity && <span className="ml-1 opacity-60">({match.quantity})</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Items list */}
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {unboughtItems.length === 0 && boughtItems.length === 0 ? (
                  <div className="p-8 text-center">
                    <div
                      className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
                      style={{ background: 'var(--sand)' }}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <path d="M16 10a4 4 0 0 1-8 0"/>
                      </svg>
                    </div>
                    <p className="text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                      {t.shopping.emptyList}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {t.shopping.emptyListDesc}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Unbought items */}
                    {unboughtItems.map(item => (
                      <ShoppingItem
                        key={item.id}
                        item={item}
                        isBought={false}
                        isRecentlyChanged={isRecentlyChanged(item.id)}
                        onToggle={toggleBought}
                        onDelete={deleteItem}
                        isMobile={isMobile}
                      />
                    ))}

                    {/* Bought items (collapsed section) */}
                    {boughtItems.length > 0 && (
                      <div className="bg-[var(--background)]">
                        <div className="px-3 py-2">
                          <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                            {t.common.done} ({boughtItems.length})
                          </span>
                        </div>
                        {boughtItems.map(item => (
                          <ShoppingItem
                            key={item.id}
                            item={item}
                            isBought={true}
                            isRecentlyChanged={isRecentlyChanged(item.id)}
                            onToggle={toggleBought}
                            onDelete={deleteItem}
                            isMobile={isMobile}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Smart suggestions based on planned meals */}
      <ShoppingSuggestions
        onAddItem={addSuggestionItem}
        refreshTrigger={lists[0]?.items.length}
      />

      {/* Undo toast for deleted items */}
      <ShoppingUndoToast
        action={undoStack.peek()}
        onUndo={handleUndo}
        expireMs={5000}
        failedActions={undoStack.failedActions}
        onDismissFailed={undoStack.dismissFailed}
      />
    </div>
  )
}
