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
 * Note: Toshiba supports 8°C mode (HEATING_8C) for temps below 17°C
 * In 8°C mode, temperatures are stored with +16 offset internally
 */
export const TEMPERATURE = {
  /** Minimum temp in normal mode */
  MIN: 17,
  /** Minimum temp in 8°C mode (for cabin heating etc) */
  MIN_8C_MODE: 5,
  MAX: 30,
  STEP: 1,
  /** Default temperature when not specified */
  DEFAULT: 22,
  /** Threshold below which 8°C mode is required */
  LOW_TEMP_THRESHOLD: 17,
} as const

/**
 * Merit A feature flags
 */
export const MERIT_A = {
  OFF: 0x00,
  HEATING_8C: 0x04,
} as const
