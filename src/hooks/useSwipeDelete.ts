'use client'

import { useRef, useCallback, useState } from 'react'

interface UseSwipeDeleteOptions {
  /** Minimum swipe distance to trigger delete (default: 80px) */
  threshold?: number
  /** Callback when swipe delete is triggered */
  onDelete: () => void
  /** Whether swipe is enabled (default: true) */
  enabled?: boolean
}

interface SwipeState {
  isActive: boolean
  offset: number
  direction: 'left' | 'right' | null
}

export function useSwipeDelete(options: UseSwipeDeleteOptions) {
  const { threshold = 80, onDelete, enabled = true } = options

  const [swipeState, setSwipeState] = useState<SwipeState>({
    isActive: false,
    offset: 0,
    direction: null,
  })

  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  const isHorizontalSwipe = useRef<boolean | null>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    isHorizontalSwipe.current = null
    setSwipeState({ isActive: true, offset: 0, direction: null })
  }, [enabled])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled || startX.current === null || startY.current === null) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - startX.current
    const deltaY = touch.clientY - startY.current

    // Determine if this is a horizontal or vertical swipe on first significant movement
    if (isHorizontalSwipe.current === null) {
      const absDeltaX = Math.abs(deltaX)
      const absDeltaY = Math.abs(deltaY)

      // Need at least 10px movement to determine direction
      if (absDeltaX > 10 || absDeltaY > 10) {
        isHorizontalSwipe.current = absDeltaX > absDeltaY
      }
    }

    // Only process horizontal swipes
    if (isHorizontalSwipe.current === false) {
      // It's a vertical scroll, reset and let the page scroll
      setSwipeState({ isActive: false, offset: 0, direction: null })
      return
    }

    if (isHorizontalSwipe.current === true) {
      // Prevent vertical scrolling while swiping horizontally
      e.preventDefault()

      // Apply resistance at the edges (rubber band effect)
      const resistance = 0.5
      const resistedOffset = deltaX < 0
        ? Math.max(deltaX * resistance, -threshold * 1.5)
        : Math.min(deltaX * resistance, threshold * 1.5)

      setSwipeState({
        isActive: true,
        offset: resistedOffset,
        direction: deltaX < 0 ? 'left' : 'right',
      })
    }
  }, [enabled, threshold])

  const handleTouchEnd = useCallback(() => {
    if (!enabled) return

    const { offset } = swipeState

    // If swiped past threshold, trigger delete
    if (Math.abs(offset) > threshold) {
      onDelete()
    }

    // Reset state
    setSwipeState({ isActive: false, offset: 0, direction: null })
    startX.current = null
    startY.current = null
    isHorizontalSwipe.current = null
  }, [enabled, swipeState, threshold, onDelete])

  const handlers = {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchEnd,
  }

  // Calculate styles for the swiped element
  const swipeStyle: React.CSSProperties = {
    transform: swipeState.offset !== 0 ? `translateX(${swipeState.offset}px)` : undefined,
    transition: swipeState.isActive ? 'none' : 'transform 0.2s ease-out',
  }

  // Background indicator styles (show delete icon behind)
  const deleteProgress = Math.min(Math.abs(swipeState.offset) / threshold, 1)

  return {
    handlers,
    swipeStyle,
    swipeState,
    deleteProgress,
    isDeleting: deleteProgress >= 1,
  }
}
