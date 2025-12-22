'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
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

  // Start navigation - called on link click
  const startNavigation = useCallback((path: string) => {
    // Normalize path (remove query string for comparison)
    const normalizedPath = path.split('?')[0]

    // Don't show navigation state for same-page navigation
    if (normalizedPath === pathname) {
      return
    }

    setState({ isNavigating: true, targetPath: normalizedPath })
  }, [pathname])

  // End navigation - called when page is ready or on error
  const endNavigation = useCallback(() => {
    setState({ isNavigating: false, targetPath: null })
  }, [])

  // Auto-end navigation when pathname changes (page loaded)
  useEffect(() => {
    if (state.isNavigating) {
      // Small delay to allow content to render before removing skeleton
      const timer = setTimeout(() => {
        setState({ isNavigating: false, targetPath: null })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [pathname, state.isNavigating])

  // Failsafe: end navigation after timeout if stuck
  useEffect(() => {
    if (state.isNavigating) {
      const timer = setTimeout(() => {
        setState({ isNavigating: false, targetPath: null })
      }, 3000) // 3 second max
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
