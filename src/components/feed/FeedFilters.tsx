'use client'

import { useLanguage } from '@/lib/i18n/context'

export type FeedFilter = 'all' | 'spond' | 'school' | 'kindergarten' | 'photos' | 'reminders'

interface Props {
  activeFilter: FeedFilter
  onFilterChange: (filter: FeedFilter) => void
  counts: {
    all: number
    spond: number
    school: number
    kindergarten: number
    photos: number
    reminders: number
  }
}

export function FeedFilters({ activeFilter, onFilterChange, counts }: Props) {
  const { t } = useLanguage()

  const filters: { id: FeedFilter; label: string; icon?: string }[] = [
    { id: 'all', label: t.feed.filters.all },
    { id: 'spond', label: t.feed.filters.spond },
    { id: 'school', label: t.feed.filters.school },
    { id: 'kindergarten', label: t.feed.filters.kindergarten },
    { id: 'photos', label: t.feed.filters.photos, icon: '📷' },
    { id: 'reminders', label: t.feed.filters.reminders, icon: '🔔' },
  ]

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
      {filters.map((filter, index) => {
        const isLast = index === filters.length - 1
        const isActive = activeFilter === filter.id
        const count = counts[filter.id]

        return (
          <button
            key={filter.id}
            onClick={() => onFilterChange(filter.id)}
            className={`flex items-center gap-1.5 px-4 min-h-[44px] rounded-full text-sm font-medium whitespace-nowrap transition-all ${isLast ? 'mr-4' : ''}`}
            style={{
              background: isActive ? 'var(--accent)' : 'var(--background)',
              color: isActive ? 'white' : 'var(--foreground)',
              border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
            }}
          >
            {filter.icon && <span>{filter.icon}</span>}
            <span>{filter.label}</span>
            {count > 0 && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{
                  background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--sand)',
                  color: isActive ? 'white' : 'var(--muted)',
                }}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
