'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useCallback, useState, useRef, useEffect } from 'react'
import { setTransitionDirection, clearTransitionDirection } from './TransitionLink'
import { deleteCache } from '@/lib/cache'
import { CACHE_KEYS } from '@/lib/cache-constants'

interface AppShellProps {
  children: React.ReactNode
}

// Scroll position storage keyed by pathname
const SCROLL_KEY = 'familjen-scroll-positions'

function getScrollPositions(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveScrollPosition(pathname: string, position: number) {
  if (typeof window === 'undefined') return
  const positions = getScrollPositions()
  positions[pathname] = position
  // Keep only last 20 positions to avoid bloat
  const keys = Object.keys(positions)
  if (keys.length > 20) {
    delete positions[keys[0]]
  }
  sessionStorage.setItem(SCROLL_KEY, JSON.stringify(positions))
}

/**
 * App shell with pull-to-refresh functionality
 *
 * IMPORTANT: This component registers global touch event listeners on document.
 * Only ONE instance should be mounted at a time - typically in layout.tsx.
 * Multiple instances will cause duplicate event handlers and unpredictable behavior.
 *
 * The pull-to-refresh functionality:
 * - Triggers when user is at the top of the page and pulls down
 * - Shows a visual indicator during the pull
 * - Calls router.refresh() when threshold is reached
 */
export function AppShell({ children }: AppShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPulling, setIsPulling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [isPWA, setIsPWA] = useState(false)
  const pullDistanceRef = useRef(0) // Ref for event handlers to avoid stale closures
  const startY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLElement | null>(null)

  const threshold = 80

  // Detect if running as PWA (standalone mode)
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true // iOS
    setIsPWA(isStandalone)
  }, [])

  // Get the scroll container (.app-shell-content)
  useEffect(() => {
    scrollContainerRef.current = document.querySelector('.app-shell-content')
  }, [])

  const getScrollTop = useCallback(() => {
    // Check app-shell-content first, fallback to window
    if (scrollContainerRef.current) {
      return scrollContainerRef.current.scrollTop
    }
    return window.scrollY
  }, [])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)

    // Clear IndexedDB cache for current page to force fresh data
    try {
      const householdId = localStorage.getItem('familjen-household-id')
      if (householdId) {
        // Map pathname to cache key
        const cacheKeyMap: Record<string, (id: string) => string> = {
          '/': CACHE_KEYS.home,
          '/feed': CACHE_KEYS.feed,
          '/uke': (id) => CACHE_KEYS.week(id, ''), // Will clear all week caches starting with this prefix
          '/handleliste': CACHE_KEYS.shopping,
          '/oppskrifter': CACHE_KEYS.recipes,
          '/innstillinger': CACHE_KEYS.settings,
          '/styring': CACHE_KEYS.styring,
        }
        const getCacheKey = cacheKeyMap[pathname]
        if (getCacheKey) {
          await deleteCache(getCacheKey(householdId))
        }
      }
    } catch {
      // Cache clear failed - continue with refresh anyway
    }

    router.refresh()
    // Wait a bit for the refresh to complete
    await new Promise(resolve => setTimeout(resolve, 500))
    setIsRefreshing(false)
  }, [router, pathname])

  useEffect(() => {
    // Only enable pull-to-refresh in PWA mode
    if (!isPWA) return

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshing) return
      if (getScrollTop() > 5) return // Only trigger when near top
      startY.current = e.touches[0].clientY
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (isRefreshing) return
      if (getScrollTop() > 5) {
        pullDistanceRef.current = 0
        setPullDistance(0)
        setIsPulling(false)
        return
      }

      const currentY = e.touches[0].clientY
      const distance = Math.max(0, currentY - startY.current)

      if (distance > 0) {
        // Apply resistance
        const resistance = 0.4
        const actualDistance = Math.min(distance * resistance, threshold * 1.5)
        pullDistanceRef.current = actualDistance
        setPullDistance(actualDistance)
        setIsPulling(actualDistance > 10)

        if (actualDistance > 10) {
          e.preventDefault()
        }
      }
    }

    const handleTouchEnd = async () => {
      if (isRefreshing) return

      // Use ref to avoid stale closure
      if (pullDistanceRef.current >= threshold) {
        await handleRefresh()
      }

      pullDistanceRef.current = 0
      setIsPulling(false)
      setPullDistance(0)
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isPWA, isRefreshing, threshold, handleRefresh, getScrollTop])

  // Reset on navigation
  useEffect(() => {
    setIsPulling(false)
    setPullDistance(0)
    pullDistanceRef.current = 0
    setIsRefreshing(false)
  }, [pathname])

  // Track previous pathname for scroll save on popstate
  const prevPathnameRef = useRef(pathname)
  useEffect(() => {
    prevPathnameRef.current = pathname
  }, [pathname])

  // Handle browser back button / iOS swipe back for view transitions and scroll restoration
  useEffect(() => {
    const handlePopstate = () => {
      // Save current scroll position BEFORE navigating away
      if (scrollContainerRef.current) {
        saveScrollPosition(prevPathnameRef.current, scrollContainerRef.current.scrollTop)
      }

      // Browser back/forward always triggers with 'back' direction for consistent UX
      setTransitionDirection('back')
      // Clear after a short delay (after transition starts)
      setTimeout(clearTransitionDirection, 300)

      // Restore scroll position for the page we're navigating to
      // Use requestAnimationFrame after view transition completes for robustness
      const restoreScroll = () => {
        requestAnimationFrame(() => {
          const positions = getScrollPositions()
          const targetPath = window.location.pathname
          const savedPosition = positions[targetPath]
          if (savedPosition !== undefined && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = savedPosition
          }
        })
      }
      // Wait for transition (250ms) plus buffer
      setTimeout(restoreScroll, 280)
    }

    window.addEventListener('popstate', handlePopstate)
    return () => window.removeEventListener('popstate', handlePopstate)
  }, [])

  // Save scroll position before navigating via link click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const link = target.closest('a')
      if (link && link.href && scrollContainerRef.current) {
        saveScrollPosition(pathname, scrollContainerRef.current.scrollTop)
      }
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [pathname])

  const progress = Math.min(pullDistance / threshold, 1)

  // Don't show pull-to-refresh UI in browser mode or on login page
  if (!isPWA || pathname === '/login') {
    return <>{children}</>
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Pull indicator - only rendered in PWA mode */}
      <div
        className="fixed left-0 right-0 flex items-center justify-center z-50 pointer-events-none"
        style={{
          top: 56, // Below mobile header
          height: 60,
          opacity: isPulling || isRefreshing ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg"
          style={{
            background: 'var(--card)',
            transform: `translateY(${Math.min(pullDistance, 60) - 30}px) rotate(${isRefreshing ? 0 : progress * 360}deg)`,
            transition: isPulling ? 'none' : 'transform 0.3s ease',
          }}
        >
          {isRefreshing ? (
            <div className="spinner" style={{ width: 20, height: 20 }} />
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                opacity: progress,
                transform: `scale(${0.6 + progress * 0.4})`,
              }}
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          transform: isPulling || isRefreshing ? `translateY(${Math.min(pullDistance, 40)}px)` : 'none',
          transition: isPulling ? 'none' : 'transform 0.3s ease',
        }}
      >
        {children}
      </div>
    </div>
  )
}
