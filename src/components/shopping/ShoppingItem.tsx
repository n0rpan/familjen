'use client'

import { useCallback, memo } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import { useSwipeDelete } from '@/hooks/useSwipeDelete'
import type { ShoppingListItem } from '@/lib/types'

interface ShoppingItemProps {
  item: ShoppingListItem
  isBought: boolean
  isRecentlyChanged: boolean
  onToggle: (itemId: string, currentValue: boolean) => void
  onDelete: (itemId: string) => void
  isMobile: boolean
}

export const ShoppingItem = memo(function ShoppingItem({
  item,
  isBought,
  isRecentlyChanged,
  onToggle,
  onDelete,
  isMobile,
}: ShoppingItemProps) {
  const { t } = useLanguage()

  const handleDelete = useCallback(() => {
    onDelete(item.id)
  }, [onDelete, item.id])

  const handleToggle = useCallback(() => {
    onToggle(item.id, item.is_bought)
  }, [onToggle, item.id, item.is_bought])

  // Swipe-to-delete for mobile
  const { handlers, swipeStyle, deleteProgress, isDeleting } = useSwipeDelete({
    onDelete: handleDelete,
    enabled: isMobile,
    threshold: 80,
  })

  // Common accessibility label
  const accessibilityLabel = isBought
    ? t.shopping.markAsNotBought
    : t.shopping.markAsBought
  const deleteLabel = t.shopping.deleteItemLabel

  if (isBought) {
    return (
      <div
        className="relative overflow-hidden"
        {...(isMobile ? handlers : {})}
      >
        {/* Delete indicator background for swipe */}
        {isMobile && deleteProgress > 0 && (
          <div
            className="absolute inset-0 flex items-center justify-end px-4"
            style={{
              background: `rgba(232, 120, 109, ${Math.min(deleteProgress * 0.8, 0.6)})`,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              style={{
                opacity: Math.min(deleteProgress * 2, 1),
                transform: `scale(${0.8 + deleteProgress * 0.4})`,
              }}
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </div>
        )}

        {/* Item content */}
        <div
          className={`flex items-center gap-3 px-3 py-2 bg-[var(--background)] ${
            isRecentlyChanged ? 'highlight-save' : ''
          }`}
          style={{
            ...(isMobile ? swipeStyle : {}),
            touchAction: isMobile ? 'pan-y' : undefined,
          }}
        >
          <button
            onClick={handleToggle}
            className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center ${
              isRecentlyChanged ? 'just-checked' : ''
            }`}
            style={{ background: 'var(--color-sage)' }}
            aria-label={accessibilityLabel}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>

          <div className="flex-1 min-w-0">
            <span
              className="text-sm line-through"
              style={{ color: 'var(--muted)' }}
            >
              {item.name}
            </span>
            {item.quantity && (
              <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
                ({item.quantity})
              </span>
            )}
          </div>

          {/* Delete button - visible on desktop, screen-reader-only on mobile */}
          <button
            onClick={handleDelete}
            className={`p-1.5 shrink-0 rounded-lg transition-colors hover:bg-red-50 ${
              isMobile ? 'sr-only' : ''
            }`}
            style={{ color: 'var(--muted)' }}
            aria-label={deleteLabel}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  // Unbought item
  return (
    <div
      className="relative overflow-hidden"
      {...(isMobile ? handlers : {})}
    >
      {/* Delete indicator background for swipe */}
      {isMobile && deleteProgress > 0 && (
        <div
          className="absolute inset-0 flex items-center justify-end px-4"
          style={{
            background: `rgba(232, 120, 109, ${Math.min(deleteProgress * 0.8, 0.6)})`,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            style={{
              opacity: Math.min(deleteProgress * 2, 1),
              transform: `scale(${0.8 + deleteProgress * 0.4})`,
            }}
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </div>
      )}

      {/* Item content */}
      <div
        className={`flex items-center gap-3 p-3 bg-[var(--card)] ${
          isRecentlyChanged ? 'highlight-save' : ''
        }`}
        style={{
          ...(isMobile ? swipeStyle : {}),
          touchAction: isMobile ? 'pan-y' : undefined,
        }}
      >
        <button
          onClick={handleToggle}
          className="w-6 h-6 shrink-0 rounded-lg border-2 flex items-center justify-center transition-colors hover:bg-[var(--sand)]"
          style={{ borderColor: 'var(--border)' }}
          aria-label={accessibilityLabel}
        />

        <div className="flex-1 min-w-0">
          <span className="text-sm" style={{ color: 'var(--foreground)' }}>
            {item.name}
          </span>
          {item.quantity && (
            <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
              ({item.quantity})
            </span>
          )}
        </div>

        {/* Delete button - visible on desktop, screen-reader-only on mobile */}
        <button
          onClick={handleDelete}
          className={`p-1.5 shrink-0 rounded-lg transition-colors hover:bg-red-50 ${
            isMobile ? 'sr-only' : ''
          }`}
          style={{ color: 'var(--muted)' }}
          aria-label={deleteLabel}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
})
