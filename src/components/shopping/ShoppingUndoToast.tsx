'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import type { UndoableAction } from '@/hooks/useUndoStack'
import type { ShoppingListItem } from '@/lib/types'

interface ShoppingUndoToastProps {
  action: UndoableAction<ShoppingListItem> | undefined
  onUndo: (actionId: string) => void
  expireMs?: number
  /** Failed actions that need retry */
  failedActions?: UndoableAction<ShoppingListItem>[]
  /** Callback when user dismisses a failed action */
  onDismissFailed?: (actionId: string) => void
}

export function ShoppingUndoToast({
  action,
  onUndo,
  expireMs = 5000,
  failedActions = [],
  onDismissFailed,
}: ShoppingUndoToastProps) {
  const { t } = useLanguage()
  const [remainingTime, setRemainingTime] = useState(expireMs)

  // Update countdown
  useEffect(() => {
    if (!action) {
      setRemainingTime(expireMs)
      return
    }

    const elapsed = Date.now() - action.timestamp
    setRemainingTime(Math.max(0, expireMs - elapsed))

    const interval = setInterval(() => {
      const newElapsed = Date.now() - action.timestamp
      const newRemaining = Math.max(0, expireMs - newElapsed)
      setRemainingTime(newRemaining)

      if (newRemaining <= 0) {
        clearInterval(interval)
      }
    }, 100)

    return () => clearInterval(interval)
  }, [action, expireMs])

  // Show failed action toast if there are any
  const failedAction = failedActions[0]

  if (!action && !failedAction) {
    return null
  }

  const progress = remainingTime / expireMs

  // Show failed action toast
  if (failedAction) {
    return (
      <div
        className="fixed z-[100] pointer-events-auto animate-toast-in"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
          left: '16px',
          right: '16px',
        }}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg mx-auto"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--color-coral)',
            maxWidth: '360px',
          }}
          role="alert"
          aria-live="assertive"
        >
          {/* Error icon */}
          <div className="shrink-0 animate-pulse">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-coral)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          {/* Message */}
          <p className="flex-1 text-sm" style={{ color: 'var(--foreground)' }}>
            <span className="font-medium">{failedAction.data.name}</span>
            {' '}{t.shopping.deleteFailedRetrying ?? 'kunne ikke slettes, prøver igjen...'}
          </p>

          {/* Dismiss button */}
          {onDismissFailed && (
            <button
              onClick={() => onDismissFailed(failedAction.id)}
              className="shrink-0 p-1.5 rounded-lg transition-colors hover:bg-[var(--sand)]"
              style={{ color: 'var(--muted)' }}
              aria-label={t.common.dismiss}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!action) {
    return null
  }

  return (
    <div
      className="fixed z-[100] pointer-events-auto animate-toast-in"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        left: '16px',
        right: '16px',
      }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg mx-auto"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          maxWidth: '360px',
        }}
        role="alert"
        aria-live="polite"
      >
        {/* Trash icon */}
        <div className="shrink-0">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-coral)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </div>

        {/* Message */}
        <p className="flex-1 text-sm truncate" style={{ color: 'var(--foreground)' }}>
          {t.shopping.itemRemoved ?? 'Fjernet'}: <span className="font-medium">{action.data.name}</span>
        </p>

        {/* Undo button with progress indicator */}
        <button
          onClick={() => onUndo(action.id)}
          className="shrink-0 relative px-3 py-1.5 rounded-lg font-medium text-sm transition-colors overflow-hidden"
          style={{
            background: 'var(--foreground)',
            color: 'var(--background)',
          }}
        >
          {/* Progress bar background */}
          <div
            className="absolute inset-0 transition-transform origin-left"
            style={{
              background: 'rgba(255,255,255,0.2)',
              transform: `scaleX(${progress})`,
            }}
          />
          <span className="relative">{t.shopping.undo ?? 'Angre'}</span>
        </button>
      </div>
    </div>
  )
}
