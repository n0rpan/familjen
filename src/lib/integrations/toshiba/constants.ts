/**
 * Toshiba Home AC Control Integration Constants
 *
 * Centralized configuration values for the Toshiba AC integration.
 */

/**
 * API configuration
 */
export const TOSHIBA_API = {
  /** Base URL for Toshiba Home AC Control API */
  BASE_URL: 'https://mobileapi.toshibahomeaccontrols.com',

  /** Default request timeout in milliseconds */
  TIMEOUT_MS: 30000,

  /** Margin before token expiry to trigger refresh (1 minute) */
  TOKEN_REFRESH_MARGIN_MS: 60000,

  /** Token validity duration (24 hours - estimated, adjust based on actual behavior) */
  TOKEN_VALIDITY_MS: 24 * 60 * 60 * 1000,
} as const

/**
 * API endpoints
 */
export const TOSHIBA_ENDPOINTS = {
  LOGIN: '/api/Consumer/Login',
  REGISTER_MOBILE_DEVICE: '/api/Consumer/RegisterMobileDevice',
  GET_DEVICES: '/api/AC/GetConsumerACMapping',
  GET_STATE: '/api/AC/GetCurrentACState',
  GET_SETTINGS: '/api/AC/GetConsumerProgramSettings',
} as const

/**
 * UI configuration
 */
export const TOSHIBA_UI = {
  /** Duration to show success confirmation */
  CONFIRMATION_DURATION_MS: 2000,

  /** Duration to show toast messages */
  MESSAGE_DURATION_MS: 3000,

  /** Maximum length for custom device names */
  MAX_DEVICE_NAME_LENGTH: 100,

  /** Debounce delay for temperature slider in milliseconds */
  TEMPERATURE_DEBOUNCE_MS: 500,
} as const

/**
 * Temperature range
 */
export const TEMPERATURE = {
  MIN: 17,
  MAX: 30,
  STEP: 0.5,
  /** Default temperature when not specified */
  DEFAULT: 22,
} as const
