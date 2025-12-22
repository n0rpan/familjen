/**
 * Shared refresh coordinator to prevent multiple components
 * from triggering redundant refreshes when the app returns to foreground.
 */

// Cooldown period in ms - prevents back-to-back refreshes
const REFRESH_COOLDOWN = 5000

let lastRefreshTime = 0

/**
 * Request a refresh. Returns true if refresh should proceed,
 * false if another refresh happened recently.
 */
export function requestRefresh(): boolean {
  const now = Date.now()
  if (now - lastRefreshTime < REFRESH_COOLDOWN) {
    return false
  }
  lastRefreshTime = now
  return true
}

/**
 * Mark that a refresh just occurred (for cases where
 * the caller needs to coordinate with external refresh triggers).
 */
export function markRefreshed(): void {
  lastRefreshTime = Date.now()
}
