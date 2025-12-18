'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistration() {
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
              // Only update if tab was hidden for more than 5 minutes
              registration.update().catch(console.error)
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
