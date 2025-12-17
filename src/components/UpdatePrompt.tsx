'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/context'

export function UpdatePrompt() {
  const { t } = useLanguage()
  const [showUpdate, setShowUpdate] = useState(false)
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    const handleUpdate = async () => {
      const registration = await navigator.serviceWorker.ready

      // Check if there's already a waiting worker
      if (registration.waiting) {
        setWaitingWorker(registration.waiting)
        setShowUpdate(true)
      }

      // Listen for new updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (!newWorker) return

        newWorker.addEventListener('statechange', () => {
          // When the new worker is installed and waiting
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setWaitingWorker(newWorker)
            setShowUpdate(true)
          }
        })
      })
    }

    handleUpdate()

    // Listen for controller change (when new SW takes over)
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })
  }, [])

  const handleUpdate = () => {
    if (!waitingWorker) return

    // Tell the waiting worker to skip waiting and activate
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    setShowUpdate(false)
  }

  const handleDismiss = () => {
    setShowUpdate(false)
  }

  if (!showUpdate) return null

  return (
    <div
      className="fixed bottom-20 lg:bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:w-80 z-50 animate-slide-up"
    >
      <div
        className="rounded-2xl p-4 shadow-lg"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium" style={{ color: 'var(--foreground)' }}>
              {t.update?.available || 'Oppdatering tilgjengelig'}
            </p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
              {t.update?.description || 'En ny versjon av Familjen er klar.'}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 rounded-lg hover:bg-[var(--sand)] transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleDismiss}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{
              background: 'var(--card-alt)',
              color: 'var(--foreground)',
            }}
          >
            {t.update?.later || 'Senere'}
          </button>
          <button
            onClick={handleUpdate}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{
              background: 'var(--color-sky)',
              color: 'white',
            }}
          >
            {t.update?.refresh || 'Oppdater nå'}
          </button>
        </div>
      </div>
    </div>
  )
}
