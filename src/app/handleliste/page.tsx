'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ShoppingList, ShoppingListItem, Household } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'

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

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (hasInitialized.current) return
    hasInitialized.current = true
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      // Get household
      const { data: householdData, error: householdError } = await supabase
        .from('households')
        .select('*')
        .single()

      if (householdError && householdError.code !== 'PGRST116') {
        throw new Error(t.errors.couldNotLoadHousehold)
      }

      if (!householdData) {
        setHousehold(null)
        setLists([])
        setLoading(false)
        return
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

  const addItem = async (listId: string) => {
    const text = newItemText[listId]?.trim()
    if (!text) return

    const quantity = newItemQuantity[listId]?.trim() || null

    await supabase.from('shopping_list_items').insert({
      list_id: listId,
      name: text,
      quantity,
    })

    setNewItemText(prev => ({ ...prev, [listId]: '' }))
    setNewItemQuantity(prev => ({ ...prev, [listId]: '' }))
    loadData()
  }

  const toggleBought = async (itemId: string, currentValue: boolean) => {
    await supabase
      .from('shopping_list_items')
      .update({ is_bought: !currentValue })
      .eq('id', itemId)

    // Optimistic update
    setLists(prev =>
      prev.map(list => ({
        ...list,
        items: list.items.map(item =>
          item.id === itemId ? { ...item, is_bought: !currentValue } : item
        ),
      }))
    )
  }

  const deleteItem = async (itemId: string) => {
    await supabase.from('shopping_list_items').delete().eq('id', itemId)

    // Optimistic update
    setLists(prev =>
      prev.map(list => ({
        ...list,
        items: list.items.filter(item => item.id !== itemId),
      }))
    )
  }

  const clearBoughtItems = async (listId: string) => {
    const list = lists.find(l => l.id === listId)
    if (!list) return

    const boughtIds = list.items.filter(i => i.is_bought).map(i => i.id)
    if (boughtIds.length === 0) return

    await supabase.from('shopping_list_items').delete().in('id', boughtIds)
    loadData()
  }

  const handleKeyDown = (e: React.KeyboardEvent, listId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem(listId)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 rounded-xl w-48" style={{ background: 'var(--sand)' }} />
        <div className="h-64 rounded-2xl" style={{ background: 'var(--sand)' }} />
        <div className="h-64 rounded-2xl" style={{ background: 'var(--sand)' }} />
      </div>
    )
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
                      {unboughtItems.length} varer
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
                    placeholder="Ant."
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
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>
                      {t.shopping.emptyList}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Unbought items */}
                    {unboughtItems.map(item => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-3 group"
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
                            className="flex items-center gap-3 px-3 py-2 group"
                          >
                            <button
                              onClick={() => toggleBought(item.id, item.is_bought)}
                              className="w-6 h-6 rounded-lg flex items-center justify-center"
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
