/**
 * Mitsubishi MELCloud API Types
 *
 * Based on the MELCloud API.
 * See: https://github.com/OlivierZal/melcloud-api
 *      https://github.com/vilppuvuorinen/pymelcloud
 */

// ============================================================================
// Authentication
// ============================================================================

export interface MelCloudLoginRequest {
  Email: string
  Password: string
  Language: number
  AppVersion: string
  Persist: boolean
  CaptchaResponse: string | null
}

export interface MelCloudLoginResponse {
  ErrorId: number | null
  ErrorMessage: string | null
  LoginStatus: number
  UserId: number
  RandomKey: string
  AppVersionAnnouncement: string | null
  LoginData: {
    ContextKey: string
    Client: number
    Terms: number
    AL: number
    ML: number
    CMI: boolean
    IsStaff: boolean
    CUTF: boolean
    CAA: boolean
    ReceiveCountryNotifications: boolean
    ReceiveAllNotifications: boolean
    CACA: boolean
    CAGA: boolean
    MaximumDevices: number
    ShowDiagnostics: boolean
    Language: number
    Country: number
    RealClient: number
    Name: string
    UseFahrenheit: boolean
    Duration: number
    Expiry: string
    CMSC: boolean
    PartnerApplicationVersion: string | null
  } | null
}

// ============================================================================
// Device Types
// ============================================================================

/**
 * MELCloud device types
 */
export enum MelCloudDeviceType {
  AirToAir = 0,   // ATA - Air conditioner
  AirToWater = 1, // ATW - Heat pump
  ERV = 3,        // Energy Recovery Ventilation
}

/**
 * Building structure from ListDevices
 */
export interface MelCloudBuilding {
  ID: number
  Name: string
  AddressLine1: string
  AddressLine2: string
  City: string
  Postcode: string
  Latitude: number
  Longitude: number
  Structure: {
    Floors: MelCloudFloor[]
    Areas: MelCloudArea[]
    Devices: MelCloudDevice[]
  }
}

export interface MelCloudFloor {
  ID: number
  BuildingId: number
  Name: string
  Devices: MelCloudDevice[]
}

export interface MelCloudArea {
  ID: number
  BuildingId: number
  FloorId: number | null
  Name: string
  Devices: MelCloudDevice[]
}

/**
 * ATA (Air-to-Air) device from API
 */
export interface MelCloudDevice {
  DeviceID: number
  DeviceName: string
  BuildingID: number
  BuildingName: string
  FloorID: number | null
  FloorName: string | null
  AreaID: number | null
  AreaName: string | null
  ImageID: number
  InstallationDate: string
  LastTimeStamp: string
  Owner: string | null
  DetectedCountry: number
  AdaptorType: number
  FirmwareDeployment: string | null
  FirmwareUpdateAborted: boolean
  LinkedDevice: number | null
  WifiSignalStrength: number
  WifiAdapterStatus: string
  Position: string
  PCycle: number
  PCycleActual: number
  RecordNumMax: number
  LastACCInputReport: string | null
  ErrorCode: number
  HasError: boolean
  LastReset: string | null
  FlashWrites: number
  Scene: string | null
  SSLExpirationDate: string
  SPTimeout: number
  Passcode: string | null
  ServerCommunicationDisabled: boolean
  ConsecutiveUploadErrors: number
  DoNotRespondAfter: string | null
  OwnerRoleAccessLevel: number
  OwnerCountry: number
  HideEnergyReport: boolean
  ExceptionHash: number
  ExceptionDate: string | null
  ExceptionCount: number
  Rate1StartTime: string | null
  Rate2StartTime: string | null
  ProtocolVersion: number
  UnitVersion: number
  FirmwareAppVersion: number
  FirmwareWebVersion: number
  FirmwareWlanVersion: number
  HasErrorMessages: boolean
  // ATA-specific device data
  Device: MelCloudATADeviceData
}

/**
 * ATA device state data
 */
export interface MelCloudATADeviceData {
  DeviceID: number
  DeviceType: MelCloudDeviceType
  Power: boolean
  RoomTemperature: number
  SetTemperature: number
  ActualFanSpeed: number
  FanSpeed: number
  AutomaticFanSpeed: boolean
  VaneVertical: number
  VaneHorizontal: number
  OperationMode: MelCloudOperationMode
  EffectiveFlags: number
  InStandbyMode: boolean
  DemandPercentage: number
  // Capabilities
  NumberOfFanSpeeds: number
  HasAutomaticFanSpeed: boolean
  AirDirectionFunction: boolean
  SwingFunction: boolean
  // Additional features
  WeatherObservations: unknown[]
  ErrorMessage: string | null
  ErrorCode: number
  DefaultHeatingSetTemperature: number
  DefaultCoolingSetTemperature: number
  RoomTemperatureLabel: number
  HeatingEnergyConsumedRate1: number
  HeatingEnergyConsumedRate2: number
  CoolingEnergyConsumedRate1: number
  CoolingEnergyConsumedRate2: number
  AutoEnergyConsumedRate1: number
  AutoEnergyConsumedRate2: number
  DryEnergyConsumedRate1: number
  DryEnergyConsumedRate2: number
  FanEnergyConsumedRate1: number
  FanEnergyConsumedRate2: number
  OtherEnergyConsumedRate1: number
  OtherEnergyConsumedRate2: number
  WifiSignalStrength: number
  WifiAdapterStatus: string
  OwnerID: number | null
  OwnerName: string | null
  OwnerEmail: string | null
  DualSetTemperature: boolean
  HasOutdoorTemperature: boolean
  OutdoorTemperature: number
  HasEnergyConsumedMeter: boolean
  CurrentEnergyConsumed: number
  CurrentEnergyMode: number
  CanCool: boolean
  CanHeat: boolean
  CanDry: boolean
  HasZone2: boolean
  HasWideVane: boolean
  ModelType: number
  ModelSupportsDry: boolean
  ModelSupportsAuto: boolean
  ModelSupportsFanSpeed: boolean
  ModelSupportsVaneVertical: boolean
  ModelSupportsVaneHorizontal: boolean
  ModelSupportsStandbyMode: boolean
  ModelSupportsEnergyReporting: boolean
  ProhibitSetTemperature: boolean
  ProhibitOperationMode: boolean
  ProhibitPower: boolean
  Offline: boolean
  Scene: string | null
  SceneOwner: string | null
}

// ============================================================================
// Enums for Device State
// ============================================================================

/**
 * Operation modes for ATA devices
 */
export type MelCloudOperationMode =
  | 'HEAT'
  | 'DRY'
  | 'COOL'
  | 'FAN'
  | 'AUTO'

/**
 * Power state
 */
export type MelCloudPowerState = 'ON' | 'OFF'

/**
 * Fan speed settings
 */
export type MelCloudFanSpeed =
  | 'AUTO'
  | 'SPEED_1'
  | 'SPEED_2'
  | 'SPEED_3'
  | 'SPEED_4'
  | 'SPEED_5'

/**
 * Vertical vane position
 */
export type MelCloudVaneVertical =
  | 'AUTO'
  | 'POSITION_1'
  | 'POSITION_2'
  | 'POSITION_3'
  | 'POSITION_4'
  | 'POSITION_5'
  | 'SWING'

/**
 * Horizontal vane position
 */
export type MelCloudVaneHorizontal =
  | 'AUTO'
  | 'POSITION_1'
  | 'POSITION_2'
  | 'POSITION_3'
  | 'POSITION_4'
  | 'POSITION_5'
  | 'SPLIT'
  | 'SWING'

// ============================================================================
// Control Commands
// ============================================================================

export interface MelCloudSetAtaRequest {
  DeviceID: number
  Power: boolean
  OperationMode: number
  SetTemperature: number
  SetFanSpeed: number
  VaneVertical: number
  VaneHorizontal: number
  EffectiveFlags: number
  HasPendingCommand: boolean
}

export interface MelCloudSetAtaResponse {
  DeviceID: number
  Power: boolean
  RoomTemperature: number
  SetTemperature: number
  FanSpeed: number
  VaneVertical: number
  VaneHorizontal: number
  OperationMode: number
  EffectiveFlags: number
  LastCommunication: string
  NextCommunication: string
  Offline: boolean
  HasError: boolean
  HasPendingCommand: boolean
  ErrorCode: number
}

// ============================================================================
// Client Options
// ============================================================================

export interface MelCloudClientOptions {
  /** Enable debug logging */
  debug?: boolean
  /** Request timeout in milliseconds */
  timeout?: number
}

// ============================================================================
// Error Types
// ============================================================================

export class MelCloudError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message)
    this.name = 'MelCloudError'
  }
}

export class MelCloudAuthError extends MelCloudError {
  constructor(message: string, response?: unknown) {
    super(message, 401, response)
    this.name = 'MelCloudAuthError'
  }
}

// ============================================================================
// Mapped Types (for our database)
// ============================================================================

export interface MappedMelCloudDevice {
  deviceId: number
  name: string
  buildingId: number
  buildingName: string
  floorName: string | null
  areaName: string | null
  model: string
  // Current state (null if device is offline)
  powerState: MelCloudPowerState | null
  operationMode: MelCloudOperationMode | null
  targetTemperature: number | null
  currentTemperature: number | null
  outdoorTemperature: number | null
  fanSpeed: MelCloudFanSpeed | null
  vaneVertical: MelCloudVaneVertical | null
  vaneHorizontal: MelCloudVaneHorizontal | null
  // Capabilities
  numberOfFanSpeeds: number
  canCool: boolean
  canHeat: boolean
  canDry: boolean
  hasVaneVertical: boolean
  hasVaneHorizontal: boolean
  hasSwing: boolean
  hasWideVane: boolean
  // Status
  offline: boolean
  hasError: boolean
  errorCode: number
  wifiSignalStrength: number
  // Raw data
  rawData: MelCloudDevice
}

// Temperature limits for MELCloud AC
export const TEMPERATURE_LIMITS = {
  MIN: 16,
  MAX: 31,
  STEP: 0.5,
} as const

// Available fan speeds
export const FAN_SPEEDS: MelCloudFanSpeed[] = [
  'AUTO',
  'SPEED_1',
  'SPEED_2',
  'SPEED_3',
  'SPEED_4',
  'SPEED_5',
]

// Available operation modes
export const OPERATION_MODES: MelCloudOperationMode[] = [
  'AUTO',
  'COOL',
  'HEAT',
  'DRY',
  'FAN',
]

// Available vertical vane positions
export const VANE_VERTICAL_POSITIONS: MelCloudVaneVertical[] = [
  'AUTO',
  'POSITION_1',
  'POSITION_2',
  'POSITION_3',
  'POSITION_4',
  'POSITION_5',
  'SWING',
]

// Available horizontal vane positions
export const VANE_HORIZONTAL_POSITIONS: MelCloudVaneHorizontal[] = [
  'AUTO',
  'POSITION_1',
  'POSITION_2',
  'POSITION_3',
  'POSITION_4',
  'POSITION_5',
  'SPLIT',
  'SWING',
]
