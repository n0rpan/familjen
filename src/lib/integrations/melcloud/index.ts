/**
 * MELCloud Integration
 *
 * Exports all MELCloud-related functionality.
 */

export { MelCloudClient } from './client'
export { getAuthenticatedClient, clearCachedTokens } from './auth'
export {
  // Types
  type MelCloudClientOptions,
  type MelCloudLoginResponse,
  type MelCloudBuilding,
  type MelCloudDevice,
  type MelCloudATADeviceData,
  type MelCloudOperationMode,
  type MelCloudFanSpeed,
  type MelCloudVaneVertical,
  type MelCloudVaneHorizontal,
  type MelCloudPowerState,
  type MappedMelCloudDevice,
  // Enums
  MelCloudDeviceType,
  // Errors
  MelCloudError,
  MelCloudAuthError,
  // Constants from types
  TEMPERATURE_LIMITS,
  FAN_SPEEDS,
  OPERATION_MODES,
  VANE_VERTICAL_POSITIONS,
  VANE_HORIZONTAL_POSITIONS,
} from './types'
export {
  MELCLOUD_API,
  MELCLOUD_ENDPOINTS,
  MELCLOUD_UI,
  TEMPERATURE,
  OPERATION_MODE_MAP,
  OPERATION_MODE_ENCODE,
  FAN_SPEED_MAP,
  FAN_SPEED_ENCODE,
  VANE_VERTICAL_MAP,
  VANE_VERTICAL_ENCODE,
  VANE_HORIZONTAL_MAP,
  VANE_HORIZONTAL_ENCODE,
  EFFECTIVE_FLAGS,
} from './constants'
