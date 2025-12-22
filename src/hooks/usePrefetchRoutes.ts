import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getPrefetcher } from '@/lib/prefetch/registry'

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

/**
 * Enhanced prefetch hook that prefetches both JS bundles AND data
 * Useful for mobile where hover prefetch doesn't work
 * Skips prefetching on slow networks or when data saver is enabled.
 *
 * Usage (typically in home page):
 * usePrefetchRoutesWithData(['/uke', '/handleliste'])
 */
export function usePrefetchRoutesWithData(routes: string[]) {
  const router = useRouter()
  const prefetched = useRef(false)

  useEffect(() => {
    // Only prefetch once
    if (prefetched.current) return
    prefetched.current = true

    // Skip on slow networks or data saver mode
    if (shouldSkipPrefetch()) return

    const prefetchAll = async () => {
      // Delay to not compete with initial page load
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Prefetch JS bundles first (fast)
      routes.forEach(route => {
        router.prefetch(route)
      })

      // Get user's household for data prefetch
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: membership } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!membership?.household_id) return

      // Prefetch data for routes that have prefetchers
      const dataPrefetches = routes
        .map(route => getPrefetcher(route))
        .filter(Boolean)
        .map(prefetcher => prefetcher!(membership.household_id))

      // Run data prefetches in parallel (fire and forget)
      Promise.all(dataPrefetches).catch(error => {
        console.warn('[Prefetch] Data prefetch failed:', error)
      })
    }

    prefetchAll()
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
