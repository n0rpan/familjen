import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

// Check if we should skip prefetching (slow network or data saver)
function shouldSkipPrefetch(): boolean {
  if (typeof navigator === 'undefined') return false

  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection

  if (!connection) return false

  // Skip if data saver is enabled
  if (connection.saveData) return true

  // Skip on very slow connections (2G or slower)
  if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') return true

  return false
}

/**
 * Proactively prefetch key routes on mount.
 * This makes navigation to these routes feel instant.
 * Skips prefetching on slow networks or when data saver is enabled.
 *
 * Usage:
 * usePrefetchRoutes(['/uke', '/handleliste', '/feed'])
 */
export function usePrefetchRoutes(routes: string[]) {
  const router = useRouter()
  const prefetched = useRef(false)

  useEffect(() => {
    // Only prefetch once
    if (prefetched.current) return
    prefetched.current = true

    // Skip on slow networks or data saver mode
    if (shouldSkipPrefetch()) return

    // Use requestIdleCallback if available, otherwise setTimeout
    const scheduleCallback = typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 1000)

    const cancelCallback = typeof cancelIdleCallback !== 'undefined'
      ? cancelIdleCallback
      : clearTimeout

    const handle = scheduleCallback(() => {
      routes.forEach(route => {
        router.prefetch(route)
      })
    })

    return () => cancelCallback(handle as number)
  }, [router, routes])
}

// Primary routes - prefetched first for instant navigation
export const KEY_ROUTES = [
  '/',            // Home (hjemme)
  '/uke',         // Week planner
  '/feed',        // Activity feed
  '/handleliste', // Shopping list
]

// Secondary routes - prefetched after primary
export const SECONDARY_ROUTES = [
  '/oppskrifter',
  '/innstillinger',
]
