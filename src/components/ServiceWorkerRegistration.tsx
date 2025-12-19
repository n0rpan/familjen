'use client'

import { useEffect, useRef } from 'react'

// Clear navigation cache via service worker message
function clearNavCache(): void {
  const controller = navigator.serviceWorker?.controller
  if (controller) {
    controller.postMessage({ type: 'CLEAR_NAV_CACHE' })
  }
}

export function ServiceWorkerRegistration() {
  const lastVisibleRef = useRef<number>(Date.now())

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Register service worker
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[PWA] Service Worker registered:', registration.scope)

          // Check for updates periodically (every 60 minutes)
          // Don't check immediately to avoid reload loops on app start
          const checkInterval = setInterval(() => {
            registration.update().catch(console.error)
          }, 60 * 60 * 1000) // 60 minutes

          // Also check when user returns to tab after being away
          const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
              const hiddenDuration = Date.now() - lastVisibleRef.current
              const ONE_MINUTE = 60 * 1000

              // If hidden for more than 1 minute, clear nav cache
              // This ensures fresh data when user returns to the app
              if (hiddenDuration > ONE_MINUTE) {
                console.log('[PWA] App returned after', Math.round(hiddenDuration / 1000), 'seconds - clearing nav cache')
                clearNavCache()
              }

              // Check for SW updates
              registration.update().catch(console.error)

              lastVisibleRef.current = Date.now()
            } else {
              // Record when we became hidden
              lastVisibleRef.current = Date.now()
            }
          }
          document.addEventListener('visibilitychange', handleVisibilityChange)

          // Cleanup
          return () => {
            clearInterval(checkInterval)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
          }
        })
        .catch((error) => {
          console.error('[PWA] Service Worker registration failed:', error)
        })
    }
  }, [])

  return null
}
