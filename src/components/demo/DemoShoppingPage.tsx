'use client'

/**
 * DemoShoppingPage Component
 *
 * Client-side version of the shopping page that uses demo data hooks.
 */

import { useState } from 'react'
import { useShoppingLists } from '@/hooks/data'
import { useLanguage } from '@/lib/i18n/context'

export function DemoShoppingPage() {
  const { t } = useLanguage()
  const { lists, loading, error, updateItem } = useShoppingLists()
  const [newItemName, setNewItemName] = useState('')

  if (loading) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.shoppingList}</h1>
        </div>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-200 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.shoppingList}</h1>
        </div>
        <div className="card p-8 text-center">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  const activeList = lists[0]
  const unboughtItems = activeList?.items.filter(i => !i.is_bought) || []
  const boughtItems = activeList?.items.filter(i => i.is_bought) || []

  const toggleItem = async (itemId: string, isBought: boolean) => {
    await updateItem(itemId, { is_bought: !isBought })
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <h1 className="page-title">{t.nav.shoppingList}</h1>
        <p style={{ color: 'var(--muted)' }}>
          {activeList?.name || 'Handleliste'}
        </p>
      </div>

      {/* Add item input */}
      <div className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="Legg til vare..."
            className="flex-1 px-4 py-3 rounded-xl"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          />
          <button
            className="px-6 py-3 rounded-xl font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            +
          </button>
        </div>
      </div>

      {/* Items list */}
      <div className="space-y-2">
        {unboughtItems.map(item => (
          <div
            key={item.id}
            onClick={() => toggleItem(item.id, item.is_bought)}
            className="flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all hover:scale-[1.01]"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <div
              className="w-6 h-6 rounded-full border-2 flex items-center justify-center"
              style={{ borderColor: 'var(--border)' }}
            />
            <span className="flex-1" style={{ color: 'var(--foreground)' }}>
              {item.name}
            </span>
            {item.quantity && (
              <span className="text-sm" style={{ color: 'var(--muted)' }}>
                {item.quantity}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Bought items */}
      {boughtItems.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--muted)' }}>
            Kjøpt ({boughtItems.length})
          </h3>
          <div className="space-y-2">
            {boughtItems.map(item => (
              <div
                key={item.id}
                onClick={() => toggleItem(item.id, item.is_bought)}
                className="flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all hover:scale-[1.01] opacity-60"
                style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: 'var(--color-sage)', color: 'white' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <span className="flex-1 line-through" style={{ color: 'var(--muted)' }}>
                  {item.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {unboughtItems.length === 0 && boughtItems.length === 0 && (
        <div
          className="card p-8 text-center"
          style={{
            border: '2px dashed var(--border)',
            background: 'transparent',
          }}
        >
          <div className="mb-4">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ color: 'var(--muted)', margin: '0 auto' }}
            >
              <circle cx="9" cy="21" r="1"/>
              <circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Listen er tom
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            Legg til varer for å begynne
          </p>
        </div>
      )}
    </div>
  )
}
