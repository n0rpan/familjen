'use client'

import { useEffect, useRef, ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// Clear navigation cache via service worker
async function clearNavCache(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const controller = navigator.serviceWorker.controller
    if (controller) {
      return new Promise((resolve) => {
        const messageChannel = new MessageChannel()
        messageChannel.port1.onmessage = () => resolve()
        controller.postMessage(
          { type: 'CLEAR_NAV_CACHE' },
          [messageChannel.port2]
        )
        // Timeout fallback in case SW doesn't respond
        setTimeout(resolve, 500)
      })
    }
  }
}

interface HomeRefreshWrapperProps {
  children: ReactNode
}

/**
 * Wrapper component that refreshes page data when the app returns to foreground.
 * This handles the stale data issue on the home page where server-rendered content
 * could be outdated after the app was backgrounded for a while.
 */
export function HomeRefreshWrapper({ children }: HomeRefreshWrapperProps) {
  const router = useRouter()
  const lastVisibleRef = useRef<number>(Date.now())
  const isRefreshingRef = useRef(false)

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        // Only refresh if we've been hidden for more than 1 minute
        // This prevents unnecessary refreshes for quick tab switches
        const hiddenDuration = Date.now() - lastVisibleRef.current
        const ONE_MINUTE = 60 * 1000

        if (hiddenDuration > ONE_MINUTE && !isRefreshingRef.current) {
          isRefreshingRef.current = true
          console.log('[HomeRefresh] App returned to foreground after', Math.round(hiddenDuration / 1000), 'seconds - refreshing data')

          // Clear service worker nav cache first
          await clearNavCache()

          // Then refresh the page data
          router.refresh()

          // Reset the flag after a short delay
          setTimeout(() => {
            isRefreshingRef.current = false
          }, 1000)
        }

        lastVisibleRef.current = Date.now()
      } else {
        // Record when we became hidden
        lastVisibleRef.current = Date.now()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [router])

  return <>{children}</>
}
