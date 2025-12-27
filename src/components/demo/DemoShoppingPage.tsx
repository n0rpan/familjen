'use client'

/**
 * DemoShoppingPage Component
 *
 * Client-side version of the shopping page that uses demo data hooks.
 * Enhanced to match production UI for visual testing.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useShoppingLists, useHousehold } from '@/hooks/data'
import { useLanguage } from '@/lib/i18n/context'
import { ShoppingItem } from '@/components/shopping/ShoppingItem'
import { WishlistOverview } from '@/components/wishlist'
import { useMicroFeedback } from '@/hooks/useMicroFeedback'
import type { ShoppingCategory } from '@/lib/constants'

export function DemoShoppingPage() {
  const { t } = useLanguage()
  const { household } = useHousehold()
  const { lists, loading, error, addItem, updateItem, deleteItem } = useShoppingLists()
  const [newItemText, setNewItemText] = useState<Record<string, string>>({})
  const [newItemQuantity, setNewItemQuantity] = useState<Record<string, string>>({})

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

  const handleAddItem = useCallback(async (listId: string) => {
    const text = newItemText[listId]?.trim()
    if (!text) return

    const quantity = newItemQuantity[listId]?.trim() || null
    const category: ShoppingCategory = 'other'

    await addItem(listId, {
      name: text,
      quantity,
      category,
      is_bought: false,
      source_recipe_id: null,
    })

    setNewItemText(prev => ({ ...prev, [listId]: '' }))
    setNewItemQuantity(prev => ({ ...prev, [listId]: '' }))
  }, [newItemText, newItemQuantity, addItem])

  const handleToggle = useCallback(async (itemId: string, currentValue: boolean) => {
    markChanged(itemId)
    await updateItem(itemId, { is_bought: !currentValue })
  }, [updateItem, markChanged])

  const handleDelete = useCallback(async (itemId: string) => {
    await deleteItem(itemId)
  }, [deleteItem])

  const handleKeyDown = useCallback((e: React.KeyboardEvent, listId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddItem(listId)
    }
  }, [handleAddItem])

  // Clear all bought items in a list
  const clearBoughtItems = useCallback(async (listId: string) => {
    const list = lists.find(l => l.id === listId)
    if (!list) return

    const boughtItems = list.items.filter(i => i.is_bought)
    for (const item of boughtItems) {
      await deleteItem(item.id)
    }
  }, [lists, deleteItem])

  if (loading) {
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
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-xl" style={{ background: 'var(--card)' }} />
          ))}
        </div>
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
                    style={{ background: 'rgba(126, 182, 196, 0.2)' }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="21" r="1"/>
                      <circle cx="20" cy="21" r="1"/>
                      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                    </svg>
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
                    onClick={() => handleAddItem(list.id)}
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
                      <ShoppingItem
                        key={item.id}
                        item={item}
                        isBought={false}
                        isRecentlyChanged={isRecentlyChanged(item.id)}
                        onToggle={handleToggle}
                        onDelete={handleDelete}
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
                            onToggle={handleToggle}
                            onDelete={handleDelete}
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

      {/* Wishlists section */}
      {household && (
        <WishlistOverview householdId={household.id} />
      )}
    </div>
  )
}
