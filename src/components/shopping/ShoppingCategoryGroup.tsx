'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import type { ShoppingCategory } from '@/lib/constants'
import type { ShoppingListItem } from '@/lib/types'

interface ShoppingCategoryGroupProps {
  category: ShoppingCategory
  items: ShoppingListItem[]
  allBought: boolean
  onToggleBought: (itemId: string, currentValue: boolean) => void
  onDeleteItem: (itemId: string) => void
  isRecentlyChanged: (id: string) => boolean
  defaultExpanded?: boolean
}

// Category icons
const CATEGORY_ICONS: Record<ShoppingCategory, string> = {
  produce: '🥬',
  dairy: '🥛',
  meat: '🍖',
  frozen: '🧊',
  pantry: '🍞',
  beverages: '🥤',
  household: '🧹',
  home: '🏠',
  electronics: '🔌',
  other: '📦',
}

export function ShoppingCategoryGroup({
  category,
  items,
  allBought,
  onToggleBought,
  onDeleteItem,
  isRecentlyChanged,
  defaultExpanded = true,
}: ShoppingCategoryGroupProps) {
  const { t } = useLanguage()
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  // Auto-collapse when all items are bought
  useEffect(() => {
    if (allBought && isExpanded) {
      // Small delay for visual feedback before collapsing
      const timer = setTimeout(() => setIsExpanded(false), 300)
      return () => clearTimeout(timer)
    }
  }, [allBought, isExpanded])

  // Get translated category name - all categories are defined in aisles
  const getCategoryName = (): string => {
    return t.shopping.aisles[category] ?? category
  }

  const unboughtCount = items.filter(i => !i.is_bought).length
  const totalCount = items.length
  const icon = CATEGORY_ICONS[category]

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Category header */}
      <button
        id={`category-${category}-header`}
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-[var(--sand)] transition-colors"
        aria-expanded={isExpanded}
        aria-controls={`category-${category}-items`}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
            {getCategoryName()}
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              background: allBought ? 'rgba(139, 168, 136, 0.2)' : 'var(--sand)',
              color: allBought ? 'var(--color-sage)' : 'var(--muted)',
            }}
          >
            {allBought ? (
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {totalCount}
              </span>
            ) : (
              `${unboughtCount}/${totalCount}`
            )}
          </span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Items list */}
      <div
        id={`category-${category}-items`}
        role="group"
        aria-labelledby={`category-${category}-header`}
        style={{
          display: isExpanded ? 'block' : 'none',
        }}
      >
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {items.map(item => (
            <div
              key={item.id}
              className={`flex items-center gap-3 p-3 group ${isRecentlyChanged(item.id) ? 'highlight-save' : ''}`}
            >
              {/* Checkbox */}
              <button
                onClick={() => onToggleBought(item.id, item.is_bought)}
                className="w-6 h-6 min-w-6 rounded-lg border-2 flex items-center justify-center transition-colors hover:bg-[var(--sand)]"
                style={{
                  borderColor: item.is_bought ? 'transparent' : 'var(--border)',
                  background: item.is_bought ? 'var(--color-sage)' : 'transparent',
                }}
                aria-label={item.is_bought ? t.shopping.markAsNotBought : t.shopping.markAsBought}
              >
                {item.is_bought && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>

              {/* Item name and quantity */}
              <div className="flex-1 min-w-0">
                <span
                  className="text-sm"
                  style={{
                    color: item.is_bought ? 'var(--muted)' : 'var(--foreground)',
                    textDecoration: item.is_bought ? 'line-through' : 'none',
                  }}
                >
                  {item.name}
                </span>
                {item.quantity && (
                  <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
                    ({item.quantity})
                  </span>
                )}
              </div>

              {/* Delete button - visible on desktop, tap to reveal on mobile */}
              <button
                onClick={() => onDeleteItem(item.id)}
                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 md:opacity-100 transition-opacity hover:bg-red-50"
                style={{ color: 'var(--muted)' }}
                aria-label={t.shopping.deleteItemLabel.replace('{name}', item.name)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
