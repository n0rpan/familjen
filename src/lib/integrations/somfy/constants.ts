/**
 * Somfy Integration Constants
 *
 * Centralized configuration values for the Somfy/TaHoma integration.
 */

/**
 * API configuration
 */
export const SOMFY_API = {
  /** Default request timeout in milliseconds */
  TIMEOUT_MS: 30000,

  /** Margin before token expiry to trigger refresh (1 minute) */
  TOKEN_REFRESH_MARGIN_MS: 60000,

  /** Maximum devices per batch control request */
  MAX_BATCH_DEVICES: 50,
} as const

/**
 * UI configuration
 */
export const SOMFY_UI = {
  /** Debounce delay for slider position updates in milliseconds */
  SLIDER_DEBOUNCE_MS: 150,

  /** Duration to show success confirmation on device card */
  CONFIRMATION_DURATION_MS: 2000,

  /** Duration to show toast messages */
  MESSAGE_DURATION_MS: 3000,

  /** Maximum length for custom device names */
  MAX_DEVICE_NAME_LENGTH: 100,
} as const

/**
 * Position range for blinds/screens
 */
export const POSITION = {
  MIN: 0,
  MAX: 100,
  /** Default position when not specified */
  DEFAULT: 50,
} as const
