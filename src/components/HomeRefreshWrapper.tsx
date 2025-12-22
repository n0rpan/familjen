'use client'

import { useEffect, useRef, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { requestRefresh } from '@/lib/refresh-coordinator'

interface HomeRefreshWrapperProps {
  children: ReactNode
}

/**
 * Wrapper component that refreshes page data when the app returns to foreground.
 * This handles the stale data issue on the home page where server-rendered content
 * could be outdated after the app was backgrounded for a while.
 *
 * Note: Nav cache clearing is handled by ServiceWorkerRegistration.
 * This component only handles React router refresh with coordination
 * to prevent double-refreshes.
 */
export function HomeRefreshWrapper({ children }: HomeRefreshWrapperProps) {
  const router = useRouter()
  const lastVisibleRef = useRef<number>(Date.now())

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Only refresh if we've been hidden for more than 1 minute
        // This prevents unnecessary refreshes for quick tab switches
        const hiddenDuration = Date.now() - lastVisibleRef.current
        const ONE_MINUTE = 60 * 1000

        if (hiddenDuration > ONE_MINUTE && requestRefresh()) {
          console.log('[HomeRefresh] App returned to foreground after', Math.round(hiddenDuration / 1000), 'seconds - refreshing data')
          router.refresh()
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
