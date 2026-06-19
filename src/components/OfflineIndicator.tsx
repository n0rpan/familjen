'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import { getPendingCount } from '@/lib/offline-queue'
import { SYNC_EVENTS, type SyncFailureDetail, type SyncConflictDetail } from '@/hooks/useBackgroundSync'

export function OfflineIndicator() {
  const { t } = useLanguage()
  const [isOffline, setIsOffline] = useState(false)
  const [showBanner, setShowBanner] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncFailure, setSyncFailure] = useState<SyncFailureDetail | null>(null)
  const [syncConflict, setSyncConflict] = useState<SyncConflictDetail | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const pendingCountRef = useRef(0)
  const failureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const conflictTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const bannerRef = useRef<HTMLDivElement | null>(null)

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
      } catch (error) {
        // IndexedDB might not be available (e.g., private browsing mode)
        console.warn('[OfflineIndicator] Failed to load pending count from IndexedDB:', error)
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

    // Listen for sync events
    const handleSyncStart = () => {
      setIsSyncing(true)
      setShowBanner(true)
    }

    const handleSyncComplete = () => {
      setIsSyncing(false)
      loadPendingCount()
      // Hide banner after sync if no pending and online
      setTimeout(() => {
        if (pendingCountRef.current === 0 && navigator.onLine) {
          setShowBanner(false)
        }
      }, 2000)
    }

    const handleSyncFailure = (event: Event) => {
      const detail = (event as CustomEvent<SyncFailureDetail>).detail
      setSyncFailure(detail)
      setShowBanner(true)
      loadPendingCount()

      // Clear previous timeout
      if (failureTimeoutRef.current) {
        clearTimeout(failureTimeoutRef.current)
      }

      // Auto-hide failure after 8 seconds (or 15 if dropped after retries)
      failureTimeoutRef.current = setTimeout(() => {
        setSyncFailure(null)
      }, detail.droppedAfterRetries ? 15000 : 8000)
    }

    const handleSyncConflict = (event: Event) => {
      const detail = (event as CustomEvent<SyncConflictDetail>).detail
      setSyncConflict(detail)
      setShowBanner(true)

      // Clear previous timeout
      if (conflictTimeoutRef.current) {
        clearTimeout(conflictTimeoutRef.current)
      }

      // Auto-hide conflict notification after 6 seconds
      conflictTimeoutRef.current = setTimeout(() => {
        setSyncConflict(null)
      }, 6000)
    }

    window.addEventListener(SYNC_EVENTS.SYNC_START, handleSyncStart)
    window.addEventListener(SYNC_EVENTS.SYNC_COMPLETE, handleSyncComplete)
    window.addEventListener(SYNC_EVENTS.SYNC_FAILURE, handleSyncFailure)
    window.addEventListener(SYNC_EVENTS.SYNC_CONFLICT, handleSyncConflict)

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener(SYNC_EVENTS.SYNC_START, handleSyncStart)
      window.removeEventListener(SYNC_EVENTS.SYNC_COMPLETE, handleSyncComplete)
      window.removeEventListener(SYNC_EVENTS.SYNC_FAILURE, handleSyncFailure)
      window.removeEventListener(SYNC_EVENTS.SYNC_CONFLICT, handleSyncConflict)
      clearInterval(interval)
      if (failureTimeoutRef.current) {
        clearTimeout(failureTimeoutRef.current)
      }
      if (conflictTimeoutRef.current) {
        clearTimeout(conflictTimeoutRef.current)
      }
    }
  }, []) // Empty dependency array - only run once

  // Show banner if offline OR if there are pending changes OR sync failure OR conflict
  const shouldShow = showBanner || pendingCount > 0 || syncFailure || syncConflict

  // Dismiss sync failure or conflict on click
  const dismissNotification = useCallback(() => {
    setSyncFailure(null)
    setSyncConflict(null)
    if (failureTimeoutRef.current) {
      clearTimeout(failureTimeoutRef.current)
    }
    if (conflictTimeoutRef.current) {
      clearTimeout(conflictTimeoutRef.current)
    }
  }, [])

  // Push the header + page content down by the banner's measured height so the
  // banner never paints on top of the header (it previously rendered fixed at
  // top-0 directly over the fixed/sticky header, hiding the logo + nav). Measured
  // (not hardcoded) so it stays correct if the message wraps on small screens.
  useEffect(() => {
    const root = document.documentElement
    if (!shouldShow) {
      root.style.setProperty('--offline-banner-h', '0px')
      return
    }
    const el = bannerRef.current
    if (!el) return
    const apply = () => root.style.setProperty('--offline-banner-h', `${el.offsetHeight}px`)
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.setProperty('--offline-banner-h', '0px')
    }
  }, [shouldShow, syncFailure, syncConflict, isOffline, pendingCount, isSyncing])

  if (!shouldShow) return null

  // Priority: failure (coral) > conflict (honey) > offline (sky) > syncing (honey) > online (sage)
  const getBackgroundColor = () => {
    if (syncFailure) return 'var(--color-coral)'
    if (syncConflict) return 'var(--color-honey)'
    if (isOffline) return 'var(--color-sky)'
    if (pendingCount > 0 || isSyncing) return 'var(--color-honey)'
    return 'var(--color-sage)'
  }

  const hasDismissable = syncFailure || syncConflict

  return (
    <div
      ref={bannerRef}
      className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium animate-fade-in safe-area-top"
      style={{
        background: getBackgroundColor(),
        color: 'white',
      }}
      onClick={hasDismissable ? dismissNotification : undefined}
      role={hasDismissable ? 'button' : undefined}
    >
      {syncFailure ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            {syncFailure.droppedAfterRetries
              ? (t.errors?.syncDropped || 'Endringen kunne ikke lagres')
              : (t.errors?.syncFailed || 'Synkronisering feilet, prøver igjen...')}
          </span>
          <button
            className="ml-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-white/20 active:bg-white/30 transition-colors"
            onClick={dismissNotification}
            aria-label="Lukk"
          >
            ✕
          </button>
        </>
      ) : syncConflict ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{t.errors?.syncConflict || 'Endringer fra en annen enhet ble overskrevet'}</span>
          <button
            className="ml-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-white/20 active:bg-white/30 transition-colors"
            onClick={dismissNotification}
            aria-label="Lukk"
          >
            ✕
          </button>
        </>
      ) : isOffline ? (
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
          <span>{t.common?.offline || 'Offline'}</span>
          {pendingCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs" style={{ background: 'rgba(0,0,0,0.2)' }}>
              {pendingCount} {t.common?.pending || 'venter'}
            </span>
          )}
        </>
      ) : pendingCount > 0 || isSyncing ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>{t.common?.syncing || 'Synkroniserer'}{pendingCount > 0 ? ` (${pendingCount})` : '...'}</span>
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          <span>{t.common?.backOnline || 'Tilkoblet igjen'}</span>
        </>
      )}
    </div>
  )
}
