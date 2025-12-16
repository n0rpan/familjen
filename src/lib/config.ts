/**
 * Centralized app configuration
 * Single source of truth for constants used across the app
 */

export const APP_CONFIG = {
  // App metadata
  APP_NAME: 'Familjen',

  // Feature flags
  ENABLE_AI_SUGGESTIONS: true,
} as const

/**
 * Check if user is admin via JWT app_metadata
 * This is set during login from allowed_emails.is_admin
 * Works in API routes and server components
 */
export function isUserAdmin(user: { app_metadata?: Record<string, unknown> } | null): boolean {
  return user?.app_metadata?.is_admin === true
}
