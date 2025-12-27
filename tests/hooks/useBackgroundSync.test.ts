import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useBackgroundSync } from '@/hooks/useBackgroundSync'

// Mock the offline-queue module
vi.mock('@/lib/offline-queue', () => ({
  getPendingChanges: vi.fn(),
  removeChange: vi.fn(),
  incrementRetry: vi.fn(),
}))

// Mock the supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    })),
  })),
}))

import { getPendingChanges, removeChange, incrementRetry } from '@/lib/offline-queue'

describe('useBackgroundSync', () => {
  let originalNavigator: typeof navigator
  let mockBatteryManager: { level: number; charging: boolean }

  beforeEach(() => {
    vi.clearAllMocks()

    // Save original navigator
    originalNavigator = global.navigator

    // Default: online
    Object.defineProperty(global, 'navigator', {
      value: {
        ...originalNavigator,
        onLine: true,
        getBattery: undefined,
      },
      writable: true,
      configurable: true,
    })

    // Mock document.visibilityState
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    })

    // Default: no pending changes
    vi.mocked(getPendingChanges).mockResolvedValue([])
  })

  afterEach(() => {
    // Restore original navigator
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  it('processes queue on mount when online', async () => {
    vi.mocked(getPendingChanges).mockResolvedValue([])

    renderHook(() => useBackgroundSync())

    await waitFor(() => {
      expect(getPendingChanges).toHaveBeenCalled()
    })
  })

  it('does not process queue when offline', async () => {
    Object.defineProperty(global.navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    })

    renderHook(() => useBackgroundSync())

    // Give it time to potentially call
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(getPendingChanges).not.toHaveBeenCalled()
  })

  it('processes queue when going online', async () => {
    Object.defineProperty(global.navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    })

    vi.mocked(getPendingChanges).mockResolvedValue([])

    renderHook(() => useBackgroundSync())

    // Simulate going online
    Object.defineProperty(global.navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    })

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => {
      expect(getPendingChanges).toHaveBeenCalled()
    })
  })

  it('removes change after successful sync', async () => {
    const mockChange = {
      id: 'change-1',
      table: 'pickups',
      operation: 'insert' as const,
      data: { id: '123', date: '2024-12-25' },
      retries: 0,
      timestamp: Date.now(),
    }

    vi.mocked(getPendingChanges).mockResolvedValue([mockChange])
    vi.mocked(removeChange).mockResolvedValue(undefined)

    renderHook(() => useBackgroundSync())

    await waitFor(() => {
      expect(removeChange).toHaveBeenCalledWith('change-1')
    })
  })

  it('increments retry count on failure', async () => {
    const mockChange = {
      id: 'change-1',
      table: 'pickups',
      operation: 'insert' as const,
      data: { id: '123' },
      retries: 0,
      timestamp: Date.now(),
    }

    vi.mocked(getPendingChanges).mockResolvedValue([mockChange])

    // Mock supabase to return an error
    const { createClient } = await import('@/lib/supabase/client')
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({ error: new Error('Network error') }),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: new Error('Network error') }),
        })),
        upsert: vi.fn().mockResolvedValue({ error: new Error('Network error') }),
        delete: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: new Error('Network error') }),
        })),
      })),
    } as any)

    renderHook(() => useBackgroundSync())

    await waitFor(() => {
      expect(incrementRetry).toHaveBeenCalledWith('change-1')
    })
  })

  it('removes change after max retries', async () => {
    const mockChange = {
      id: 'change-1',
      table: 'pickups',
      operation: 'insert' as const,
      data: { id: '123' },
      retries: 3, // At max retries
      timestamp: Date.now(),
    }

    vi.mocked(getPendingChanges).mockResolvedValue([mockChange])

    // Mock supabase to return an error
    const { createClient } = await import('@/lib/supabase/client')
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({ error: new Error('Persistent error') }),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
        upsert: vi.fn().mockResolvedValue({ error: null }),
        delete: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    } as any)

    renderHook(() => useBackgroundSync())

    await waitFor(() => {
      // Should remove after max retries, not increment
      expect(removeChange).toHaveBeenCalledWith('change-1')
      expect(incrementRetry).not.toHaveBeenCalled()
    })
  })

  describe('battery awareness', () => {
    it('pauses sync when battery is low and not charging', async () => {
      mockBatteryManager = { level: 0.10, charging: false } // 10% battery, not charging

      Object.defineProperty(global.navigator, 'getBattery', {
        value: () => Promise.resolve(mockBatteryManager),
        writable: true,
        configurable: true,
      })

      vi.mocked(getPendingChanges).mockResolvedValue([
        {
          id: 'change-1',
          table: 'pickups',
          operation: 'insert' as const,
          data: { id: '123' },
          retries: 0,
          timestamp: Date.now(),
        },
      ])

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      renderHook(() => useBackgroundSync())

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('battery low')
        )
      })

      // Should not process the queue when battery is low
      expect(removeChange).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('continues sync when battery is low but charging', async () => {
      mockBatteryManager = { level: 0.10, charging: true } // 10% battery, but charging

      Object.defineProperty(global.navigator, 'getBattery', {
        value: () => Promise.resolve(mockBatteryManager),
        writable: true,
        configurable: true,
      })

      // Reset supabase mock to return success
      const { createClient } = await import('@/lib/supabase/client')
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn(() => ({
          insert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        })),
      } as any)

      const mockChange = {
        id: 'change-1',
        table: 'pickups',
        operation: 'insert' as const,
        data: { id: '123', date: '2024-12-25' },
        retries: 0,
        timestamp: Date.now(),
      }

      vi.mocked(getPendingChanges).mockResolvedValue([mockChange])

      renderHook(() => useBackgroundSync())

      await waitFor(() => {
        expect(removeChange).toHaveBeenCalledWith('change-1')
      })
    })

    it('continues sync when battery is above threshold', async () => {
      mockBatteryManager = { level: 0.50, charging: false } // 50% battery

      // Reset supabase mock to return success
      const { createClient } = await import('@/lib/supabase/client')
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn(() => ({
          insert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        })),
      } as any)

      Object.defineProperty(global.navigator, 'getBattery', {
        value: () => Promise.resolve(mockBatteryManager),
        writable: true,
        configurable: true,
      })

      const mockChange = {
        id: 'change-1',
        table: 'pickups',
        operation: 'insert' as const,
        data: { id: '123', date: '2024-12-25' },
        retries: 0,
        timestamp: Date.now(),
      }

      vi.mocked(getPendingChanges).mockResolvedValue([mockChange])

      renderHook(() => useBackgroundSync())

      await waitFor(() => {
        expect(removeChange).toHaveBeenCalledWith('change-1')
      })
    })
  })
})
