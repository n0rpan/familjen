/**
 * Centralized app configuration
 * Single source of truth for constants used across the app
 */

export const APP_CONFIG = {
  // Admin email - server-only, NOT exposed to client bundle
  // Client components should query allowed_emails.is_admin instead
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',

  // App metadata
  APP_NAME: 'Familjen',

  // Feature flags
  ENABLE_AI_SUGGESTIONS: true,
} as const

/**
 * Server-side admin check - uses ADMIN_EMAIL env var
 * Only use in: middleware, API routes, server components
 * For client components: query allowed_emails table with is_admin = true
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!APP_CONFIG.ADMIN_EMAIL) return false
  return email?.toLowerCase() === APP_CONFIG.ADMIN_EMAIL.toLowerCase()
}
