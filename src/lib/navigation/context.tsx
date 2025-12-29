'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

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

  // Start navigation - called on link click
  const startNavigation = useCallback((path: string) => {
    // Normalize path (remove query string for comparison)
    const normalizedPath = path.split('?')[0]

    // Don't show navigation state for same-page navigation
    if (normalizedPath === pathname) {
      return
    }

    startPathnameRef.current = pathname
    setState({ isNavigating: true, targetPath: normalizedPath })
  }, [pathname])

  // End navigation - called when page is ready or on error
  const endNavigation = useCallback(() => {
    startPathnameRef.current = null
    setState({ isNavigating: false, targetPath: null })
  }, [])

  // Auto-end navigation ONLY when pathname actually changes
  useEffect(() => {
    // Only end if we were navigating AND pathname changed from where we started
    if (state.isNavigating && startPathnameRef.current !== null && pathname !== startPathnameRef.current) {
      // End immediately - no artificial delay
      startPathnameRef.current = null
      setState({ isNavigating: false, targetPath: null })
    }
  }, [pathname, state.isNavigating])

  // Failsafe: end navigation after timeout if stuck
  useEffect(() => {
    if (state.isNavigating) {
      const timer = setTimeout(() => {
        startPathnameRef.current = null
        setState({ isNavigating: false, targetPath: null })
      }, 5000) // 5 second max
      return () => clearTimeout(timer)
    }
  }, [state.isNavigating])

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
