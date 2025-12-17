'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>
  threshold?: number // Pull distance to trigger refresh (default: 80)
  disabled?: boolean
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  disabled = false,
}: UsePullToRefreshOptions) {
  const [isPulling, setIsPulling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const startY = useRef(0)
  const currentY = useRef(0)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return
    if (window.scrollY > 0) return // Only trigger when at top

    startY.current = e.touches[0].clientY
    currentY.current = startY.current
  }, [disabled, isRefreshing])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return
    if (window.scrollY > 0) return

    currentY.current = e.touches[0].clientY
    const distance = Math.max(0, currentY.current - startY.current)

    if (distance > 0) {
      // Apply resistance for a more natural feel
      const resistance = 0.5
      const actualDistance = Math.min(distance * resistance, threshold * 1.5)
      setPullDistance(actualDistance)
      setIsPulling(actualDistance > 10)

      if (actualDistance > 10) {
        e.preventDefault()
      }
    }
  }, [disabled, isRefreshing, threshold])

  const handleTouchEnd = useCallback(async () => {
    if (disabled || isRefreshing) return

    if (pullDistance >= threshold) {
      setIsRefreshing(true)
      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
      }
    }

    setIsPulling(false)
    setPullDistance(0)
  }, [disabled, isRefreshing, pullDistance, threshold, onRefresh])

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  return {
    isPulling,
    isRefreshing,
    pullDistance,
    progress: Math.min(pullDistance / threshold, 1),
  }
}
