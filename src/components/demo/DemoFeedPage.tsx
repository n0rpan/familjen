'use client'

/**
 * DemoFeedPage Component
 *
 * Client-side version of the feed page that uses demo data hooks.
 * Rendered when ?demo=true is in the URL.
 */

import { useState, useMemo } from 'react'
import { useFeed, useChildren } from '@/hooks/data'
import { useLanguage } from '@/lib/i18n/context'
import { TransitionLink } from '@/components/TransitionLink'
import { formatDateISO, addDays } from '@/lib/utils'

type FeedFilter = 'all' | 'spond' | 'school' | 'kindergarten' | 'photos' | 'reminders'

export function DemoFeedPage() {
  const { t } = useLanguage()
  const [activeFilter, setActiveFilter] = useState<FeedFilter>('all')

  const { messages, photos, loading, error } = useFeed()
  const { children } = useChildren()

  // Group messages by child
  const messagesByChild = useMemo(() => {
    const grouped = new Map<string, typeof messages>()
    messages.forEach(msg => {
      if (msg.child_id) {
        const existing = grouped.get(msg.child_id) || []
        grouped.set(msg.child_id, [...existing, msg])
      }
    })
    return grouped
  }, [messages])

  // Filter messages based on active filter
  const filteredMessages = useMemo(() => {
    if (activeFilter === 'all') return messages
    if (activeFilter === 'photos') return []
    if (activeFilter === 'reminders') return []
    // Filter by integration type would need integration data
    return messages
  }, [messages, activeFilter])

  // Format date for display
  const formatMessageDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const today = new Date()
    const yesterday = addDays(today, -1)

    if (formatDateISO(date) === formatDateISO(today)) {
      return 'I dag'
    } else if (formatDateISO(date) === formatDateISO(yesterday)) {
      return 'I går'
    }
    return date.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' })
  }

  // Get child name by ID
  const getChildName = (childId: string | null) => {
    if (!childId) return null
    return children.find(c => c.id === childId)?.name || null
  }

  // Get child color by ID
  const getChildColor = (childId: string | null) => {
    if (!childId) return null
    return children.find(c => c.id === childId)?.color || null
  }

  const filters: { id: FeedFilter; label: string }[] = [
    { id: 'all', label: 'Alle' },
    { id: 'spond', label: 'Spond' },
    { id: 'school', label: 'Skole' },
    { id: 'kindergarten', label: 'Barnehage' },
    { id: 'photos', label: 'Bilder' },
    { id: 'reminders', label: 'Påminnelser' },
  ]

  if (loading) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.feed}</h1>
          <p style={{ color: 'var(--muted)' }}>
            Meldinger, bilder og varsler fra Spond, barnehage og skole
          </p>
        </div>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-gray-200 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.feed}</h1>
        </div>
        <div className="card p-8 text-center">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <h1 className="page-title">{t.nav.feed}</h1>
        <p style={{ color: 'var(--muted)' }}>
          Meldinger, bilder og varsler fra Spond, barnehage og skole
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {filters.map(filter => (
          <button
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              activeFilter === filter.id
                ? 'text-white'
                : ''
            }`}
            style={{
              background: activeFilter === filter.id ? 'var(--accent)' : 'var(--card)',
              color: activeFilter === filter.id ? 'white' : 'var(--foreground)',
              border: `1px solid ${activeFilter === filter.id ? 'transparent' : 'var(--border)'}`,
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Messages list */}
      {filteredMessages.length === 0 ? (
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
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--muted)', margin: '0 auto' }}
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Ingen meldinger
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            Meldinger fra integrasjoner vil vises her
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMessages.map(message => {
            const childName = getChildName(message.child_id)
            const childColor = getChildColor(message.child_id)

            return (
              <div
                key={message.id}
                className="card p-4"
                style={{
                  borderLeft: childColor ? `4px solid var(--color-${childColor})` : undefined,
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {childName && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: childColor ? `var(--color-${childColor})` : 'var(--muted)',
                            color: 'white',
                          }}
                        >
                          {childName}
                        </span>
                      )}
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        {formatMessageDate(message.message_date)}
                      </span>
                    </div>
                    <h3 className="font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                      {message.title || 'Melding'}
                    </h3>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>
                      Fra: {message.sender_name}
                    </p>
                    <p className="text-sm mt-2" style={{ color: 'var(--foreground)' }}>
                      {message.body}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Photos section */}
      {activeFilter === 'photos' && photos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map(photo => (
            <div
              key={photo.id}
              className="aspect-square rounded-xl overflow-hidden bg-gray-200"
            >
              {photo.storage_path ? (
                <img
                  src={photo.storage_path}
                  alt={photo.title || 'Foto'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    style={{ color: 'var(--muted)' }}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
