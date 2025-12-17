'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ShoppingList, ShoppingListItem, Household } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'
import { ListPageSkeleton } from '@/components/Skeleton'
import { useMicroFeedback } from '@/hooks/useMicroFeedback'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import { useRealtimeOptional } from '@/lib/realtime/context'

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
  const hasInitialized = useRef(false)

  // Micro-feedback for recently changed items
  const { markChanged, isRecentlyChanged } = useMicroFeedback(800)

  const supabase = useMemo(() => createClient(), [])
  const realtime = useRealtimeOptional()

  // Track items we're currently modifying to prevent double-updates
  const pendingChanges = useRef<Set<string>>(new Set())

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

      // Get shopping lists
      let { data: listsData, error: listsError } = await supabase
        .from('shopping_lists')
        .select('*')
        .eq('household_id', householdData.id)
        .order('sort_order')

      if (listsError) throw new Error(t.errors.loadFailed)

      // Create default lists if none exist, or clean up duplicates
      if (!listsData || listsData.length === 0) {
        const defaultLists = [
          { household_id: householdData.id, name: t.shopping.aisles.produce, sort_order: 0 },
          { household_id: householdData.id, name: t.shopping.aisles.other, sort_order: 1 },
        ]

        const { data: newLists, error: createError } = await supabase
          .from('shopping_lists')
          .insert(defaultLists)
          .select()

        if (createError) throw new Error(t.errors.saveFailed)
        listsData = newLists
      } else {
        // Check for and clean up duplicates
        const dagligvarerLists = listsData.filter(l => l.name === 'Dagligvarer')
        const andreLists = listsData.filter(l => l.name === 'Andre butikker')

        if (dagligvarerLists.length > 1 || andreLists.length > 1) {
          // Keep the oldest of each, delete the rest
          const toDelete: string[] = []

          if (dagligvarerLists.length > 1) {
            dagligvarerLists.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            toDelete.push(...dagligvarerLists.slice(1).map(l => l.id))
          }

          if (andreLists.length > 1) {
            andreLists.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            toDelete.push(...andreLists.slice(1).map(l => l.id))
          }

          if (toDelete.length > 0) {
            // Delete items from duplicate lists first
            await supabase.from('shopping_list_items').delete().in('list_id', toDelete)
            // Delete duplicate lists
            await supabase.from('shopping_lists').delete().in('id', toDelete)
            // Refresh the list
            const { data: freshLists } = await supabase
              .from('shopping_lists')
              .select('*')
              .eq('household_id', householdData.id)
              .order('sort_order')
            listsData = freshLists || []
          }
        }
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

    // Create a temporary ID for optimistic update
    const tempId = `temp-${Date.now()}`
    const newItem: ShoppingListItem = {
      id: tempId,
      list_id: listId,
      name: text,
      quantity,
      is_bought: false,
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

    // Insert and get the real ID
    const { data, error } = await supabase
      .from('shopping_list_items')
      .insert({
        list_id: listId,
        name: text,
        quantity,
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

  const deleteItem = async (itemId: string) => {
    // Mark as pending to prevent duplicate handling from realtime
    pendingChanges.current.add(itemId)

    // Optimistic update
    setLists(prev =>
      prev.map(list => ({
        ...list,
        items: list.items.filter(item => item.id !== itemId),
      }))
    )

    // Persist to database
    await supabase.from('shopping_list_items').delete().eq('id', itemId)
  }

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
                    onChange={e => setNewItemText(prev => ({ ...prev, [list.id]: e.target.value }))}
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
                      <div
                        key={item.id}
                        className={`flex items-center gap-3 p-3 group touch-feedback ${isRecentlyChanged(item.id) ? 'highlight-save' : ''}`}
                      >
                        <button
                          onClick={() => toggleBought(item.id, item.is_bought)}
                          className="w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors hover:bg-[var(--sand)]"
                          style={{ borderColor: 'var(--border)' }}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                            {item.name}
                          </span>
                          {item.quantity && (
                            <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
                              ({item.quantity})
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                          style={{ color: 'var(--muted)' }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
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
                          <div
                            key={item.id}
                            className={`flex items-center gap-3 px-3 py-2 group touch-feedback ${isRecentlyChanged(item.id) ? 'highlight-save' : ''}`}
                          >
                            <button
                              onClick={() => toggleBought(item.id, item.is_bought)}
                              className={`w-6 h-6 rounded-lg flex items-center justify-center ${isRecentlyChanged(item.id) ? 'just-checked' : ''}`}
                              style={{ background: 'var(--color-sage)' }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            </button>
                            <div className="flex-1 min-w-0">
                              <span
                                className="text-sm line-through"
                                style={{ color: 'var(--muted)' }}
                              >
                                {item.name}
                              </span>
                              {item.quantity && (
                                <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
                                  ({item.quantity})
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => deleteItem(item.id)}
                              className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                              style={{ color: 'var(--muted)' }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>
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
    </div>
  )
}
