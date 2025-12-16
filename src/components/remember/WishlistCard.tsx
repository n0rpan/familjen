'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import { getChildColor } from '@/lib/colors'
import type { WishlistWithItems, WishlistItem, ChildColor } from '@/lib/types'

interface WishlistCardProps {
  wishlist: WishlistWithItems
  currentMemberId: string | null
  onAddItem: (wishlistId: string) => void
  onEditItem: (item: WishlistItem) => void
  onReserveItem: (itemId: string) => void
  onUnreserveItem: (itemId: string) => void
  onFulfillItem: (itemId: string) => void
  onDeleteItem: (itemId: string) => void
  onEditWishlist: () => void
  onDeleteWishlist: () => void
}

export function WishlistCard({
  wishlist,
  currentMemberId,
  onAddItem,
  onEditItem,
  onReserveItem,
  onUnreserveItem,
  onFulfillItem,
  onDeleteItem,
  onEditWishlist,
  onDeleteWishlist,
}: WishlistCardProps) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(true)

  const isOwnWishlist = wishlist.member_id === currentMemberId
  const ownerColor = wishlist.owner_color as ChildColor | null

  // Group items by status
  const openItems = wishlist.items.filter(item => item.status === 'open')
  const reservedItems = wishlist.items.filter(item => item.status === 'reserved')
  const fulfilledItems = wishlist.items.filter(item => item.status === 'fulfilled')

  const getOccasionLabel = (occasion: string | null) => {
    if (!occasion) return null
    return t.wishlists.occasions[occasion as keyof typeof t.wishlists.occasions] || occasion
  }

  const formatPrice = (price: number | null, currency: string | null) => {
    if (!price) return null
    return new Intl.NumberFormat('nb-NO', {
      style: 'currency',
      currency: currency || 'NOK',
      minimumFractionDigits: 0,
    }).format(price)
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div
        className="p-4 flex items-center gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        style={{
          background: ownerColor
            ? getChildColor(ownerColor).bg
            : 'var(--background)',
        }}
      >
        {/* Avatar */}
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold flex-shrink-0"
          style={{
            background: ownerColor ? getChildColor(ownerColor).bg : 'var(--sand)',
            color: ownerColor ? getChildColor(ownerColor).text : 'var(--foreground)',
            border: ownerColor ? `2px solid ${getChildColor(ownerColor).text}` : '2px solid var(--border)',
          }}
        >
          {wishlist.owner_name?.charAt(0) || '?'}
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate" style={{ color: 'var(--foreground)' }}>
            {wishlist.owner_name}
          </h3>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <span>{wishlist.name}</span>
            {wishlist.occasion && (
              <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--sand)' }}>
                {getOccasionLabel(wishlist.occasion)}
              </span>
            )}
          </div>
        </div>

        {/* Item count */}
        <span
          className="px-2 py-1 rounded-full text-sm font-medium"
          style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
        >
          {wishlist.items.length} {wishlist.items.length === 1 ? t.wishlists.item : t.wishlists.items}
        </span>

        {/* Expand/collapse arrow */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Content */}
      {expanded && (
        <div className="p-4 pt-0">
          {/* Actions for own wishlist */}
          {isOwnWishlist && (
            <div className="flex gap-2 mt-3 mb-4">
              <button
                onClick={() => onAddItem(wishlist.id)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t.wishlists.addItem}
              </button>
              <button
                onClick={onEditWishlist}
                className="p-2 rounded-xl transition-colors hover:bg-[var(--sand)]"
                title={t.common.edit}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                onClick={onDeleteWishlist}
                className="p-2 rounded-xl transition-colors hover:bg-[rgba(232,120,109,0.1)]"
                title={t.common.delete}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          )}

          {/* Empty state */}
          {wishlist.items.length === 0 && (
            <div
              className="text-center py-8 rounded-xl"
              style={{ background: 'var(--background)' }}
            >
              <p style={{ color: 'var(--muted)' }}>{t.wishlists.noItems}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                {t.wishlists.noItemsDesc}
              </p>
            </div>
          )}

          {/* Open items */}
          {openItems.length > 0 && (
            <div className="space-y-2">
              {openItems.map((item) => (
                <WishlistItemRow
                  key={item.id}
                  item={item}
                  isOwner={isOwnWishlist}
                  currentMemberId={currentMemberId}
                  onEdit={() => onEditItem(item)}
                  onReserve={() => onReserveItem(item.id)}
                  onUnreserve={() => onUnreserveItem(item.id)}
                  onFulfill={() => onFulfillItem(item.id)}
                  onDelete={() => onDeleteItem(item.id)}
                  formatPrice={formatPrice}
                  t={t}
                />
              ))}
            </div>
          )}

          {/* Reserved items */}
          {reservedItems.length > 0 && !isOwnWishlist && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--muted)' }}>
                {t.wishlists.reserved}
              </p>
              <div className="space-y-2">
                {reservedItems.map((item) => (
                  <WishlistItemRow
                    key={item.id}
                    item={item}
                    isOwner={isOwnWishlist}
                    currentMemberId={currentMemberId}
                    onEdit={() => onEditItem(item)}
                    onReserve={() => onReserveItem(item.id)}
                    onUnreserve={() => onUnreserveItem(item.id)}
                    onFulfill={() => onFulfillItem(item.id)}
                    onDelete={() => onDeleteItem(item.id)}
                    formatPrice={formatPrice}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Fulfilled items */}
          {fulfilledItems.length > 0 && !isOwnWishlist && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--muted)' }}>
                {t.wishlists.fulfilled}
              </p>
              <div className="space-y-2 opacity-60">
                {fulfilledItems.map((item) => (
                  <WishlistItemRow
                    key={item.id}
                    item={item}
                    isOwner={isOwnWishlist}
                    currentMemberId={currentMemberId}
                    onEdit={() => onEditItem(item)}
                    onReserve={() => onReserveItem(item.id)}
                    onUnreserve={() => onUnreserveItem(item.id)}
                    onFulfill={() => onFulfillItem(item.id)}
                    onDelete={() => onDeleteItem(item.id)}
                    formatPrice={formatPrice}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface WishlistItemRowProps {
  item: WishlistItem
  isOwner: boolean
  currentMemberId: string | null
  onEdit: () => void
  onReserve: () => void
  onUnreserve: () => void
  onFulfill: () => void
  onDelete: () => void
  formatPrice: (price: number | null, currency: string | null) => string | null
  t: ReturnType<typeof useLanguage>['t']
}

function WishlistItemRow({
  item,
  isOwner,
  currentMemberId,
  onEdit,
  onReserve,
  onUnreserve,
  onFulfill,
  onDelete,
  formatPrice,
  t,
}: WishlistItemRowProps) {
  const isReservedByMe = item.reserved_by === currentMemberId
  const canUnreserve = item.status === 'reserved' && isReservedByMe
  const canFulfill = item.status === 'reserved' && isReservedByMe
  const isFulfilled = item.status === 'fulfilled'

  const priorityIcons = ['\u2606', '\u2605', '\u2605\u2605', '\u2605\u2605\u2605']

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-xl transition-colors"
      style={{
        background: 'var(--background)',
        textDecoration: isFulfilled ? 'line-through' : 'none',
      }}
    >
      {/* Priority indicator */}
      {item.priority && item.priority > 0 && (
        <span className="text-sm" style={{ color: 'var(--color-honey)' }}>
          {priorityIcons[Math.min(item.priority, 3)]}
        </span>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-medium" style={{ color: 'var(--foreground)' }}>
          {item.name}
          {item.quantity && item.quantity > 1 && (
            <span className="text-sm ml-1" style={{ color: 'var(--muted)' }}>
              x{item.quantity}
            </span>
          )}
        </p>
        {item.description && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {item.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {item.price && (
            <span
              className="text-sm px-2 py-0.5 rounded-full"
              style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
            >
              {formatPrice(item.price, item.currency)}
            </span>
          )}
          {item.link && (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm flex items-center gap-1 hover:underline"
              style={{ color: 'var(--accent)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Link
            </a>
          )}
          {item.status === 'reserved' && !isOwner && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(167, 139, 250, 0.2)', color: '#a78bfa' }}
            >
              {isReservedByMe ? t.wishlists.reservedBy.replace('{name}', 'deg') : t.wishlists.reserved}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1 flex-shrink-0">
        {/* Owner actions */}
        {isOwner && (
          <>
            <button
              onClick={onEdit}
              className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
              title={t.common.edit}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className="p-2 rounded-lg transition-colors hover:bg-[rgba(232,120,109,0.1)]"
              title={t.common.delete}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </>
        )}

        {/* Non-owner actions */}
        {!isOwner && !isFulfilled && (
          <>
            {item.status === 'open' && (
              <button
                onClick={onReserve}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                {t.wishlists.reserve}
              </button>
            )}
            {canUnreserve && (
              <button
                onClick={onUnreserve}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--sand)]"
                style={{ color: 'var(--muted)' }}
              >
                {t.wishlists.unreserve}
              </button>
            )}
            {canFulfill && (
              <button
                onClick={onFulfill}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{ background: 'var(--color-sage)', color: 'white' }}
              >
                {t.wishlists.markFulfilled}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
