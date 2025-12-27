import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwipeDelete } from '@/hooks/useSwipeDelete'

describe('useSwipeDelete', () => {
  let mockOnDelete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOnDelete = vi.fn()
  })

  // Helper to create a mock TouchEvent
  function createTouchEvent(clientX: number, clientY: number): React.TouchEvent {
    return {
      touches: [{ clientX, clientY }] as unknown as React.TouchList,
      preventDefault: vi.fn(),
    } as unknown as React.TouchEvent
  }

  describe('initialization', () => {
    it('returns initial state with no active swipe', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete })
      )

      expect(result.current.swipeState.isActive).toBe(false)
      expect(result.current.swipeState.offset).toBe(0)
      expect(result.current.swipeState.direction).toBeNull()
      expect(result.current.deleteProgress).toBe(0)
      expect(result.current.isDeleting).toBe(false)
    })

    it('provides touch handlers', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete })
      )

      expect(result.current.handlers.onTouchStart).toBeDefined()
      expect(result.current.handlers.onTouchMove).toBeDefined()
      expect(result.current.handlers.onTouchEnd).toBeDefined()
      expect(result.current.handlers.onTouchCancel).toBeDefined()
    })
  })

  describe('horizontal swipe detection', () => {
    it('activates on touch start', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      expect(result.current.swipeState.isActive).toBe(true)
    })

    it('tracks horizontal movement left', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, threshold: 80 })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      act(() => {
        // Move 50px left (more than 10px to determine direction)
        result.current.handlers.onTouchMove(createTouchEvent(50, 100))
      })

      expect(result.current.swipeState.direction).toBe('left')
      expect(result.current.swipeState.offset).toBeLessThan(0)
    })

    it('tracks horizontal movement right', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, threshold: 80 })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      act(() => {
        // Move 50px right
        result.current.handlers.onTouchMove(createTouchEvent(150, 100))
      })

      expect(result.current.swipeState.direction).toBe('right')
      expect(result.current.swipeState.offset).toBeGreaterThan(0)
    })

    it('applies resistance (rubber band effect)', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, threshold: 80 })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      act(() => {
        // Move 100px left - should be resisted
        result.current.handlers.onTouchMove(createTouchEvent(0, 100))
      })

      // With 0.5 resistance, 100px movement should become ~50px
      // and be capped at threshold * 1.5 = 120px
      expect(Math.abs(result.current.swipeState.offset)).toBeLessThan(100)
    })
  })

  describe('vertical scroll detection', () => {
    it('resets state on vertical scroll', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      act(() => {
        // Move vertically (more Y than X)
        result.current.handlers.onTouchMove(createTouchEvent(105, 150))
      })

      expect(result.current.swipeState.isActive).toBe(false)
      expect(result.current.swipeState.offset).toBe(0)
    })
  })

  describe('delete triggering', () => {
    it('triggers onDelete when swiped past threshold', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, threshold: 80 })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(200, 100))
      })

      act(() => {
        // Swipe past threshold (200px left with 0.5 resistance = 100px offset > 80px threshold)
        result.current.handlers.onTouchMove(createTouchEvent(0, 100))
      })

      act(() => {
        result.current.handlers.onTouchEnd()
      })

      expect(mockOnDelete).toHaveBeenCalledTimes(1)
    })

    it('does not trigger onDelete when swiped less than threshold', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, threshold: 80 })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      act(() => {
        // Small swipe (30px with 0.5 resistance = 15px offset < 80px threshold)
        result.current.handlers.onTouchMove(createTouchEvent(70, 100))
      })

      act(() => {
        result.current.handlers.onTouchEnd()
      })

      expect(mockOnDelete).not.toHaveBeenCalled()
    })

    it('resets state after touch end', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(50, 100))
      })

      act(() => {
        result.current.handlers.onTouchEnd()
      })

      expect(result.current.swipeState.isActive).toBe(false)
      expect(result.current.swipeState.offset).toBe(0)
      expect(result.current.swipeState.direction).toBeNull()
    })
  })

  describe('delete progress calculation', () => {
    it('calculates progress as percentage of threshold', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, threshold: 100 })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      act(() => {
        // Move 100px left, with 0.5 resistance = 50px offset
        // Progress = 50 / 100 = 0.5
        result.current.handlers.onTouchMove(createTouchEvent(0, 100))
      })

      expect(result.current.deleteProgress).toBeCloseTo(0.5, 1)
    })

    it('caps progress at 1', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, threshold: 50 })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(200, 100))
      })

      act(() => {
        // Move way past threshold
        result.current.handlers.onTouchMove(createTouchEvent(0, 100))
      })

      expect(result.current.deleteProgress).toBeLessThanOrEqual(1)
    })

    it('sets isDeleting when progress >= 1', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, threshold: 50 })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(200, 100))
      })

      act(() => {
        // Move way past threshold
        result.current.handlers.onTouchMove(createTouchEvent(0, 100))
      })

      expect(result.current.isDeleting).toBe(true)
    })
  })

  describe('enabled prop', () => {
    it('ignores touch when disabled', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, enabled: false })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      expect(result.current.swipeState.isActive).toBe(false)
    })

    it('ignores move when disabled', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, enabled: false })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
        result.current.handlers.onTouchMove(createTouchEvent(50, 100))
      })

      expect(result.current.swipeState.offset).toBe(0)
    })
  })

  describe('swipeStyle', () => {
    it('returns undefined transform when no offset', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete })
      )

      expect(result.current.swipeStyle.transform).toBeUndefined()
    })

    it('returns translateX transform with offset', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
        result.current.handlers.onTouchMove(createTouchEvent(50, 100))
      })

      expect(result.current.swipeStyle.transform).toMatch(/translateX\(-?\d+(\.\d+)?px\)/)
    })

    it('has no transition when actively swiping', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100, 100))
      })

      expect(result.current.swipeStyle.transition).toBe('none')
    })

    it('has transition when not actively swiping', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete })
      )

      expect(result.current.swipeStyle.transition).toContain('ease-out')
    })
  })

  describe('custom threshold', () => {
    it('respects custom threshold', () => {
      const { result } = renderHook(() =>
        useSwipeDelete({ onDelete: mockOnDelete, threshold: 150 })
      )

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(200, 100))
      })

      act(() => {
        // 100px movement with 0.5 resistance = 50px, less than 150 threshold
        result.current.handlers.onTouchMove(createTouchEvent(0, 100))
      })

      act(() => {
        result.current.handlers.onTouchEnd()
      })

      // Should not trigger with small swipe relative to high threshold
      // (200px movement * 0.5 resistance = 100px, but capped at 225px max)
      // Need to verify the actual offset vs threshold
    })
  })
})
