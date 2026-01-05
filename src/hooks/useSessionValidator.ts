'use client'

import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { clearAllCache } from '@/lib/cache'
import { clearAllChanges } from '@/lib/offline-queue'

/**
 * Background session validator
 *
 * This hook validates the session periodically in the background without
 * blocking navigation. It complements the fast local session reads:
 *
 * - Navigation uses getSessionLocal() (instant, no network)
 * - This hook validates with Supabase every 5 minutes
 * - If session is invalid/expired, clears caches and redirects to login
 *
 * Also validates when app becomes visible (after being backgrounded).
 */

// Validate every 5 minutes
const VALIDATION_INTERVAL_MS = 5 * 60 * 1000

// After validation failure, wait before redirecting (show any pending UI updates)
const REDIRECT_DELAY_MS = 100

export function useSessionValidator() {
  const supabaseRef = useRef(createClient())
  const lastValidationRef = useRef<number>(0)

  const handleInvalidSession = useCallback(async () => {
    console.log('[SessionValidator] Session invalid, clearing caches and redirecting')

    // Clear all local caches
    await Promise.all([
      clearAllCache(),
      clearAllChanges(),
    ]).catch(() => {})

    // Small delay to let any UI updates complete
    await new Promise(resolve => setTimeout(resolve, REDIRECT_DELAY_MS))

    // Redirect to login
    window.location.href = '/login'
  }, [])

  const validateSession = useCallback(async () => {
    try {
      const { data: { user }, error } = await supabaseRef.current.auth.getUser()

      if (error || !user) {
        await handleInvalidSession()
        return false
      }

      lastValidationRef.current = Date.now()
      return true
    } catch (err) {
      console.error('[SessionValidator] Validation error:', err)
      // Don't redirect on network errors - user might be temporarily offline
      return false
    }
  }, [handleInvalidSession])

  useEffect(() => {
    // Don't run on login page
    if (window.location.pathname === '/login') return

    // Don't run in demo mode
    if (window.location.search.includes('demo=true')) return

    // Validate on mount (delayed to not block initial render)
    const initialTimeout = setTimeout(() => {
      validateSession()
    }, 1000)

    // Periodic validation
    const interval = setInterval(() => {
      validateSession()
    }, VALIDATION_INTERVAL_MS)

    // Validate when app becomes visible (returning from background)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Only validate if it's been more than 1 minute since last validation
        const timeSinceLastValidation = Date.now() - lastValidationRef.current
        if (timeSinceLastValidation > 60 * 1000) {
          validateSession()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(initialTimeout)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [validateSession])
}
