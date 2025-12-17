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

          // Check for updates periodically
          registration.update()
        })
        .catch((error) => {
          console.error('[PWA] Service Worker registration failed:', error)
        })
    }
  }, [])

  return null
}
