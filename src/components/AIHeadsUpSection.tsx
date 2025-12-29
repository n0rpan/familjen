'use client'

import { memo } from 'react'
import { HeadsUpItem } from './HeadsUpItem'
import type { AIHeadsUp } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'

interface AIHeadsUpSectionProps {
  items: AIHeadsUp[]
  loading?: boolean
}

export const AIHeadsUpSection = memo(function AIHeadsUpSection({
  items,
  loading,
}: AIHeadsUpSectionProps) {
  const { t } = useLanguage()

  // Don't render if no items and not loading
  if (!loading && items.length === 0) {
    return null
  }

  if (loading) {
    return (
      <div
        className="rounded-2xl p-6 md:p-8 animate-pulse"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="h-6 rounded-lg w-32 mb-4" style={{ background: 'var(--sand)' }} />
        <div className="space-y-3">
          <div className="h-16 rounded-xl" style={{ background: 'var(--sand)' }} />
          <div className="h-16 rounded-xl" style={{ background: 'var(--sand)' }} />
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-6 md:p-8"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(126, 182, 196, 0.2)' }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-sky)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div>
          <h2
            className="text-lg font-semibold font-display"
            style={{ color: 'var(--foreground)' }}
          >
            {t.home.headsUp || 'Denne uken'}
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {items.length} {items.length === 1
              ? (t.home.headsUpItemSingular || 'varsel')
              : (t.home.headsUpItemPlural || 'varsler')}
          </p>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-2">
        {items.map((item) => (
          <HeadsUpItem key={item.id} item={item} />
        ))}
      </div>

      {/* Footer note */}
      <p
        className="text-xs mt-4 text-center"
        style={{ color: 'var(--muted)', opacity: 0.7 }}
      >
        {t.home.headsUpSource || 'Basert på meldinger og kalender'}
      </p>
    </div>
  )
})
