'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useCallback, useState, useRef, useEffect } from 'react'
import { setTransitionDirection, clearTransitionDirection } from './TransitionLink'

interface AppShellProps {
  children: React.ReactNode
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
  const pullDistanceRef = useRef(0) // Ref for event handlers to avoid stale closures
  const startY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLElement | null>(null)

  const threshold = 80

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
    router.refresh()
    // Wait a bit for the refresh to complete
    await new Promise(resolve => setTimeout(resolve, 500))
    setIsRefreshing(false)
  }, [router])

  useEffect(() => {
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
  }, [isRefreshing, threshold, handleRefresh, getScrollTop])

  // Reset on navigation
  useEffect(() => {
    setIsPulling(false)
    setPullDistance(0)
    pullDistanceRef.current = 0
    setIsRefreshing(false)
  }, [pathname])

  // Handle browser back button / iOS swipe back for view transitions
  useEffect(() => {
    const handlePopstate = () => {
      // Browser back/forward always triggers with 'back' direction for consistent UX
      setTransitionDirection('back')
      // Clear after a short delay (after transition starts)
      setTimeout(clearTransitionDirection, 300)
    }

    window.addEventListener('popstate', handlePopstate)
    return () => window.removeEventListener('popstate', handlePopstate)
  }, [])

  const progress = Math.min(pullDistance / threshold, 1)

  // Don't show on login page
  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Pull indicator */}
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
