import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getPrefetcher } from '@/lib/prefetch/registry'

/**
 * Proactively prefetch key routes on mount.
 * This makes navigation to these routes feel instant.
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

    // Delay slightly to not compete with initial page load
    const timeout = setTimeout(() => {
      routes.forEach(route => {
        router.prefetch(route)
      })
    }, 1000)

    return () => clearTimeout(timeout)
  }, [router, routes])
}

/**
 * Enhanced prefetch hook that prefetches both JS bundles AND data
 * Useful for mobile where hover prefetch doesn't work
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

// Routes to prefetch with data (most used, benefit most from data cache)
export const DATA_PREFETCH_ROUTES = [
  '/uke',
  '/handleliste',
]
