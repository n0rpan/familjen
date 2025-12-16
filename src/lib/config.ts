/**
 * Centralized app configuration
 * Single source of truth for constants used across the app
 */

export const APP_CONFIG = {
  // Admin email - the user with full admin access (from env or fallback)
  ADMIN_EMAIL: process.env.NEXT_PUBLIC_ADMIN_EMAIL || '',

  // App metadata
  APP_NAME: 'Familjen',

  // Feature flags
  ENABLE_AI_SUGGESTIONS: true,
} as const

// Type-safe admin check helper
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!APP_CONFIG.ADMIN_EMAIL) return false
  return email?.toLowerCase() === APP_CONFIG.ADMIN_EMAIL.toLowerCase()
}
