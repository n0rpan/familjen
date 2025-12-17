'use client'

import { useState, useEffect, useRef } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import { getPendingCount } from '@/lib/offline-queue'

export function OfflineIndicator() {
  const { t } = useLanguage()
  const [isOffline, setIsOffline] = useState(false)
  const [showBanner, setShowBanner] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const pendingCountRef = useRef(0)

  useEffect(() => {
    // Set initial state
    if (typeof navigator !== 'undefined') {
      setIsOffline(!navigator.onLine)
      setShowBanner(!navigator.onLine)
    }

    const loadPendingCount = async () => {
      try {
        const count = await getPendingCount()
        setPendingCount(count)
        pendingCountRef.current = count
      } catch {
        // IndexedDB might not be available
      }
    }

    loadPendingCount()

    const handleOffline = () => {
      setIsOffline(true)
      setShowBanner(true)
    }

    const handleOnline = () => {
      setIsOffline(false)
      // Show "back online" briefly, then hide (unless pending changes)
      setTimeout(() => {
        if (pendingCountRef.current === 0) {
          setShowBanner(false)
        }
      }, 3000)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    // Poll pending count periodically (every 30 seconds, not 5)
    const interval = setInterval(loadPendingCount, 30000)

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      clearInterval(interval)
    }
  }, []) // Empty dependency array - only run once

  // Show banner if offline OR if there are pending changes
  const shouldShow = showBanner || pendingCount > 0

  if (!shouldShow) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium animate-fade-in"
      style={{
        background: isOffline ? 'var(--color-coral)' : pendingCount > 0 ? 'var(--color-honey)' : 'var(--color-sage)',
        color: 'white',
      }}
    >
      {isOffline ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          <span>{t.notifications?.disabled || 'Offline'}</span>
          {pendingCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs" style={{ background: 'rgba(0,0,0,0.2)' }}>
              {pendingCount} {t.common?.pending || 'pending'}
            </span>
          )}
        </>
      ) : pendingCount > 0 ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-pulse">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>{t.common?.syncing || 'Syncing'} ({pendingCount})</span>
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          {t.notifications?.enabled || 'Online'}
        </>
      )}
    </div>
  )
}
