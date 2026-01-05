import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TransitionLink } from '@/components/TransitionLink'

// Mock next/navigation
const mockPush = vi.fn()
const mockPrefetch = vi.fn()
let mockSearchParams = new Map<string, string>()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    prefetch: mockPrefetch,
  }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key) || null,
  }),
}))

// Mock navigation context
vi.mock('@/lib/navigation', () => ({
  useNavigationOptional: () => ({
    startNavigation: vi.fn(),
  }),
}))

// Mock household hook
vi.mock('@/hooks/data/useHousehold', () => ({
  useHouseholdId: () => 'test-household-id',
}))

// Mock prefetch function
vi.mock('@/lib/prefetch/pages', () => ({
  prefetchRouteData: vi.fn(),
}))

describe('TransitionLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new Map()
    // Mock sessionStorage
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn().mockReturnValue('[]'),
      setItem: vi.fn(),
    })
  })

  describe('Demo Mode Preservation', () => {
    it('renders link without demo param when not in demo mode', () => {
      render(
        <TransitionLink href="/uke">Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      expect(link.getAttribute('href')).toBe('/uke')
    })

    it('preserves demo param in href when in demo mode', () => {
      mockSearchParams.set('demo', 'true')

      render(
        <TransitionLink href="/uke">Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      expect(link.getAttribute('href')).toBe('/uke?demo=true')
    })

    it('preserves existing query params when adding demo', () => {
      mockSearchParams.set('demo', 'true')

      render(
        <TransitionLink href="/uke?week=2">Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      // Should have both params
      const href = link.getAttribute('href')!
      expect(href).toContain('demo=true')
      expect(href).toContain('week=2')
    })

    it('does not duplicate demo param if already present', () => {
      mockSearchParams.set('demo', 'true')

      render(
        <TransitionLink href="/uke?demo=true">Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      const href = link.getAttribute('href')!
      // Count occurrences of demo=true
      const matches = href.match(/demo=true/g)
      expect(matches?.length).toBe(1)
    })

    it('does not modify external URLs', () => {
      mockSearchParams.set('demo', 'true')

      render(
        <TransitionLink href="https://example.com/page">External</TransitionLink>
      )

      const link = screen.getByRole('link')
      expect(link.getAttribute('href')).toBe('https://example.com/page')
    })

    it('navigates with demo param on click when in demo mode', () => {
      mockSearchParams.set('demo', 'true')

      render(
        <TransitionLink href="/uke">Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      fireEvent.click(link)

      expect(mockPush).toHaveBeenCalledWith('/uke?demo=true')
    })
  })

  describe('Navigation', () => {
    it('calls router.push on click for internal links', () => {
      render(
        <TransitionLink href="/settings">Settings</TransitionLink>
      )

      const link = screen.getByRole('link')
      fireEvent.click(link)

      expect(mockPush).toHaveBeenCalledWith('/settings')
    })

    it('does not navigate if onClick prevents default', () => {
      const handleClick = vi.fn((e: React.MouseEvent) => {
        e.preventDefault()
      })

      render(
        <TransitionLink href="/uke" onClick={handleClick}>Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      fireEvent.click(link)

      expect(handleClick).toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('does not navigate when clicking link to current page (same-page guard)', () => {
      // Mock window.location.pathname to be the same as href
      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation, pathname: '/uke' },
        writable: true,
      })

      render(
        <TransitionLink href="/uke">Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      fireEvent.click(link)

      // Should not navigate - same page
      expect(mockPush).not.toHaveBeenCalled()

      // Restore
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
      })
    })

    it('navigates when clicking link to different page', () => {
      // Mock window.location.pathname to be different from href
      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation, pathname: '/' },
        writable: true,
      })

      render(
        <TransitionLink href="/uke">Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      fireEvent.click(link)

      // Should navigate - different page
      expect(mockPush).toHaveBeenCalledWith('/uke')

      // Restore
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
      })
    })
  })

  describe('Prefetching', () => {
    it('prefetches route on mouse enter', () => {
      render(
        <TransitionLink href="/uke">Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      fireEvent.mouseEnter(link)

      expect(mockPrefetch).toHaveBeenCalledWith('/uke')
    })

    it('only prefetches once even with multiple hovers', () => {
      render(
        <TransitionLink href="/uke">Week</TransitionLink>
      )

      const link = screen.getByRole('link')
      fireEvent.mouseEnter(link)
      fireEvent.mouseEnter(link)
      fireEvent.mouseEnter(link)

      expect(mockPrefetch).toHaveBeenCalledTimes(1)
    })
  })
})
