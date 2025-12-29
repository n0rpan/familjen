'use client'

import { useLanguage } from '@/lib/i18n/context'
import type { ShoppingFilter, ShoppingViewMode } from '@/lib/constants'
import { SHOPPING_FILTERS } from '@/lib/constants'

interface ShoppingFiltersProps {
  viewMode: ShoppingViewMode
  onViewModeChange: (mode: ShoppingViewMode) => void
  activeFilter: ShoppingFilter
  onFilterChange: (filter: ShoppingFilter) => void
  itemCounts?: Record<ShoppingFilter, number>
}

export function ShoppingFilters({
  viewMode,
  onViewModeChange,
  activeFilter,
  onFilterChange,
  itemCounts,
}: ShoppingFiltersProps) {
  const { t } = useLanguage()

  const filterLabels: Record<ShoppingFilter, string> = {
    all: t.shopping.filterAll ?? 'Alt',
    dagligvarer: t.shopping.filterGroceries ?? 'Dagligvarer',
    hjem: t.shopping.filterHome ?? 'Hjem',
    annet: t.shopping.filterOther ?? 'Annet',
  }

  return (
    <div className="space-y-3">
      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
          {t.shopping.viewMode ?? 'Visning'}:
        </span>
        <div
          className="inline-flex rounded-lg p-1"
          style={{ background: 'var(--sand)' }}
          role="tablist"
        >
          <button
            role="tab"
            aria-selected={viewMode === 'newest'}
            onClick={() => onViewModeChange('newest')}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            style={{
              background: viewMode === 'newest' ? 'var(--card)' : 'transparent',
              color: viewMode === 'newest' ? 'var(--foreground)' : 'var(--muted)',
              boxShadow: viewMode === 'newest' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
            }}
          >
            {t.shopping.newestFirst ?? 'Nyeste først'}
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'category'}
            onClick={() => onViewModeChange('category')}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            style={{
              background: viewMode === 'category' ? 'var(--card)' : 'transparent',
              color: viewMode === 'category' ? 'var(--foreground)' : 'var(--muted)',
              boxShadow: viewMode === 'category' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
            }}
          >
            {t.shopping.byCategory ?? 'Etter kategori'}
          </button>
        </div>
      </div>

      {/* Filter buttons - using aria-pressed for toggle buttons */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t.shopping.filterAll}>
        {SHOPPING_FILTERS.map((filter) => {
          const count = itemCounts?.[filter]
          const isActive = filter === activeFilter

          return (
            <button
              key={filter}
              aria-pressed={isActive}
              onClick={() => onFilterChange(filter)}
              className="px-3 py-1.5 text-xs font-medium rounded-full transition-colors"
              style={{
                background: isActive ? 'var(--foreground)' : 'var(--sand)',
                color: isActive ? 'var(--background)' : 'var(--muted)',
              }}
            >
              {filterLabels[filter]}
              {count !== undefined && count > 0 && (
                <span className="ml-1 opacity-70">({count})</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
