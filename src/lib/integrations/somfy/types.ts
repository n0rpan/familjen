/**
 * Somfy/Overkiz API Types
 *
 * Based on the Overkiz API used by Somfy TaHoma.
 * See: https://github.com/iMicknl/python-overkiz-api
 */

// ============================================================================
// Authentication
// ============================================================================

export interface OverkizTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope?: string
}

export interface OverkizJwtResponse {
  token: string
}

// ============================================================================
// Gateway / Setup
// ============================================================================

export interface OverkizGateway {
  gatewayId: string
  type: number
  subType: number
  placeOID: string
  alive: boolean
  timeReliable: boolean
  connectivity: {
    status: string
    protocolVersion: string
  }
  upToDate: boolean
  updateStatus: string
  syncInProgress: boolean
  mode: string
  functions?: string
}

export interface OverkizSetup {
  creationTime: number
  lastUpdateTime: number
  id: string
  location: {
    creationTime: number
    lastUpdateTime: number
    city: string
    country: string
    postalCode: string
    addressLine1: string
    addressLine2: string
    timezone: string
    longitude: number
    latitude: number
    twilightMode: number
    twilightAngle: string
    twilightCity: string
    summerSolsticeDuskMinutes: number
    winterSolsticeDuskMinutes: number
    twilightOffsetEnabled: boolean
    dawnOffset: number
    duskOffset: number
  }
  gateways: OverkizGateway[]
  devices: OverkizDevice[]
  zones?: OverkizZone[]
  features?: OverkizFeature[]
}

export interface OverkizZone {
  creationTime: number
  lastUpdateTime: number
  label: string
  type: number
  metadata: string
  items: unknown[]
}

export interface OverkizFeature {
  name: string
  source: string
}

// ============================================================================
// Devices
// ============================================================================

export interface OverkizDevice {
  creationTime: number
  lastUpdateTime: number
  label: string
  deviceURL: string
  shortcut: boolean
  controllableName: string
  definition: OverkizDeviceDefinition
  states: OverkizDeviceState[]
  available: boolean
  enabled: boolean
  placeOID: string
  widget: string
  type: number
  oid: string
  uiClass: string
  attributes?: OverkizDeviceAttribute[]
}

export interface OverkizDeviceDefinition {
  commands: OverkizCommandDefinition[]
  states: OverkizStateDefinition[]
  widgetName: string
  uiClass: string
  qualifiedName: string
  type: string
}

export interface OverkizCommandDefinition {
  commandName: string
  nparams: number
}

export interface OverkizStateDefinition {
  type: string
  qualifiedName: string
  values?: string[]
}

export interface OverkizDeviceState {
  type: number
  name: string
  value: string | number | boolean
}

export interface OverkizDeviceAttribute {
  type: number
  name: string
  value: string | number | boolean
}

// ============================================================================
// Commands / Execution
// ============================================================================

export interface OverkizCommand {
  name: string
  parameters?: (string | number | boolean)[]
}

export interface OverkizAction {
  deviceURL: string
  commands: OverkizCommand[]
}

export interface OverkizExecutionRequest {
  label?: string
  actions: OverkizAction[]
}

export interface OverkizExecution {
  id: string
  description?: string
  owner?: string
  state: string
  actionGroup?: OverkizAction[]
}

// ============================================================================
// Events
// ============================================================================

export interface OverkizEventListener {
  id: string
}

export interface OverkizEvent {
  name: string
  timestamp: number
  execId?: string
  oldState?: string
  newState?: string
  deviceURL?: string
  deviceStates?: OverkizDeviceState[]
  failure?: OverkizFailure
}

export interface OverkizFailure {
  failureType: string
  failedCommands?: OverkizCommand[]
}

// ============================================================================
// Server Configuration
// ============================================================================

export type OverkizServer =
  | 'somfy_europe'
  | 'somfy_america'
  | 'somfy_oceania'

export interface OverkizServerConfig {
  name: string
  endpoint: string
  apiEndpoint: string
  authEndpoint: string
  clientId: string
  clientSecret: string
}

/**
 * Overkiz server configurations for different Somfy regions.
 *
 * NOTE: The clientId and clientSecret values are PUBLIC OAuth credentials used by
 * all Somfy/Overkiz mobile apps and open-source integrations. They are NOT secret.
 *
 * These credentials are widely documented and used by:
 * - python-overkiz-api (https://github.com/iMicknl/python-overkiz-api)
 * - Home Assistant Overkiz integration
 * - Various other open-source home automation projects
 *
 * They identify the "app" making requests, not the user. User authentication
 * is handled separately via the password grant flow with user-specific credentials.
 */
export const OVERKIZ_SERVERS: Record<OverkizServer, OverkizServerConfig> = {
  somfy_europe: {
    name: 'Somfy Europe',
    endpoint: 'https://ha101-1.overkiz.com',
    apiEndpoint: 'https://ha101-1.overkiz.com/enduser-mobile-web/enduserAPI/',
    authEndpoint: 'https://accounts.somfy.com/oauth/oauth/v2/token',
    clientId: '0d8e920c-1478-11e7-a377-02dd59bd3041_1ewvaqmclfogo4kcsoo0c8k4kso884owg08sg8c40sk4go4ksg',
    clientSecret: '12k73w1n540g8o4cokg0cw84cog840k84cwggscwg884004kgk',
  },
  somfy_america: {
    name: 'Somfy North America',
    endpoint: 'https://ha401-1.overkiz.com',
    apiEndpoint: 'https://ha401-1.overkiz.com/enduser-mobile-web/enduserAPI/',
    authEndpoint: 'https://accounts.somfy.com/oauth/oauth/v2/token',
    clientId: '0d8e920c-1478-11e7-a377-02dd59bd3041_1ewvaqmclfogo4kcsoo0c8k4kso884owg08sg8c40sk4go4ksg',
    clientSecret: '12k73w1n540g8o4cokg0cw84cog840k84cwggscwg884004kgk',
  },
  somfy_oceania: {
    name: 'Somfy Oceania',
    endpoint: 'https://ha201-1.overkiz.com',
    apiEndpoint: 'https://ha201-1.overkiz.com/enduser-mobile-web/enduserAPI/',
    authEndpoint: 'https://accounts.somfy.com/oauth/oauth/v2/token',
    clientId: '0d8e920c-1478-11e7-a377-02dd59bd3041_1ewvaqmclfogo4kcsoo0c8k4kso884owg08sg8c40sk4go4ksg',
    clientSecret: '12k73w1n540g8o4cokg0cw84cog840k84cwggscwg884004kgk',
  },
}

// ============================================================================
// Client Options
// ============================================================================

export interface SomfyClientOptions {
  /** Server region (default: somfy_europe) */
  server?: OverkizServer
  /** Enable debug logging */
  debug?: boolean
  /** Request timeout in milliseconds */
  timeout?: number
}

// ============================================================================
// Error Types
// ============================================================================

export class SomfyError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message)
    this.name = 'SomfyError'
  }
}

export class SomfyAuthError extends SomfyError {
  constructor(message: string, response?: unknown) {
    super(message, 401, response)
    this.name = 'SomfyAuthError'
  }
}

// ============================================================================
// Mapped Types (for our database)
// ============================================================================

export interface MappedSomfyDevice {
  deviceUrl: string
  label: string
  uiClass: string
  controllableName: string
  available: boolean
  position?: number // 0-100 (0 = open, 100 = closed for blinds)
  commands: string[]
  rawData: OverkizDevice
}

// Device UI classes we support for home control
export const SUPPORTED_UI_CLASSES = [
  'ExteriorScreen',
  'Screen',
  'RollerShutter',
  'Awning',
  'Pergola',
  'GarageDoor',
  'Gate',
  'Window',
  'VenetianBlind',
  'ExteriorVenetianBlind',
  'Blind',
  'Curtain',
] as const

export type SupportedUIClass = typeof SUPPORTED_UI_CLASSES[number]

export function isSupportedDevice(device: OverkizDevice): boolean {
  return SUPPORTED_UI_CLASSES.includes(device.uiClass as SupportedUIClass)
}
