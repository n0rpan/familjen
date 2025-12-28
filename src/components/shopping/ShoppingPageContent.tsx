'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ShoppingList, ShoppingListItem, Household } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'
import { ShoppingPagePartialSkeleton } from '@/components/Skeleton'
import { useMicroFeedback } from '@/hooks/useMicroFeedback'
import { useRealtimeSubscription, createInFilter } from '@/hooks/useRealtimeSubscription'
import { useRealtimeOptional } from '@/lib/realtime/context'
import { getCachedCategory, setCachedCategory } from '@/lib/shopping-category-cache'
import { useUndoStack } from '@/hooks/useUndoStack'
import { ShoppingItem } from '@/components/shopping/ShoppingItem'
import { ShoppingUndoToast } from '@/components/shopping/ShoppingUndoToast'
import { ShoppingSuggestions } from '@/components/shopping/ShoppingSuggestions'
import { ShoppingFilters } from '@/components/shopping/ShoppingFilters'
import { ShoppingCategoryGroup } from '@/components/shopping/ShoppingCategoryGroup'
import { WishlistOverview } from '@/components/wishlist'
import type { ShoppingCategory, ShoppingFilter, ShoppingViewMode } from '@/lib/constants'
import { DEFAULT_FILTER_CATEGORIES, DEFAULT_CATEGORY_ORDER } from '@/lib/constants'
import {
  getCachedShoppingData,
  fetchAndCacheShoppingData,
  getShoppingCacheKey,
} from '@/lib/prefetch/fetchers'
import { setCache } from '@/lib/cache'
import type { ShoppingCacheData } from '@/lib/types'

interface ListWithItems extends ShoppingList {
  items: ShoppingListItem[]
}

export function ShoppingPageContent() {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [lists, setLists] = useState<ListWithItems[]>([])
  const [newItemText, setNewItemText] = useState<Record<string, string>>({})
  const [newItemQuantity, setNewItemQuantity] = useState<Record<string, string>>({})
  const [viewMode, setViewMode] = useState<ShoppingViewMode>('newest')
  const [activeFilter, setActiveFilter] = useState<ShoppingFilter>('all')
  const [duplicateWarning, setDuplicateWarning] = useState<{
    listId: string
    matches: Array<{ id: string; name: string; quantity: string | null }>
  } | null>(null)
  const duplicateCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitialized = useRef(false)

  // Refs to avoid stale closures in async callbacks
  const tRef = useRef(t)
  const householdRef = useRef(household)
  useEffect(() => { tRef.current = t }, [t])
  useEffect(() => { householdRef.current = household }, [household])

  // Micro-feedback for recently changed items
  const { markChanged, isRecentlyChanged } = useMicroFeedback(800)

  // Mobile detection for swipe-to-delete
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
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
      const item = action.data
      try {
        const { error } = await supabase.from('shopping_list_items').delete().eq('id', item.id)
        if (error) {
          console.error('Failed to delete item from database:', error)
          return false
        }
        pendingChanges.current.delete(item.id)
        return true
      } catch (error) {
        console.error('Failed to delete item from database:', error)
        return false
      }
    },
  })

  const handleUndo = useCallback((actionId: string) => {
    const action = undoStack.undo(actionId)
    if (action) {
      pendingChanges.current.delete(action.id)
      setLists(prev => prev.map(list =>
        list.id === action.data.list_id
          ? { ...list, items: [action.data, ...list.items] }
          : list
      ))
    }
  }, [undoStack])

  const checkDuplicates = useCallback((listId: string, text: string) => {
    if (duplicateCheckTimer.current) {
      clearTimeout(duplicateCheckTimer.current)
    }
    if (text.length < 2) {
      setDuplicateWarning(null)
      return
    }
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
        setDuplicateWarning(null)
      }
    }, 300)
  }, [supabase])

  const handleItemTextChange = useCallback((listId: string, text: string) => {
    setNewItemText(prev => ({ ...prev, [listId]: text }))
    checkDuplicates(listId, text)
  }, [checkDuplicates])

  const combineListsWithItems = (listsData: ShoppingList[], itemsData: ShoppingListItem[]): ListWithItems[] => {
    return listsData.map(list => ({
      ...list,
      items: itemsData.filter(item => item.list_id === list.id),
    }))
  }

  const loadData = useCallback(async (cancelled: boolean, safeSetState: (cb: () => void) => void) => {
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error(tRef.current.errors.unauthorized)
      }
      if (cancelled) return

      const { data: membership } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (cancelled) return

      if (!membership) {
        setHousehold(null)
        setLists([])
        setLoading(false)
        return
      }

      const { data: householdData, error: householdError } = await supabase
        .from('households')
        .select('*')
        .eq('id', membership.household_id)
        .single()

      if (householdError) {
        throw new Error(tRef.current.errors.couldNotLoadHousehold)
      }
      if (cancelled) return

      setHousehold(householdData)

      const cachedData = await getCachedShoppingData(householdData.id)
      if (cachedData && cachedData.lists.length > 0) {
        const listsWithItems = combineListsWithItems(cachedData.lists, cachedData.items)
        setLists(listsWithItems)
        setLoading(false)

        fetchAndCacheShoppingData(householdData.id)
          .then((freshData) => {
            safeSetState(() => {
              const freshListsWithItems = combineListsWithItems(freshData.lists, freshData.items)
              setLists(freshListsWithItems)
            })
          })
          .catch((err) => {
            console.warn('[Shopping] Background refresh failed:', err)
          })
        return
      }

      setLoading(true)

      let { data: listsData, error: listsError } = await supabase
        .from('shopping_lists')
        .select('*')
        .eq('household_id', householdData.id)
        .eq('is_archived', false)
        .order('sort_order')

      if (listsError) throw new Error(tRef.current.errors.loadFailed)

      if (!listsData || listsData.length === 0) {
        const { data: newList, error: createError } = await supabase
          .from('shopping_lists')
          .insert({ household_id: householdData.id, name: 'Handleliste', sort_order: 0 })
          .select()
          .single()

        if (createError) throw new Error(tRef.current.errors.saveFailed)
        listsData = [newList]
      }

      const { data: itemsData, error: itemsError } = await supabase
        .from('shopping_list_items')
        .select('*')
        .in('list_id', listsData.map(l => l.id))
        .order('created_at', { ascending: false })

      if (itemsError) throw new Error(tRef.current.errors.loadFailed)

      const listsWithItems = combineListsWithItems(listsData, itemsData || [])
      setLists(listsWithItems)

      const cacheData: ShoppingCacheData = {
        lists: listsData,
        items: itemsData || [],
        timestamp: Date.now(),
      }
      await setCache(getShoppingCacheKey(householdData.id), cacheData)
    } catch (err) {
      console.error('Shopping list error:', err)
      setError(err instanceof Error ? err.message : tRef.current.errors.generic)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    if (hasInitialized.current) return
    hasInitialized.current = true

    let cancelled = false
    loadData(cancelled, (cb) => { if (!cancelled) cb() })

    return () => { cancelled = true }
  }, [loadData])

  const handleRetry = useCallback(() => {
    loadData(false, (cb) => cb())
  }, [loadData])

  const refreshData = useCallback(async () => {
    const currentHousehold = householdRef.current
    if (!currentHousehold) return

    try {
      const freshData = await fetchAndCacheShoppingData(currentHousehold.id)
      const listsWithItems = combineListsWithItems(freshData.lists, freshData.items)
      setLists(listsWithItems)
    } catch {
      // Silent fail
    }
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && hasInitialized.current && householdRef.current) {
        refreshData()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refreshData])

  const cacheDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!household || lists.length === 0) return

    if (cacheDebounceRef.current) {
      clearTimeout(cacheDebounceRef.current)
    }
    cacheDebounceRef.current = setTimeout(async () => {
      const allItems = lists.flatMap(l => l.items)
      const listsOnly = lists.map(({ items: _, ...list }) => list as ShoppingList)
      const cacheData: ShoppingCacheData = {
        lists: listsOnly,
        items: allItems,
        timestamp: Date.now(),
      }
      await setCache(getShoppingCacheKey(household.id), cacheData)
    }, 500)

    return () => {
      if (cacheDebounceRef.current) {
        clearTimeout(cacheDebounceRef.current)
      }
    }
  }, [household, lists])

  const listIds = useMemo(() => lists.map(l => l.id), [lists])

  // Filter items based on active filter
  const getFilteredItems = useCallback((items: ShoppingListItem[]) => {
    if (activeFilter === 'all') return items
    const allowedCategories = DEFAULT_FILTER_CATEGORIES[activeFilter]
    return items.filter(item => allowedCategories.includes(item.category as ShoppingCategory))
  }, [activeFilter])

  // Compute item counts per filter for the filter buttons
  const itemCounts = useMemo(() => {
    const allItems = lists.flatMap(l => l.items.filter(i => !i.is_bought))
    const counts: Record<ShoppingFilter, number> = {
      all: allItems.length,
      dagligvarer: 0,
      hjem: 0,
      annet: 0,
    }

    allItems.forEach(item => {
      const category = item.category as ShoppingCategory
      if (DEFAULT_FILTER_CATEGORIES.dagligvarer.includes(category)) {
        counts.dagligvarer++
      } else if (DEFAULT_FILTER_CATEGORIES.hjem.includes(category)) {
        counts.hjem++
      } else {
        counts.annet++
      }
    })

    return counts
  }, [lists])

  // Group items by category for category view
  const groupItemsByCategory = useCallback((items: ShoppingListItem[]) => {
    const groups: Record<ShoppingCategory, ShoppingListItem[]> = {} as Record<ShoppingCategory, ShoppingListItem[]>

    DEFAULT_CATEGORY_ORDER.forEach(cat => {
      groups[cat] = []
    })

    items.forEach(item => {
      const category = (item.category as ShoppingCategory) || 'other'
      if (!groups[category]) groups[category] = []
      groups[category].push(item)
    })

    // Return only non-empty categories in the correct order
    return DEFAULT_CATEGORY_ORDER
      .filter(cat => groups[cat].length > 0)
      .map(cat => ({ category: cat, items: groups[cat] }))
  }, [])

  const handleItemInsert = useCallback((record: ShoppingListItem) => {
    if (!listIds.includes(record.list_id)) return
    if (pendingChanges.current.has(record.id)) {
      pendingChanges.current.delete(record.id)
      return
    }

    setLists(prev => prev.map(list =>
      list.id === record.list_id
        ? { ...list, items: [record, ...list.items] }
        : list
    ))

    const updatedBy = (record as unknown as { updated_by?: string }).updated_by
    if (realtime && !realtime.isOwnChange(updatedBy)) {
      realtime.showToast(
        `${realtime.getMemberName(updatedBy)} la til ${record.name}`,
        'info'
      )
    }
  }, [realtime, listIds])

  const handleItemUpdate = useCallback((record: ShoppingListItem, oldRecord: ShoppingListItem | null) => {
    if (!listIds.includes(record.list_id)) return
    if (pendingChanges.current.has(record.id)) {
      pendingChanges.current.delete(record.id)
      return
    }

    setLists(prev => prev.map(list => ({
      ...list,
      items: list.items.map(item =>
        item.id === record.id ? record : item
      ),
    })))

    markChanged(record.id)

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
    if (!listIds.includes(oldRecord.list_id)) return
    if (pendingChanges.current.has(oldRecord.id)) {
      pendingChanges.current.delete(oldRecord.id)
      return
    }

    setLists(prev => prev.map(list => ({
      ...list,
      items: list.items.filter(item => item.id !== oldRecord.id),
    })))

    const updatedBy = (oldRecord as unknown as { updated_by?: string }).updated_by
    if (realtime && !realtime.isOwnChange(updatedBy)) {
      realtime.showToast(
        `${realtime.getMemberName(updatedBy)} fjernet ${oldRecord.name}`,
        'info'
      )
    }
  }, [realtime, listIds])

  const listFilter = useMemo(
    () => createInFilter('list_id', listIds),
    [listIds]
  )

  useRealtimeSubscription<ShoppingListItem>({
    table: 'shopping_list_items',
    filter: listFilter,
    onInsert: handleItemInsert,
    onUpdate: handleItemUpdate,
    onDelete: handleItemDelete,
    enabled: !loading && lists.length > 0 && !!listFilter,
  })

  const addItem = async (listId: string) => {
    const text = newItemText[listId]?.trim()
    if (!text) return

    const quantity = newItemQuantity[listId]?.trim() || null
    const cachedCategory = getCachedCategory(text)
    const initialCategory: ShoppingCategory = cachedCategory ?? 'other'

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

    setLists(prev => prev.map(list =>
      list.id === listId
        ? { ...list, items: [newItem, ...list.items] }
        : list
    ))

    setNewItemText(prev => ({ ...prev, [listId]: '' }))
    setNewItemQuantity(prev => ({ ...prev, [listId]: '' }))
    setDuplicateWarning(null)

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
      pendingChanges.current.add(data.id)
      setLists(prev => prev.map(list =>
        list.id === listId
          ? { ...list, items: list.items.map(item => item.id === tempId ? data : item) }
          : list
      ))

      if (!cachedCategory) {
        fetch('/api/openrouter/categorize-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemName: text }),
        })
          .then(res => res.ok ? res.json() : null)
          .then(catData => {
            if (catData?.category && catData.category !== initialCategory) {
              setCachedCategory(text, catData.category)
              supabase
                .from('shopping_list_items')
                .update({ category: catData.category })
                .eq('id', data.id)
                .then(() => {
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
          .catch(() => {})
      }
    } else if (error) {
      setLists(prev => prev.map(list =>
        list.id === listId
          ? { ...list, items: list.items.filter(item => item.id !== tempId) }
          : list
      ))
    }
  }

  const toggleBought = async (itemId: string, currentValue: boolean) => {
    pendingChanges.current.add(itemId)
    markChanged(itemId)
    setLists(prev =>
      prev.map(list => ({
        ...list,
        items: list.items.map(item =>
          item.id === itemId ? { ...item, is_bought: !currentValue } : item
        ),
      }))
    )
    await supabase
      .from('shopping_list_items')
      .update({ is_bought: !currentValue })
      .eq('id', itemId)
  }

  const deleteItem = useCallback((itemId: string) => {
    pendingChanges.current.add(itemId)
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

    boughtIds.forEach(id => pendingChanges.current.add(id))

    setLists(prev => prev.map(l =>
      l.id === listId
        ? { ...l, items: l.items.filter(item => !item.is_bought) }
        : l
    ))

    await supabase.from('shopping_list_items').delete().in('id', boughtIds)
  }

  const handleKeyDown = (e: React.KeyboardEvent, listId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem(listId)
    }
  }

  const addSuggestionItem = useCallback(async (name: string, quantity: string | null, category: ShoppingCategory) => {
    const mainList = lists[0]
    if (!mainList) return

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

    setLists(prev => prev.map(list =>
      list.id === mainList.id
        ? { ...list, items: [newItem, ...list.items] }
        : list
    ))

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
      pendingChanges.current.add(data.id)
      setLists(prev => prev.map(list =>
        list.id === mainList.id
          ? { ...list, items: list.items.map(item => item.id === tempId ? data : item) }
          : list
      ))
    } else if (error) {
      setLists(prev => prev.map(list =>
        list.id === mainList.id
          ? { ...list, items: list.items.filter(item => item.id !== tempId) }
          : list
      ))
    }
  }, [lists, supabase])

  if (loading && !household) {
    return <ShoppingPagePartialSkeleton t={t} />
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
          <button onClick={handleRetry} className="btn btn-primary">
            {t.common.retry}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          {t.shopping.title}
        </h1>
        <p className="mt-1" style={{ color: 'var(--muted)' }}>
          {t.shopping.emptyListDesc}
        </p>
      </div>

      {/* View mode and filter controls */}
      <ShoppingFilters
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        itemCounts={itemCounts}
      />

      <div className="grid gap-6 md:grid-cols-2">
        {lists.map(list => {
          // Apply filter to items
          const filteredItems = getFilteredItems(list.items)
          const unboughtItems = filteredItems.filter(i => !i.is_bought)
          const boughtItems = filteredItems.filter(i => i.is_bought)
          const categoryGroups = viewMode === 'category' ? groupItemsByCategory(unboughtItems) : []

          return (
            <div
              key={list.id}
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
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
                      {activeFilter !== 'all' ? t.shopping.noItemsInFilter : t.shopping.emptyList}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {activeFilter !== 'all' ? t.shopping.tryOtherFilter : t.shopping.emptyListDesc}
                    </p>
                  </div>
                ) : viewMode === 'category' ? (
                  /* Category view - items grouped by category */
                  <div className="p-3 space-y-2">
                    {categoryGroups.map(group => (
                      <ShoppingCategoryGroup
                        key={group.category}
                        category={group.category}
                        items={group.items}
                        allBought={group.items.every(i => i.is_bought)}
                        onToggleBought={toggleBought}
                        onDeleteItem={deleteItem}
                        isRecentlyChanged={isRecentlyChanged}
                      />
                    ))}

                    {boughtItems.length > 0 && (
                      <div
                        className="mt-4 pt-3 border-t"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div className="px-1 py-2">
                          <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                            {t.common.done} ({boughtItems.length})
                          </span>
                        </div>
                        <div className="space-y-1">
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
                      </div>
                    )}
                  </div>
                ) : (
                  /* Newest first view - flat list */
                  <>
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

      <ShoppingSuggestions
        onAddItem={addSuggestionItem}
        refreshTrigger={lists[0]?.items.length}
      />

      {household && (
        <WishlistOverview householdId={household.id} />
      )}

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
