/**
 * Demo Mode Storage
 *
 * Persists demo state to sessionStorage for cross-page navigation.
 * State is cleared on tab close or when user exits demo.
 */

import type { DemoState } from './types'
import { DEMO_STORAGE_KEY, DEMO_STATE_VERSION } from './types'

/**
 * Save demo state to sessionStorage
 */
export function saveDemoState(state: DemoState): void {
  if (typeof window === 'undefined') return

  try {
    sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('Failed to save demo state:', error)
  }
}

/**
 * Load demo state from sessionStorage
 * Returns null if no state exists or state is invalid/outdated
 */
export function loadDemoState(): DemoState | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = sessionStorage.getItem(DEMO_STORAGE_KEY)
    if (!stored) return null

    const state = JSON.parse(stored) as DemoState

    // Validate state has required fields
    if (!state.household || !state.children || !state.members) {
      console.warn('Demo state missing required fields, clearing')
      clearDemoState()
      return null
    }

    // Check version for schema compatibility
    if (state.version !== DEMO_STATE_VERSION) {
      console.warn('Demo state version mismatch, clearing')
      clearDemoState()
      return null
    }

    return state
  } catch (error) {
    console.error('Failed to load demo state:', error)
    clearDemoState()
    return null
  }
}

/**
 * Clear demo state from sessionStorage
 */
export function clearDemoState(): void {
  if (typeof window === 'undefined') return

  try {
    sessionStorage.removeItem(DEMO_STORAGE_KEY)
  } catch (error) {
    console.error('Failed to clear demo state:', error)
  }
}

/**
 * Check if demo mode is active based on URL
 */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false

  const params = new URLSearchParams(window.location.search)
  return params.get('demo') === 'true'
}
