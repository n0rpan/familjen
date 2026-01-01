'use client'

/**
 * useAuthState Hook
 *
 * Provides access to auth state from JWT without making additional API calls.
 * This is the foundation for fast startup - all other hooks should use this
 * instead of calling supabase.auth.getUser() directly.
 *
 * Data available from JWT (no API call needed):
 * - user.id
 * - user.email
 * - user.app_metadata.is_admin
 * - user.app_metadata.household_id
 *
 * The household_id is synced to JWT during login (see auth/callback/route.ts)
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User, Session } from '@supabase/supabase-js'

export interface AuthState {
  /** Current user (null if not logged in) */
  user: User | null
  /** Current session */
  session: Session | null
  /** Whether auth state is still being determined */
  loading: boolean
  /** User's household ID from JWT (null if not in a household) */
  householdId: string | null
  /** Whether user is an admin (from JWT) */
  isAdmin: boolean
  /** User's email */
  email: string | null
}

// Singleton to share auth state across all hook instances
let globalAuthState: AuthState = {
  user: null,
  session: null,
  loading: true,
  householdId: null,
  isAdmin: false,
  email: null,
}
let globalListeners: Set<() => void> = new Set()
let isInitialized = false

function notifyListeners() {
  globalListeners.forEach(listener => listener())
}

function extractAuthState(session: Session | null): AuthState {
  const user = session?.user ?? null
  return {
    user,
    session,
    loading: false,
    householdId: user?.app_metadata?.household_id ?? null,
    isAdmin: user?.app_metadata?.is_admin === true,
    email: user?.email ?? null,
  }
}

/**
 * Hook to access auth state without making API calls
 *
 * Uses Supabase's onAuthStateChange listener which reads from local storage
 * and only makes network requests when tokens need refresh.
 */
export function useAuthState(): AuthState {
  const [, forceUpdate] = useState({})
  const supabase = useMemo(() => createClient(), [])

  // Subscribe to global auth state changes
  useEffect(() => {
    const listener = () => forceUpdate({})
    globalListeners.add(listener)
    return () => {
      globalListeners.delete(listener)
    }
  }, [])

  // Initialize auth state (only once globally)
  useEffect(() => {
    if (isInitialized) return
    isInitialized = true

    // Get initial session from local storage (fast, no network)
    supabase.auth.getSession().then(({ data: { session } }) => {
      globalAuthState = extractAuthState(session)
      notifyListeners()
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      globalAuthState = extractAuthState(session)
      notifyListeners()
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  return globalAuthState
}

/**
 * Hook to get just the household ID (most common use case)
 * Returns null while loading or if user has no household
 */
export function useHouseholdIdFromAuth(): string | null {
  const { householdId, loading } = useAuthState()
  return loading ? null : householdId
}

/**
 * Hook to check if user is logged in
 */
export function useIsAuthenticated(): boolean {
  const { user, loading } = useAuthState()
  return !loading && user !== null
}

/**
 * Hook to check if current user is admin
 */
export function useIsAdmin(): boolean {
  const { isAdmin } = useAuthState()
  return isAdmin
}
