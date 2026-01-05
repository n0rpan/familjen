'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState, useMemo, type ComponentProps, type MouseEvent } from 'react'
import { useNavigationOptional } from '@/lib/navigation'
import { prefetchRouteData } from '@/lib/prefetch/pages'
import { useHouseholdId } from '@/hooks/data/useHousehold'

type TransitionLinkProps = ComponentProps<typeof Link> & {
  viewTransition?: boolean
}

// Check if View Transitions API is supported
const supportsViewTransitions = typeof document !== 'undefined' && 'startViewTransition' in document

// Navigation history helpers
const NAV_STACK_KEY = 'familjen-nav-stack'
const MAX_STACK_SIZE = 20

function getNavStack(): string[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    return JSON.parse(sessionStorage.getItem(NAV_STACK_KEY) || '[]')
  } catch {
    return []
  }
}

function pushToNavStack(path: string): void {
  if (typeof sessionStorage === 'undefined') return
  const stack = getNavStack()
  // Remove if already exists (we're revisiting)
  const existingIndex = stack.lastIndexOf(path)
  if (existingIndex !== -1) {
    stack.splice(existingIndex)
  }
  stack.push(path)
  // Keep stack bounded
  while (stack.length > MAX_STACK_SIZE) {
    stack.shift()
  }
  sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(stack))
}

function isBackNavigation(targetPath: string): boolean {
  const stack = getNavStack()
  if (stack.length < 2) return false
  // If the target is the previous page in our stack, it's a back navigation
  const currentIndex = stack.length - 1
  const targetIndex = stack.lastIndexOf(targetPath)
  return targetIndex !== -1 && targetIndex < currentIndex
}

function setTransitionDirection(direction: 'forward' | 'back'): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.transitionDirection = direction
  }
}

function clearTransitionDirection(): void {
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.transitionDirection
  }
}

export function TransitionLink({
  href,
  children,
  viewTransition = true,
  onClick,
  onMouseEnter,
  ...props
}: TransitionLinkProps) {
  const router = useRouter()
  const navigation = useNavigationOptional()
  const searchParams = useSearchParams()
  const isDemo = searchParams.get('demo') === 'true'
  const householdId = useHouseholdId()
  const [prefetched, setPrefetched] = useState(false)

  // Prefetch on hover for faster navigation
  const handleMouseEnter = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      if (!prefetched && typeof href === 'string') {
        // Prefetch route (Next.js built-in)
        router.prefetch(href)

        // Prefetch data for the route (our IndexedDB cache)
        // Skip in demo mode - demo uses mock data
        if (!isDemo) {
          prefetchRouteData(href, householdId)
        }

        setPrefetched(true)
      }
      onMouseEnter?.(e)
    },
    [router, href, prefetched, onMouseEnter, isDemo, householdId]
  )

  // Compute final href with demo param preserved
  const finalHref = useMemo(() => {
    if (!isDemo || typeof href !== 'string' || href.startsWith('http')) {
      return href
    }
    // Preserve demo mode across navigation
    const url = new URL(href, 'http://localhost')
    if (!url.searchParams.has('demo')) {
      url.searchParams.set('demo', 'true')
    }
    return url.pathname + url.search
  }, [href, isDemo])

  // Handle click with view transition
  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      // Let the default onClick run first
      onClick?.(e)

      // If default was prevented, skip
      if (e.defaultPrevented) {
        return
      }

      // Only handle internal navigation
      if (typeof finalHref !== 'string' || finalHref.startsWith('http')) {
        return
      }

      // Normalize paths (remove query string for comparison)
      const targetPath = finalHref.split('?')[0]
      // Read pathname at click time, not render time, to avoid stale closure issues
      const currentPath = (typeof window !== 'undefined' ? window.location.pathname : '').split('?')[0]

      // Same page? Do nothing - don't dim, don't navigate
      if (targetPath === currentPath) {
        e.preventDefault()
        return
      }

      e.preventDefault()

      // Determine navigation direction
      const isBack = isBackNavigation(targetPath)
      setTransitionDirection(isBack ? 'back' : 'forward')

      // Signal navigation for React-based tracking (handles delayed loading state)
      navigation?.startNavigation(targetPath)

      // Navigate directly - no view transitions (they cause flash/lag)
      router.push(finalHref)
      pushToNavStack(targetPath)
      clearTransitionDirection()
    },
    [router, finalHref, onClick, navigation]
  )

  return (
    <Link
      href={finalHref}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      {...props}
    >
      {children}
    </Link>
  )
}

// Export for use in AppShell popstate handler
export { setTransitionDirection, clearTransitionDirection }
