/**
 * Toshiba Home AC Control API Types
 *
 * Based on the Toshiba Home AC Control API.
 * See: https://github.com/KaSroka/Toshiba-AC-control
 *      https://gist.github.com/h4de5/7f97db0f4efc265e48904d4a84dab4fb
 */

// ============================================================================
// Authentication
// ============================================================================

export interface ToshibaLoginRequest {
  Username: string
  Password: string
}

export interface ToshibaLoginResponse {
  IsSuccess: boolean
  Message: string
  ResObj: {
    access_token: string
    consumerId: string
    countryId: number
    firstName: string
    lastName: string
    email: string
  } | null
  StatusCode: string
}

// ============================================================================
// AC Device / Mapping
// ============================================================================

export interface ToshibaACMapping {
  // The API returns ACId, not Id
  ACId: string
  Id?: string // Fallback if older API version
  Name: string
  ACModelId: string
  MeritFeature: string
  AdapterId: string
  ACStateData?: ToshibaACState | null // May be missing if device is offline
  Timezone: string
  FirmwareVersion: string
  IsEnergyConsumptionModel: boolean
  IsAutoCleanPresent: boolean
}

export interface ToshibaACState {
  ACId: string
  ACOperationMode: ToshibaOperationMode
  ACSwingMode: ToshibaSwingMode
  ACPowerState: ToshibaPowerState
  ACFanSpeed: ToshibaFanSpeed
  ACSetpointTemperature: number
  ACIndoorTemperature: number
  ACOutdoorTemperature: number
  ACMeritA: string
  ACMeritB: string
  ACPureState: ToshibaPureState
  ACPowerConsumption: number | null
  ACOnOffTimer: string | null
  LastUpdated: string
}

// ============================================================================
// Enums for AC State
// ============================================================================

export type ToshibaOperationMode =
  | 'AUTO'
  | 'COOL'
  | 'HEAT'
  | 'DRY'
  | 'FAN'

export type ToshibaSwingMode =
  | 'OFF'
  | 'ON'
  | 'VERTICAL'
  | 'HORIZONTAL'

export type ToshibaPowerState =
  | 'ON'
  | 'OFF'

export type ToshibaFanSpeed =
  | 'AUTO'
  | 'QUIET'
  | 'LOW'
  | 'MEDIUM_LOW'
  | 'MEDIUM'
  | 'MEDIUM_HIGH'
  | 'HIGH'

export type ToshibaPureState =
  | 'ON'
  | 'OFF'

// ============================================================================
// Control Commands
// ============================================================================

export interface ToshibaControlRequest {
  ACId: string
  CommandType: ToshibaCommandType
  Value: string | number
}

export type ToshibaCommandType =
  | 'PowerState'
  | 'OperationMode'
  | 'SetpointTemperature'
  | 'FanSpeed'
  | 'SwingMode'
  | 'Pure'

export interface ToshibaControlResponse {
  IsSuccess: boolean
  Message: string
  ResObj: unknown
  StatusCode: string
}

// ============================================================================
// API Response Wrapper
// ============================================================================

export interface ToshibaAPIResponse<T> {
  IsSuccess: boolean
  Message: string
  ResObj: T | null
  StatusCode: string
}

// ============================================================================
// Client Options
// ============================================================================

export interface ToshibaClientOptions {
  /** Enable debug logging */
  debug?: boolean
  /** Request timeout in milliseconds */
  timeout?: number
}

// ============================================================================
// Error Types
// ============================================================================

export class ToshibaError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message)
    this.name = 'ToshibaError'
  }
}

export class ToshibaAuthError extends ToshibaError {
  constructor(message: string, response?: unknown) {
    super(message, 401, response)
    this.name = 'ToshibaAuthError'
  }
}

// ============================================================================
// Mapped Types (for our database)
// ============================================================================

export interface MappedToshibaDevice {
  acId: string
  name: string
  model: string
  firmwareVersion: string
  timezone: string
  // Current state (null if device is offline/unknown)
  powerState: ToshibaPowerState | null
  operationMode: ToshibaOperationMode | null
  targetTemperature: number | null
  currentTemperature: number | null
  outdoorTemperature: number | null
  fanSpeed: ToshibaFanSpeed | null
  swingMode: ToshibaSwingMode | null
  pureState: ToshibaPureState | null
  // Features
  hasEnergyConsumption: boolean
  hasAutoClean: boolean
  meritFeature: string
  // Raw data
  rawData: ToshibaACMapping
}

// Temperature limits for Toshiba AC
export const TEMPERATURE_LIMITS = {
  MIN: 17,
  MAX: 30,
  STEP: 0.5,
} as const

// Available fan speeds
export const FAN_SPEEDS: ToshibaFanSpeed[] = [
  'AUTO',
  'QUIET',
  'LOW',
  'MEDIUM_LOW',
  'MEDIUM',
  'MEDIUM_HIGH',
  'HIGH',
]

// Available operation modes
export const OPERATION_MODES: ToshibaOperationMode[] = [
  'AUTO',
  'COOL',
  'HEAT',
  'DRY',
  'FAN',
]

// Available swing modes
export const SWING_MODES: ToshibaSwingMode[] = [
  'OFF',
  'ON',
  'VERTICAL',
  'HORIZONTAL',
]
