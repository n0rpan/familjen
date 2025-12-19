import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

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
