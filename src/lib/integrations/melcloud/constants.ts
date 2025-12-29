/**
 * Mitsubishi MELCloud Integration Constants
 *
 * Centralized configuration values for the MELCloud integration.
 */

/**
 * API configuration
 */
export const MELCLOUD_API = {
  /** Base URL for MELCloud API */
  BASE_URL: 'https://app.melcloud.com/Mitsubishi.Wifi.Client',

  /** Default request timeout in milliseconds */
  TIMEOUT_MS: 30000,

  /** Margin before token expiry to trigger refresh (1 minute) */
  TOKEN_REFRESH_MARGIN_MS: 60000,

  /** Token validity duration (14 days - based on MELCloud session duration) */
  TOKEN_VALIDITY_MS: 14 * 24 * 60 * 60 * 1000,

  /** App version to send with requests */
  APP_VERSION: '1.32.1.0',

  /** Default language code (English) */
  DEFAULT_LANGUAGE: 0,
} as const

/**
 * API endpoints
 */
export const MELCLOUD_ENDPOINTS = {
  LOGIN: '/Login/ClientLogin',
  LIST_DEVICES: '/User/ListDevices',
  GET_DEVICE: '/Device/Get',
  SET_ATA: '/Device/SetAta',
  SET_ATW: '/Device/SetAtw',
  SET_ERV: '/Device/SetErv',
} as const

/**
 * Operation mode mappings (API value -> our type)
 */
export const OPERATION_MODE_MAP: Record<number, 'HEAT' | 'DRY' | 'COOL' | 'FAN' | 'AUTO'> = {
  1: 'HEAT',
  2: 'DRY',
  3: 'COOL',
  7: 'FAN',
  8: 'AUTO',
}

/**
 * Reverse operation mode mappings (our type -> API value)
 */
export const OPERATION_MODE_ENCODE: Record<string, number> = {
  'HEAT': 1,
  'DRY': 2,
  'COOL': 3,
  'FAN': 7,
  'AUTO': 8,
}

/**
 * Fan speed mappings (API value -> our type)
 * 0 = Auto, 1-5 = Speed levels
 */
export const FAN_SPEED_MAP: Record<number, 'AUTO' | 'SPEED_1' | 'SPEED_2' | 'SPEED_3' | 'SPEED_4' | 'SPEED_5'> = {
  0: 'AUTO',
  1: 'SPEED_1',
  2: 'SPEED_2',
  3: 'SPEED_3',
  4: 'SPEED_4',
  5: 'SPEED_5',
}

/**
 * Reverse fan speed mappings (our type -> API value)
 */
export const FAN_SPEED_ENCODE: Record<string, number> = {
  'AUTO': 0,
  'SPEED_1': 1,
  'SPEED_2': 2,
  'SPEED_3': 3,
  'SPEED_4': 4,
  'SPEED_5': 5,
}

/**
 * Vertical vane position mappings (API value -> our type)
 * 0 = Auto, 1-5 = Positions, 7 = Swing
 */
export const VANE_VERTICAL_MAP: Record<number, 'AUTO' | 'POSITION_1' | 'POSITION_2' | 'POSITION_3' | 'POSITION_4' | 'POSITION_5' | 'SWING'> = {
  0: 'AUTO',
  1: 'POSITION_1',
  2: 'POSITION_2',
  3: 'POSITION_3',
  4: 'POSITION_4',
  5: 'POSITION_5',
  7: 'SWING',
}

/**
 * Reverse vertical vane mappings (our type -> API value)
 */
export const VANE_VERTICAL_ENCODE: Record<string, number> = {
  'AUTO': 0,
  'POSITION_1': 1,
  'POSITION_2': 2,
  'POSITION_3': 3,
  'POSITION_4': 4,
  'POSITION_5': 5,
  'SWING': 7,
}

/**
 * Horizontal vane position mappings (API value -> our type)
 * 0 = Auto, 1-5 = Positions, 8 = Split, 12 = Swing
 */
export const VANE_HORIZONTAL_MAP: Record<number, 'AUTO' | 'POSITION_1' | 'POSITION_2' | 'POSITION_3' | 'POSITION_4' | 'POSITION_5' | 'SPLIT' | 'SWING'> = {
  0: 'AUTO',
  1: 'POSITION_1',
  2: 'POSITION_2',
  3: 'POSITION_3',
  4: 'POSITION_4',
  5: 'POSITION_5',
  8: 'SPLIT',
  12: 'SWING',
}

/**
 * Reverse horizontal vane mappings (our type -> API value)
 */
export const VANE_HORIZONTAL_ENCODE: Record<string, number> = {
  'AUTO': 0,
  'POSITION_1': 1,
  'POSITION_2': 2,
  'POSITION_3': 3,
  'POSITION_4': 4,
  'POSITION_5': 5,
  'SPLIT': 8,
  'SWING': 12,
}

/**
 * EffectiveFlags bitmask values for device control
 */
export const EFFECTIVE_FLAGS = {
  POWER: 0x01,
  OPERATION_MODE: 0x02,
  TEMPERATURE: 0x04,
  FAN_SPEED: 0x08,
  VANE_VERTICAL: 0x10,
  VANE_HORIZONTAL: 0x100,
  /** All flags combined for full update */
  ALL: 0x1F + 0x100,
} as const

/**
 * UI configuration
 */
export const MELCLOUD_UI = {
  /** Duration to show success confirmation */
  CONFIRMATION_DURATION_MS: 2000,

  /** Duration to show toast messages */
  MESSAGE_DURATION_MS: 3000,

  /** Maximum length for custom device names */
  MAX_DEVICE_NAME_LENGTH: 100,

  /** Debounce delay for temperature slider in milliseconds */
  TEMPERATURE_DEBOUNCE_MS: 500,

  /** Recommended minimum update interval to avoid rate limiting */
  MIN_UPDATE_INTERVAL_MS: 60000,
} as const

/**
 * Temperature range
 */
export const TEMPERATURE = {
  MIN: 16,
  MAX: 31,
  STEP: 0.5,
  /** Default temperature when not specified */
  DEFAULT: 22,
} as const
