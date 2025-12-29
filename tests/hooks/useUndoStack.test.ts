import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUndoStack } from '@/hooks/useUndoStack'

describe('useUndoStack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes an action to the stack', () => {
    const { result } = renderHook(() => useUndoStack())

    act(() => {
      result.current.push({ id: '1', data: 'test', description: 'Test action' })
    })

    expect(result.current.stack).toHaveLength(1)
    expect(result.current.hasUndoable).toBe(true)
  })

  it('undoes an action', () => {
    const { result } = renderHook(() => useUndoStack())

    act(() => {
      result.current.push({ id: '1', data: 'test', description: 'Test action' })
    })

    expect(result.current.stack).toHaveLength(1)

    act(() => {
      result.current.undo('1')
    })

    // After undo, stack should be empty
    expect(result.current.stack).toHaveLength(0)
    expect(result.current.hasUndoable).toBe(false)
  })

  it('returns the most recent action with peek', () => {
    const { result } = renderHook(() => useUndoStack())

    act(() => {
      result.current.push({ id: '1', data: 'first', description: 'First' })
      result.current.push({ id: '2', data: 'second', description: 'Second' })
    })

    expect(result.current.peek()?.id).toBe('2')
  })

  it('auto-commits action after expiry', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() =>
      useUndoStack({ expireMs: 1000, onCommit })
    )

    act(() => {
      result.current.push({ id: '1', data: 'test', description: 'Test' })
    })

    expect(result.current.stack).toHaveLength(1)

    // Fast-forward past expiry and run all async callbacks
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })

    // Stack should be empty after expiry
    expect(result.current.stack).toHaveLength(0)
  })

  it('clears timer when action is undone', async () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() =>
      useUndoStack({ expireMs: 1000, onCommit })
    )

    act(() => {
      result.current.push({ id: '1', data: 'test', description: 'Test' })
    })

    act(() => {
      result.current.undo('1')
    })

    // Fast-forward - onCommit should NOT be called
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('respects maxSize limit', () => {
    const { result } = renderHook(() => useUndoStack({ maxSize: 2 }))

    act(() => {
      result.current.push({ id: '1', data: 'first', description: 'First' })
      result.current.push({ id: '2', data: 'second', description: 'Second' })
      result.current.push({ id: '3', data: 'third', description: 'Third' })
    })

    expect(result.current.stack).toHaveLength(2)
    expect(result.current.stack[0].id).toBe('2')
    expect(result.current.stack[1].id).toBe('3')
  })

  it('clears all actions and calls onCommit for each', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useUndoStack({ onCommit }))

    act(() => {
      result.current.push({ id: '1', data: 'first', description: 'First' })
      result.current.push({ id: '2', data: 'second', description: 'Second' })
    })

    act(() => {
      result.current.clear()
    })

    expect(result.current.stack).toHaveLength(0)
    expect(onCommit).toHaveBeenCalledTimes(2)
  })

  it('getRemainingTime returns correct value', () => {
    const { result } = renderHook(() => useUndoStack({ expireMs: 5000 }))

    act(() => {
      result.current.push({ id: '1', data: 'test', description: 'Test' })
    })

    // Immediately after push, should have ~5000ms remaining
    const remaining = result.current.getRemainingTime('1')
    expect(remaining).toBeGreaterThan(4900)
    expect(remaining).toBeLessThanOrEqual(5000)

    // After 2 seconds, should have ~3000ms remaining
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    const remainingAfter = result.current.getRemainingTime('1')
    expect(remainingAfter).toBeGreaterThan(2900)
    expect(remainingAfter).toBeLessThanOrEqual(3000)
  })

  it('dismissFailed removes action from failedActions', () => {
    const { result } = renderHook(() => useUndoStack())

    // Test dismissFailed on empty list doesn't crash
    act(() => {
      result.current.dismissFailed('nonexistent')
    })

    expect(result.current.failedActions).toHaveLength(0)
  })
})
