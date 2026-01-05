'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

// Only show loading indicator if navigation takes longer than this
// Fast navigations (cached routes) won't show any loading state
const LOADING_DELAY_MS = 150

interface NavigationState {
  isNavigating: boolean
  targetPath: string | null
}

interface NavigationContextValue extends NavigationState {
  startNavigation: (path: string) => void
  endNavigation: () => void
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [state, setState] = useState<NavigationState>({
    isNavigating: false,
    targetPath: null,
  })

  // Track the pathname when navigation started
  const startPathnameRef = useRef<string | null>(null)
  // Timer for delayed loading indicator
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear loading timer
  const clearLoadingTimer = useCallback(() => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current)
      loadingTimerRef.current = null
    }
  }, [])

  // Start navigation - called on link click
  const startNavigation = useCallback((path: string) => {
    // Normalize path (remove query string for comparison)
    const normalizedPath = path.split('?')[0]

    // Don't show navigation state for same-page navigation
    if (normalizedPath === pathname) {
      return
    }

    // Clear any existing timer
    clearLoadingTimer()

    startPathnameRef.current = pathname

    // Delay showing loading state - fast navigations won't show any indicator
    // This makes cached route navigation feel instant
    loadingTimerRef.current = setTimeout(() => {
      setState({ isNavigating: true, targetPath: normalizedPath })
    }, LOADING_DELAY_MS)
  }, [pathname, clearLoadingTimer])

  // End navigation - called when page is ready or on error
  const endNavigation = useCallback(() => {
    clearLoadingTimer()
    startPathnameRef.current = null
    setState({ isNavigating: false, targetPath: null })
  }, [clearLoadingTimer])

  // Auto-end navigation when pathname changes (even before loading timer fires)
  useEffect(() => {
    // If pathname changed from where we started, navigation is complete
    if (startPathnameRef.current !== null && pathname !== startPathnameRef.current) {
      // Clear the loading timer - navigation completed before delay
      // This means user sees no loading indicator at all (instant navigation!)
      clearLoadingTimer()
      startPathnameRef.current = null
      setState({ isNavigating: false, targetPath: null })
    }
  }, [pathname, clearLoadingTimer])

  // Failsafe: end navigation after timeout if stuck
  useEffect(() => {
    if (state.isNavigating) {
      const timer = setTimeout(() => {
        clearLoadingTimer()
        startPathnameRef.current = null
        setState({ isNavigating: false, targetPath: null })
      }, 5000) // 5 second max
      return () => clearTimeout(timer)
    }
  }, [state.isNavigating, clearLoadingTimer])

  // Cleanup on unmount
  useEffect(() => {
    return () => clearLoadingTimer()
  }, [clearLoadingTimer])

  return (
    <NavigationContext.Provider value={{ ...state, startNavigation, endNavigation }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}

// Optional hook for components that may be outside provider
export function useNavigationOptional() {
  return useContext(NavigationContext)
}
