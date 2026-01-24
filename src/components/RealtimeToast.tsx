'use client'

import { useRealtime, type RealtimeToast as ToastData } from '@/lib/realtime/context'

interface ToastItemProps {
  toast: ToastData
  onDismiss: () => void
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const iconColor = toast.type === 'success'
    ? 'var(--color-sage)'
    : toast.type === 'error'
    ? 'var(--color-coral)'
    : toast.type === 'warning'
    ? 'var(--color-honey)'
    : 'var(--color-sky)'

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg animate-toast-in"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        maxWidth: '320px',
      }}
      role="alert"
    >
      {/* Icon based on type */}
      <div className="shrink-0">
        {toast.type === 'success' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : toast.type === 'error' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ) : toast.type === 'warning' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        )}
      </div>

      {/* Message */}
      <p className="flex-1 text-sm" style={{ color: 'var(--foreground)' }}>
        {toast.message}
      </p>

      {/* Dismiss button */}
      <button
        onClick={onDismiss}
        className="shrink-0 p-1 rounded-md transition-colors hover:bg-[var(--sand)]"
        style={{ color: 'var(--muted)' }}
        aria-label="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

export function RealtimeToastContainer() {
  const { toasts, dismissToast } = useRealtime()

  if (toasts.length === 0) {
    return null
  }

  return (
    <div
      className="fixed z-[100] flex flex-col gap-2 pointer-events-auto"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)', // Above mobile nav
        right: '16px',
        left: '16px',
      }}
    >
      <div className="flex flex-col gap-2 items-end">
        {toasts.map(toast => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => dismissToast(toast.id)}
          />
        ))}
      </div>
    </div>
  )
}
