'use client'

import { useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface WishlistItemWithUrl {
  id: string
  name: string
  description: string | null
  link: string | null
  price: number | null
  image_path: string | null
  imageUrl: string | null
  occasion: string
  priority: number
  status: string
  reserved_by: string | null
  person_name: string
  person_type: string
}

interface SharedWishlistClientProps {
  token: string
  personName: string
  byOccasion: Record<string, WishlistItemWithUrl[]>
}

const OCCASION_LABELS: Record<string, { nb: string; en: string; emoji: string }> = {
  birthday: { nb: 'Bursdag', en: 'Birthday', emoji: '🎂' },
  christmas: { nb: 'Jul', en: 'Christmas', emoji: '🎄' },
  general: { nb: 'Generelt', en: 'General', emoji: '🎁' },
}

export function SharedWishlistClient({
  token,
  personName,
  byOccasion,
}: SharedWishlistClientProps) {
  const supabase = useMemo(() => createClient(), [])

  const [items, setItems] = useState(byOccasion)
  const [reserving, setReserving] = useState<string | null>(null)
  const [reserveModalItem, setReserveModalItem] = useState<WishlistItemWithUrl | null>(null)
  const [reserverName, setReserverName] = useState('')
  const [reserveError, setReserveError] = useState<string | null>(null)

  // Reserve an item
  const handleReserve = useCallback(async () => {
    if (!reserveModalItem || !reserverName.trim()) return

    setReserving(reserveModalItem.id)
    setReserveError(null)

    try {
      const { data: success, error } = await supabase.rpc('reserve_shared_wishlist_item', {
        p_token: token,
        p_item_id: reserveModalItem.id,
        p_reserver_name: reserverName.trim(),
      })

      if (error) {
        console.error('Reserve RPC error:', error)
        setReserveError('Kunne ikke reservere. Prøv igjen.')
        return
      }

      if (!success) {
        setReserveError('Dette ønsket er allerede reservert av noen andre.')
        return
      }

      // Success - update local state and close modal
      setItems(prev => {
        const updated = { ...prev }
        for (const occasion of Object.keys(updated)) {
          updated[occasion] = updated[occasion].map(item =>
            item.id === reserveModalItem.id
              ? { ...item, status: 'reserved', reserved_by: reserverName.trim() }
              : item
          )
        }
        return updated
      })
      setReserveModalItem(null)
      setReserverName('')
    } catch (error) {
      console.error('Reserve network error:', error)
      setReserveError('Nettverksfeil. Sjekk tilkoblingen og prøv igjen.')
    } finally {
      setReserving(null)
    }
  }, [supabase, token, reserveModalItem, reserverName])

  // Get all occasions
  const occasions = Object.keys(items)

  // Render priority stars
  const renderPriorityStars = (priority: number) => {
    if (priority === 0) return null
    return (
      <span className="text-sm text-yellow-500" title={`${priority} stars`}>
        {'★'.repeat(priority)}{'☆'.repeat(5 - priority)}
      </span>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-6" style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {personName}s ønskeliste
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Trykk på et ønske for å reservere det
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto p-4 space-y-8">
        {occasions.map(occasion => (
          <div key={occasion}>
            {/* Occasion header */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">{OCCASION_LABELS[occasion]?.emoji || '🎁'}</span>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
                {OCCASION_LABELS[occasion]?.nb || occasion}
              </h2>
              <span className="text-sm" style={{ color: 'var(--muted)' }}>
                ({items[occasion].length})
              </span>
            </div>

            {/* Items */}
            <div className="space-y-3">
              {items[occasion].map(item => {
                const isReserved = item.status === 'reserved'
                const isBought = item.status === 'bought'
                const isUnavailable = isReserved || isBought

                return (
                  <div
                    key={item.id}
                    className="rounded-xl overflow-hidden"
                    style={{
                      background: 'var(--card)',
                      opacity: isUnavailable ? 0.6 : 1,
                    }}
                  >
                    <button
                      onClick={() => !isUnavailable && setReserveModalItem(item)}
                      disabled={isUnavailable}
                      className="w-full text-left"
                    >
                      <div className="flex gap-4 p-4">
                        {/* Image */}
                        {item.imageUrl ? (
                          <div
                            className="w-20 h-20 rounded-lg bg-cover bg-center flex-shrink-0"
                            style={{ backgroundImage: `url(${item.imageUrl})` }}
                          />
                        ) : (
                          <div
                            className="w-20 h-20 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: 'var(--sand)' }}
                          >
                            <span className="text-3xl">🎁</span>
                          </div>
                        )}

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className="font-medium block"
                              style={{
                                color: 'var(--foreground)',
                                textDecoration: isBought ? 'line-through' : 'none',
                              }}
                            >
                              {item.name}
                            </span>
                            {renderPriorityStars(item.priority)}
                          </div>

                          {item.description && (
                            <p className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--muted)' }}>
                              {item.description}
                            </p>
                          )}

                          <div className="flex items-center gap-3 mt-2">
                            {item.price && (
                              <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                                ~{item.price} kr
                              </span>
                            )}
                            {item.link && (
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="text-sm underline"
                                style={{ color: 'var(--accent)' }}
                              >
                                Se i butikk
                              </a>
                            )}
                          </div>

                          {/* Status badge */}
                          {isReserved && (
                            <div className="mt-2">
                              <span
                                className="text-xs px-2 py-1 rounded-full"
                                style={{ background: 'rgba(229, 185, 94, 0.2)', color: 'var(--color-honey)' }}
                              >
                                Reservert av {item.reserved_by}
                              </span>
                            </div>
                          )}
                          {isBought && (
                            <div className="mt-2">
                              <span
                                className="text-xs px-2 py-1 rounded-full"
                                style={{ background: 'rgba(131, 166, 151, 0.2)', color: 'var(--color-sage)' }}
                              >
                                Kjøpt
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Reserve modal */}
      {reserveModalItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => {
            setReserveModalItem(null)
            setReserveError(null)
          }}
        >
          <div
            className="w-full max-w-sm max-h-[85vh] rounded-2xl p-6 overflow-hidden"
            style={{ background: 'var(--card)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
              Reserver {reserveModalItem.name}
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              Skriv inn navnet ditt så andre ser at du har reservert dette ønsket.
            </p>

            <input
              type="text"
              value={reserverName}
              onChange={e => setReserverName(e.target.value)}
              placeholder="Ditt navn"
              autoFocus
              className="w-full px-4 py-3 rounded-xl mb-4"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />

            {reserveError && (
              <p className="text-sm mb-4 p-3 rounded-xl" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                {reserveError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setReserveModalItem(null)
                  setReserveError(null)
                }}
                className="flex-1 py-3 rounded-xl font-medium"
                style={{ background: 'var(--background)', color: 'var(--foreground)' }}
              >
                Avbryt
              </button>
              <button
                onClick={handleReserve}
                disabled={!reserverName.trim() || reserving === reserveModalItem.id}
                className="flex-1 py-3 rounded-xl font-medium disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                {reserving === reserveModalItem.id ? 'Reserverer...' : 'Reserver'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="py-8 text-center">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Laget med Familjen
        </p>
      </div>
    </div>
  )
}
