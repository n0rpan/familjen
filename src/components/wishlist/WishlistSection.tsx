'use client'

import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type { WishlistItem, WishlistOccasion } from '@/lib/types'
import { WISHLIST_OCCASIONS } from '@/lib/constants'

// Dynamic import for code splitting - modal is 20KB and only loaded when needed
const AddWishlistItemModal = dynamic(
  () => import('./AddWishlistItemModal').then(mod => mod.AddWishlistItemModal),
  { ssr: false }
)

interface WishlistSectionProps {
  personId: string
  personType: 'child' | 'member'
  personName: string
  householdId: string
  showShareLink?: boolean
  onItemCountChange?: (delta: number) => void
}

interface ShareToken {
  id: string
  token: string
  occasion: string | null
}

export const WishlistSection = memo(function WishlistSection({
  personId,
  personType,
  personName,
  householdId,
  showShareLink = true,
  onItemCountChange,
}: WishlistSectionProps) {
  const { t } = useLanguage()
  const supabase = useMemo(() => createClient(), [])

  const [items, setItems] = useState<WishlistItem[]>([])
  const [shareToken, setShareToken] = useState<ShareToken | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // null means show all items (no filter)
  const [activeOccasion, setActiveOccasion] = useState<WishlistOccasion | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  // Fetch items and share token
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)

      try {
        // Build the filter based on person type
        const personFilter = personType === 'child'
          ? { child_id: personId }
          : { member_id: personId }

        // Fetch wishlist items
        const { data: itemsData, error: itemsError } = await supabase
          .from('wishlist_items')
          .select('*')
          .eq('household_id', householdId)
          .match(personFilter)
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false })

        if (itemsError) throw itemsError

        setItems(itemsData || [])

        // Fetch share token
        const { data: tokenData } = await supabase
          .from('wishlist_share_tokens')
          .select('id, token, occasion')
          .eq('household_id', householdId)
          .match(personFilter)
          .maybeSingle()

        if (tokenData) {
          setShareToken(tokenData)
        }
      } catch (err) {
        console.error('Fetch wishlist error:', err)
        setError(t.wishlists.loadError || 'Kunne ikke laste ønskelisten')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase, householdId, personId, personType, t])

  // Filter items by active occasion (null = show all)
  const filteredItems = useMemo(() => {
    if (activeOccasion === null) return items
    return items.filter(item => item.occasion === activeOccasion)
  }, [items, activeOccasion])

  // Count items by occasion
  const occasionCounts = useMemo(() => {
    const counts: Record<WishlistOccasion, number> = {
      birthday: 0,
      christmas: 0,
      general: 0,
    }
    items.forEach(item => {
      if (item.occasion in counts) {
        counts[item.occasion as WishlistOccasion]++
      }
    })
    return counts
  }, [items])

  // Create share link
  const createShareLink = useCallback(async () => {
    // Generate a short random token
    const token = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const personFilter = personType === 'child'
      ? { child_id: personId, member_id: null }
      : { member_id: personId, child_id: null }

    const { data, error: insertError } = await supabase
      .from('wishlist_share_tokens')
      .insert({
        household_id: householdId,
        ...personFilter,
        token,
      })
      .select('id, token, occasion')
      .single()

    if (insertError) {
      console.error('Create share link error:', insertError)
      setError(t.wishlists.shareLinkError || 'Kunne ikke opprette delingslenke')
      return
    }

    if (data) {
      setShareToken(data)
    }
  }, [supabase, householdId, personId, personType, t])

  // Delete share link
  const deleteShareLink = useCallback(async () => {
    if (!shareToken) return

    const { error: deleteError } = await supabase
      .from('wishlist_share_tokens')
      .delete()
      .eq('id', shareToken.id)

    if (deleteError) {
      console.error('Delete share link error:', deleteError)
      setError(t.wishlists.deleteShareLinkError || 'Kunne ikke slette delingslenken')
      return
    }

    setShareToken(null)
  }, [supabase, shareToken, t])

  // Copy share link to clipboard
  const copyShareLink = useCallback(async () => {
    if (!shareToken) return

    const url = `${window.location.origin}/g/${shareToken.token}`
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (err) {
      console.error('Clipboard error:', err)
      // Fallback: show prompt for manual copy
      window.prompt(t.wishlists.copyLinkManually || 'Kopier denne lenken:', url)
    }
  }, [shareToken, t])

  // Delete item
  const deleteItem = useCallback(async (itemId: string) => {
    const confirmed = window.confirm(t.wishlists.deleteItemConfirm)
    if (!confirmed) return

    const { error: deleteError } = await supabase
      .from('wishlist_items')
      .delete()
      .eq('id', itemId)

    if (deleteError) {
      console.error('Delete item error:', deleteError)
      setError(t.wishlists.deleteItemError || 'Kunne ikke slette ønsket')
      return
    }

    setItems(prev => prev.filter(item => item.id !== itemId))
    onItemCountChange?.(-1)
  }, [supabase, t, onItemCountChange])

  // Get status badge
  const getStatusBadge = (item: WishlistItem) => {
    if (item.status === 'bought') {
      return (
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(131, 166, 151, 0.2)', color: 'var(--color-sage)' }}
        >
          {t.wishlists.bought}
        </span>
      )
    }
    if (item.status === 'reserved') {
      return (
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(229, 185, 94, 0.2)', color: 'var(--color-honey)' }}
        >
          {t.wishlists.reserved}
        </span>
      )
    }
    return null
  }

  // Render priority stars
  const renderPriorityStars = (priority: number) => {
    if (priority === 0) return null
    return (
      <span className="text-sm" title={t.wishlists.priorityStars.replace('{count}', String(priority))}>
        {'★'.repeat(priority)}{'☆'.repeat(5 - priority)}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 rounded-lg w-48" style={{ background: 'var(--sand)' }} />
        <div className="h-24 rounded-lg" style={{ background: 'var(--sand)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Error message */}
      {error && (
        <div
          className="p-3 rounded-lg text-sm"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline"
          >
            {t.common.dismiss || 'Lukk'}
          </button>
        </div>
      )}

      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
            {t.wishlists.sectionTitle}
          </h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.wishlists.sectionDesc}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary btn-sm"
        >
          {t.wishlists.addItem}
        </button>
      </div>

      {/* Occasion tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {/* All tab */}
        <button
          onClick={() => setActiveOccasion(null)}
          className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors"
          style={{
            background: activeOccasion === null ? 'var(--accent)' : 'var(--sand)',
            color: activeOccasion === null ? 'white' : 'var(--foreground)',
          }}
        >
          {t.common.all || 'Alle'}
          {items.length > 0 && (
            <span className="ml-1.5 opacity-75">({items.length})</span>
          )}
        </button>
        {WISHLIST_OCCASIONS.map(occasion => (
          <button
            key={occasion}
            onClick={() => setActiveOccasion(occasion)}
            className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors"
            style={{
              background: activeOccasion === occasion ? 'var(--accent)' : 'var(--sand)',
              color: activeOccasion === occasion ? 'white' : 'var(--foreground)',
            }}
          >
            {t.wishlists.occasions[occasion]}
            {occasionCounts[occasion] > 0 && (
              <span className="ml-1.5 opacity-75">({occasionCounts[occasion]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Items list */}
      {filteredItems.length === 0 ? (
        <div
          className="text-center py-8 rounded-xl"
          style={{ background: 'var(--background)' }}
        >
          <p style={{ color: 'var(--muted)' }}>{t.wishlists.noItems}</p>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            {t.wishlists.noItemsDesc}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map(item => (
            <div
              key={item.id}
              className="flex gap-4 p-4 rounded-xl"
              style={{
                background: 'var(--background)',
                opacity: item.status === 'bought' ? 0.6 : 1,
              }}
            >
              {/* Image */}
              {item.image_path && (
                <div
                  className="w-16 h-16 rounded-lg bg-cover bg-center flex-shrink-0"
                  style={{
                    backgroundImage: `url(${supabase.storage.from('wishlist-images').getPublicUrl(item.image_path).data.publicUrl})`,
                  }}
                />
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span
                      className="font-medium block truncate"
                      style={{
                        color: 'var(--foreground)',
                        textDecoration: item.status === 'bought' ? 'line-through' : 'none',
                      }}
                    >
                      {item.name}
                    </span>
                    {item.description && (
                      <p className="text-sm truncate" style={{ color: 'var(--muted)' }}>
                        {item.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {getStatusBadge(item)}
                    {renderPriorityStars(item.priority)}
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-2">
                  {item.price && (
                    <span className="text-sm" style={{ color: 'var(--muted)' }}>
                      ~{item.price} kr
                    </span>
                  )}
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      {t.wishlists.itemLink}
                    </a>
                  )}
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="text-sm ml-auto"
                    style={{ color: 'var(--color-coral)' }}
                  >
                    {t.common.delete}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Share link section */}
      {showShareLink && (
        <div
          className="mt-6 p-4 rounded-xl"
          style={{ background: 'var(--sand)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.shareLink}
            </span>
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
            {t.wishlists.shareLinkDesc}
          </p>

          {shareToken ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/g/${shareToken.token}`}
                className="flex-1 px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              />
              <button
                onClick={copyShareLink}
                className="btn btn-primary btn-sm"
              >
                {linkCopied ? t.wishlists.linkCopied : t.wishlists.copyLink}
              </button>
              <button
                onClick={deleteShareLink}
                className="btn btn-sm"
                style={{ background: 'transparent', color: 'var(--color-coral)' }}
              >
                {t.common.delete}
              </button>
            </div>
          ) : (
            <button
              onClick={createShareLink}
              className="btn btn-secondary btn-sm"
            >
              {t.wishlists.createShareLink}
            </button>
          )}
        </div>
      )}

      {/* Add item modal */}
      <AddWishlistItemModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        personId={personId}
        personType={personType}
        householdId={householdId}
        defaultOccasion={activeOccasion || 'general'}
        onItemAdded={(newItem) => {
          setItems(prev => {
            const isUpdate = prev.some(i => i.id === newItem.id)
            if (!isUpdate) {
              // New item added - notify parent of count change
              onItemCountChange?.(1)
            }
            return [newItem, ...prev.filter(i => i.id !== newItem.id)]
          })
        }}
      />
    </div>
  )
})
