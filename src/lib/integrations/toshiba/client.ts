/**
 * Toshiba Home AC Control API Client
 *
 * TypeScript client for the Toshiba Home AC Control API.
 * Based on: https://github.com/KaSroka/Toshiba-AC-control
 *           https://gist.github.com/h4de5/7f97db0f4efc265e48904d4a84dab4fb
 *
 * Architecture:
 * - HTTP API: Used for login, device registration, and getting device state
 * - AMQP (Azure IoT Hub): Used for sending control commands to devices
 *
 * Usage:
 *   const client = new ToshibaClient()
 *   await client.login(username, password)
 *   const devices = await client.getDevices()
 *   await client.setPowerState(acId, deviceUniqueId, 'ON')
 *   await client.setTemperature(acId, deviceUniqueId, 22)
 */

import { Client as IoTHubClient, Message } from 'azure-iot-device'
import { Amqp } from 'azure-iot-device-amqp'
import {
  type ToshibaClientOptions,
  type ToshibaLoginResponse,
  type ToshibaDeviceGroup,
  type ToshibaACDevice,
  type ToshibaACState,
  type ToshibaAPIResponse,
  type ToshibaOperationMode,
  type ToshibaFanSpeed,
  type ToshibaSwingMode,
  type ToshibaPowerState,
  type MappedToshibaDevice,
  ToshibaError,
  ToshibaAuthError,
} from './types'
import { TOSHIBA_API, TOSHIBA_ENDPOINTS } from './constants'

// Hex state byte positions for READING ACStateData from API
// Verified from actual device data: 30431531316400101600fe0b000010ff000000
// [8]=16(22°C indoor), [9]=00(0°C outdoor)
const STATE_OFFSETS_READ = {
  POWER: 0,
  MODE: 1,
  TEMP: 2,
  FAN: 3,        // Position 3, not 4
  SWING: 5,
  PURE: 6,
  INDOOR_TEMP: 8,   // Verified: position 8 has indoor temp
  OUTDOOR_TEMP: 9,  // Verified: position 9 has outdoor temp (no +128 offset)
} as const

// Hex state byte positions for WRITING commands via AMQP
const STATE_OFFSETS_WRITE = {
  POWER: 0,
  MODE: 1,
  TEMP: 2,
  FAN: 3,
  SWING: 4,
  POWER_SEL: 5,
  MERIT_A: 6,
  MERIT_B: 7,
  PURE: 8,
} as const

// Mode code mappings
const MODE_MAP: Record<string, ToshibaOperationMode> = {
  '41': 'AUTO',
  '42': 'COOL',
  '43': 'HEAT',
  '44': 'DRY',
  '45': 'FAN',
}

// Fan speed code mappings
// Note: 50/A0 = Auto, 31 = Quiet (user confirmed)
const FAN_MAP: Record<string, ToshibaFanSpeed> = {
  '41': 'AUTO',   // Corrected: 41 is auto per fcu_state.py
  '50': 'AUTO',   // Also seen as 50 on some models
  'a0': 'AUTO',
  '31': 'QUIET',  // Silent mode
  '32': 'LOW',
  '33': 'MEDIUM_LOW',
  '34': 'MEDIUM',
  '35': 'MEDIUM_HIGH',
  '36': 'HIGH',
}

// Swing mode code mappings
const SWING_MAP: Record<string, ToshibaSwingMode> = {
  '31': 'OFF',
  '41': 'ON',
  '42': 'VERTICAL',
  '43': 'HORIZONTAL',
}

// Reverse mappings for encoding control commands
const POWER_ENCODE: Record<ToshibaPowerState, string> = {
  'ON': '30',
  'OFF': '31',
}

const MODE_ENCODE: Record<ToshibaOperationMode, string> = {
  'AUTO': '41',
  'COOL': '42',
  'HEAT': '43',
  'DRY': '44',
  'FAN': '45',
}

const FAN_ENCODE: Record<ToshibaFanSpeed, string> = {
  'AUTO': '41',
  'QUIET': '31',
  'LOW': '32',
  'MEDIUM_LOW': '33',
  'MEDIUM': '34',
  'MEDIUM_HIGH': '35',
  'HIGH': '36',
}

const SWING_ENCODE: Record<ToshibaSwingMode, string> = {
  'OFF': '31',
  'ON': '41',
  'VERTICAL': '42',
  'HORIZONTAL': '43',
}

const PURE_ENCODE: Record<'ON' | 'OFF', string> = {
  'ON': '18',  // Corrected per fcu_state.py
  'OFF': '10',
}

// Device cache to store device info including DeviceUniqueId
interface DeviceCache {
  [acId: string]: {
    deviceUniqueId: string
    currentStateHex: string | null
  }
}

export class ToshibaClient {
  private accessToken: string | null = null
  private consumerId: string | null = null
  private username: string | null = null
  private tokenExpiry: number = 0
  private debug: boolean
  private timeout: number

  // AMQP credentials
  private sasToken: string | null = null
  private deviceId: string | null = null

  // Device cache for storing DeviceUniqueId mapping
  private deviceCache: DeviceCache = {}

  constructor(options: ToshibaClientOptions = {}) {
    this.debug = options.debug ?? process.env.TOSHIBA_DEBUG === 'true'
    this.timeout = options.timeout ?? TOSHIBA_API.TIMEOUT_MS
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /**
   * Login to Toshiba Home AC Control.
   * Must be called before any other API methods.
   */
  async login(username: string, password: string): Promise<void> {
    const maskedUser = username.length > 3 ? username.substring(0, 3) + '***' : '***'
    this.log('Logging in as:', maskedUser)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(`${TOSHIBA_API.BASE_URL}${TOSHIBA_ENDPOINTS.LOGIN}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Username: username,
          Password: password,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new ToshibaError(
          `Login request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      const data = await response.json() as ToshibaLoginResponse

      if (!data.IsSuccess || !data.ResObj) {
        throw new ToshibaAuthError(
          data.Message || 'Invalid username or password',
          data
        )
      }

      this.accessToken = data.ResObj.access_token
      this.consumerId = data.ResObj.consumerId
      this.username = username
      this.tokenExpiry = Date.now() + TOSHIBA_API.TOKEN_VALIDITY_MS - TOSHIBA_API.TOKEN_REFRESH_MARGIN_MS

      this.log('Login successful, consumerId:', this.consumerId)

      // Register mobile device to get SAS token for AMQP
      await this.registerMobileDevice()
    } catch (error) {
      if (error instanceof ToshibaError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ToshibaError('Login request timed out')
      }
      throw new ToshibaError(`Login failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Register mobile device to get SAS token for Azure IoT Hub.
   */
  private async registerMobileDevice(): Promise<void> {
    if (!this.accessToken || !this.username) {
      throw new ToshibaAuthError('Not authenticated. Call login() first.')
    }

    // Generate a unique device ID based on username
    this.deviceId = this.generateDeviceId(this.username)
    this.log('Registering mobile device with ID:', this.deviceId)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(`${TOSHIBA_API.BASE_URL}${TOSHIBA_ENDPOINTS.REGISTER_MOBILE_DEVICE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          Username: this.username,
          DeviceID: this.deviceId,
          DeviceType: '1',
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new ToshibaError(
          `RegisterMobileDevice failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      const data = await response.json() as ToshibaAPIResponse<{ SasToken: string }>

      if (!data.IsSuccess || !data.ResObj?.SasToken) {
        throw new ToshibaError(data.Message || 'Failed to register mobile device')
      }

      this.sasToken = data.ResObj.SasToken
      this.log('Mobile device registered, got SAS token')
    } catch (error) {
      if (error instanceof ToshibaError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ToshibaError('RegisterMobileDevice request timed out')
      }
      throw new ToshibaError(`RegisterMobileDevice failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Generate a unique device ID based on username.
   * Format must match Python library: {username}_{suffix}
   * See: https://github.com/KaSroka/Toshiba-AC-control
   */
  private generateDeviceId(username: string): string {
    // Use the same default suffix as the Python library
    const defaultSuffix = '3e6e4eb5f0e5aa46'
    return `${username}_${defaultSuffix}`
  }

  /**
   * Send a command message via AMQP.
   * Creates a new connection for each command to avoid stale connections in serverless environment.
   */
  private async sendAmqpMessage(message: object): Promise<void> {
    if (!this.sasToken) {
      throw new ToshibaError('No SAS token available. Call login() first.')
    }

    const messageStr = JSON.stringify(message)
    this.log('Sending AMQP message:', messageStr)

    // Create a fresh client for each command (serverless-friendly)
    const client = IoTHubClient.fromSharedAccessSignature(this.sasToken, Amqp)

    try {
      // Connect
      this.log('Connecting to Azure IoT Hub via AMQP...')
      await new Promise<void>((resolve, reject) => {
        client.open((err) => {
          if (err) {
            reject(new ToshibaError(`AMQP connection failed: ${err.message}`))
          } else {
            resolve()
          }
        })
      })
      this.log('AMQP connected successfully')

      // Send message
      const msg = new Message(messageStr)
      msg.contentType = 'application/json'
      msg.contentEncoding = 'utf-8'
      // Set custom property to identify as mobile app message
      msg.properties.add('type', 'mob')

      await new Promise<void>((resolve, reject) => {
        client.sendEvent(msg, (err) => {
          if (err) {
            reject(new ToshibaError(`Failed to send AMQP message: ${err.message}`))
          } else {
            resolve()
          }
        })
      })

      this.log('AMQP message sent successfully')
    } finally {
      // Always close connection
      await new Promise<void>((resolve) => {
        client.close(() => resolve())
      }).catch(() => {
        // Ignore close errors
      })
    }
  }

  /**
   * Login using existing tokens (for stored credentials).
   */
  loginWithToken(
    accessToken: string,
    consumerId: string,
    sasToken?: string,
    deviceId?: string,
    expiry?: number
  ): void {
    this.accessToken = accessToken
    this.consumerId = consumerId
    this.sasToken = sasToken ?? null
    this.deviceId = deviceId ?? null
    this.tokenExpiry = expiry ?? Date.now() + TOSHIBA_API.TOKEN_VALIDITY_MS
    this.log('Logged in with existing token')
  }

  /**
   * Check if the client is authenticated.
   */
  isAuthenticated(): boolean {
    return this.accessToken !== null && this.consumerId !== null
  }

  /**
   * Check if the token needs refresh (re-login for Toshiba).
   */
  needsRefresh(): boolean {
    return Date.now() >= this.tokenExpiry
  }

  /**
   * Get token expiry time in seconds.
   */
  getTokenExpiresIn(): number {
    const remaining = this.tokenExpiry - Date.now()
    return Math.max(0, Math.floor(remaining / 1000))
  }

  /**
   * Clear authentication state.
   */
  logout(): void {
    this.accessToken = null
    this.consumerId = null
    this.username = null
    this.tokenExpiry = 0
    this.sasToken = null
    this.deviceId = null
    this.deviceCache = {}
  }

  /**
   * Get current tokens for storage.
   */
  getTokens(): {
    accessToken: string | null
    consumerId: string | null
    sasToken: string | null
    deviceId: string | null
    expiry: number
  } {
    return {
      accessToken: this.accessToken,
      consumerId: this.consumerId,
      sasToken: this.sasToken,
      deviceId: this.deviceId,
      expiry: this.tokenExpiry,
    }
  }

  // ==========================================================================
  // Device Discovery
  // ==========================================================================

  /**
   * Get all registered AC devices.
   * The API returns groups with ACList arrays - we flatten them.
   */
  async getDevices(): Promise<ToshibaACDevice[]> {
    this.log('Fetching devices')

    const groups = await this.authenticatedFetch<ToshibaDeviceGroup[]>(
      `${TOSHIBA_ENDPOINTS.GET_DEVICES}?consumerId=${this.consumerId}`
    )

    if (!groups || groups.length === 0) {
      this.log('No device groups found')
      return []
    }

    // Flatten all ACList arrays from all groups
    const devices: ToshibaACDevice[] = []
    for (const group of groups) {
      if (group.ACList && Array.isArray(group.ACList)) {
        for (const device of group.ACList) {
          // Attach timezone from group to each device
          const deviceWithTimezone = {
            ...device,
            _timezone: group.TimeZone,
          } as ToshibaACDevice & { _timezone: string }

          devices.push(deviceWithTimezone)

          // Cache device info for AMQP commands
          this.deviceCache[device.Id] = {
            deviceUniqueId: device.DeviceUniqueId,
            currentStateHex: device.ACStateData,
          }
        }
      }
    }

    this.log(`Found ${devices.length} devices across ${groups.length} groups`)
    if (devices.length > 0) {
      this.log('First device:', devices[0].Name, 'ID:', devices[0].Id, 'UniqueId:', devices[0].DeviceUniqueId)
    }

    return devices
  }

  /**
   * Get current state of a specific AC unit.
   */
  async getDeviceState(acId: string): Promise<ToshibaACState> {
    this.log('Fetching device state:', acId)

    const data = await this.authenticatedFetch<ToshibaACState>(
      `${TOSHIBA_ENDPOINTS.GET_STATE}?ACId=${encodeURIComponent(acId)}`
    )

    if (!data) {
      throw new ToshibaError('Failed to get device state')
    }

    return data
  }

  /**
   * Get all devices mapped to our format.
   * Fetches accurate state from getDeviceState API for reliable temperature readings.
   */
  async getMappedDevices(): Promise<MappedToshibaDevice[]> {
    const devices = await this.getDevices()

    // Fetch accurate state for each device to get reliable temperature values
    // The hex state decoding can be unreliable for target temperature
    const mappedDevices = await Promise.all(
      devices.map(async (device) => {
        const mapped = this.mapDeviceToDb(device)

        // Try to get accurate state from API
        try {
          const state = await this.getDeviceState(device.Id)
          if (state) {
            // Handle temperature offset: Toshiba API adds +16 to temperatures below MIN (17°C)
            // So 16°C is returned as 32, 15°C as 31, etc.
            let targetTemp = state.ACSetpointTemperature
            if (targetTemp != null && targetTemp > 30) {
              // Decode the offset: subtract 16 to get actual temperature
              targetTemp = targetTemp - 16
              this.log('Decoded low temp offset for', device.Name, ':', state.ACSetpointTemperature, '→', targetTemp)
            }

            // Override with accurate values from API
            mapped.targetTemperature = targetTemp ?? mapped.targetTemperature
            mapped.currentTemperature = state.ACIndoorTemperature ?? mapped.currentTemperature
            mapped.outdoorTemperature = state.ACOutdoorTemperature ?? mapped.outdoorTemperature
            this.log('Got accurate state for', device.Name, '- target:', targetTemp, 'indoor:', state.ACIndoorTemperature)
          }
        } catch (err) {
          this.log('Failed to get device state for', device.Name, '- using hex decoded values:', err)
        }

        return mapped
      })
    )

    return mappedDevices
  }

  /**
   * Decode hex state string to extract device state values.
   * The ACStateData is a hex-encoded string where each byte pair represents a value.
   */
  private decodeHexState(hexState: string | null): {
    powerState: ToshibaPowerState | null
    operationMode: ToshibaOperationMode | null
    targetTemperature: number | null
    fanSpeed: ToshibaFanSpeed | null
    swingMode: ToshibaSwingMode | null
    pureState: 'ON' | 'OFF' | null
    indoorTemperature: number | null
    outdoorTemperature: number | null
  } {
    if (!hexState || hexState.length < 22) {  // At least 11 bytes for basic state
      return {
        powerState: null,
        operationMode: null,
        targetTemperature: null,
        fanSpeed: null,
        swingMode: null,
        pureState: null,
        indoorTemperature: null,
        outdoorTemperature: null,
      }
    }

    // Extract byte pairs (each byte = 2 hex chars)
    const getByte = (offset: number): string => hexState.slice(offset * 2, offset * 2 + 2).toLowerCase()


    // Power state: 30 = ON, 31 = OFF
    const powerByte = getByte(STATE_OFFSETS_READ.POWER)
    const powerState: ToshibaPowerState | null = powerByte === '30' ? 'ON' : powerByte === '31' ? 'OFF' : null

    // Operation mode: 41=AUTO, 42=COOL, 43=HEAT, 44=DRY, 45=FAN
    const modeByte = getByte(STATE_OFFSETS_READ.MODE)
    const operationMode = MODE_MAP[modeByte] ?? null

    // Target temperature: hex value is the temperature
    // Note: Toshiba API adds +16 offset for temps below MIN (17°C)
    const tempByte = getByte(STATE_OFFSETS_READ.TEMP)
    let targetTemperature = tempByte ? parseInt(tempByte, 16) : null
    if (targetTemperature != null && targetTemperature > 30) {
      // Decode the offset: subtract 16 to get actual temperature
      targetTemperature = targetTemperature - 16
    }

    // Fan speed
    const fanByte = getByte(STATE_OFFSETS_READ.FAN)
    const fanSpeed = FAN_MAP[fanByte] ?? null

    // Swing mode
    const swingByte = getByte(STATE_OFFSETS_READ.SWING)
    const swingMode = SWING_MAP[swingByte] ?? null

    // Pure/ionizer state
    const pureByte = getByte(STATE_OFFSETS_READ.PURE)
    const pureState: 'ON' | 'OFF' | null = pureByte === '18' ? 'ON' : pureByte === '10' ? 'OFF' : null

    // Indoor temperature (position 10 per Python library)
    const indoorByte = getByte(STATE_OFFSETS_READ.INDOOR_TEMP)
    const indoorTemperature = indoorByte && indoorByte !== 'fe' && indoorByte !== 'ff'
      ? parseInt(indoorByte, 16)
      : null

    // Outdoor temperature (position 9, stored as signed byte: negative temps use two's complement)
    const outdoorByte = getByte(STATE_OFFSETS_READ.OUTDOOR_TEMP)
    let outdoorTemperature: number | null = null
    if (outdoorByte && outdoorByte !== 'fe' && outdoorByte !== 'ff') {
      const raw = parseInt(outdoorByte, 16)
      // Handle signed byte: values > 127 are negative (two's complement)
      outdoorTemperature = raw > 127 ? raw - 256 : raw
    }

    return {
      powerState,
      operationMode,
      targetTemperature,
      fanSpeed,
      swingMode,
      pureState,
      indoorTemperature,
      outdoorTemperature,
    }
  }

  // ==========================================================================
  // Control Commands (via AMQP)
  // ==========================================================================

  /**
   * Get the DeviceUniqueId for an AC unit.
   * This is needed for AMQP commands.
   */
  getDeviceUniqueId(acId: string): string | null {
    return this.deviceCache[acId]?.deviceUniqueId ?? null
  }

  /**
   * Get the current state hex string for an AC unit.
   */
  getCurrentStateHex(acId: string): string | null {
    return this.deviceCache[acId]?.currentStateHex ?? null
  }

  /**
   * Set power state (ON/OFF).
   */
  async setPowerState(acId: string, state: ToshibaPowerState): Promise<void> {
    this.log('Setting power state:', state, 'for device:', acId)
    await this.sendCommand(acId, { power: state })
  }

  /**
   * Set operation mode (AUTO/COOL/HEAT/DRY/FAN).
   */
  async setOperationMode(acId: string, mode: ToshibaOperationMode): Promise<void> {
    this.log('Setting operation mode:', mode, 'for device:', acId)
    await this.sendCommand(acId, { mode })
  }

  /**
   * Set target temperature.
   * Supports temperatures below the normal MIN (17°C) by using the +16 offset encoding.
   */
  async setTemperature(acId: string, temperature: number): Promise<void> {
    // Allow extended range (5-30°C), encode temps below 17 with +16 offset
    const temp = Math.max(5, Math.min(30, temperature))
    this.log('Setting temperature:', temp, 'for device:', acId)
    await this.sendCommand(acId, { temperature: temp })
  }

  /**
   * Set fan speed.
   */
  async setFanSpeed(acId: string, speed: ToshibaFanSpeed): Promise<void> {
    this.log('Setting fan speed:', speed, 'for device:', acId)
    await this.sendCommand(acId, { fanSpeed: speed })
  }

  /**
   * Set swing mode.
   */
  async setSwingMode(acId: string, mode: ToshibaSwingMode): Promise<void> {
    this.log('Setting swing mode:', mode, 'for device:', acId)
    await this.sendCommand(acId, { swingMode: mode })
  }

  /**
   * Set pure/ionizer state.
   */
  async setPureState(acId: string, state: 'ON' | 'OFF'): Promise<void> {
    this.log('Setting pure state:', state, 'for device:', acId)
    await this.sendCommand(acId, { pure: state })
  }

  /**
   * Turn AC on with specified mode and temperature.
   */
  async turnOn(
    acId: string,
    mode?: ToshibaOperationMode,
    temperature?: number
  ): Promise<void> {
    this.log('Turning on device:', acId, 'mode:', mode, 'temp:', temperature)
    await this.sendCommand(acId, {
      power: 'ON',
      mode,
      temperature: temperature ? Math.max(5, Math.min(30, temperature)) : undefined,
    })
  }

  /**
   * Turn AC off.
   */
  async turnOff(acId: string): Promise<void> {
    this.log('Turning off device:', acId)
    await this.sendCommand(acId, { power: 'OFF' })
  }

  // ==========================================================================
  // Data Mapping
  // ==========================================================================

  /**
   * Map a Toshiba AC device to our simplified format.
   */
  mapDeviceToDb(device: ToshibaACDevice & { _timezone?: string }): MappedToshibaDevice {
    if (!device.Id) {
      console.error('[ToshibaClient] Device has no ID field. Raw device:', JSON.stringify(device, null, 2))
      throw new Error('Device is missing ID field')
    }

    // Decode the hex state string
    const state = this.decodeHexState(device.ACStateData)

    this.log('Decoded state for', device.Name, ':', JSON.stringify(state))

    return {
      acId: device.Id,
      name: device.Name,
      model: device.ACModelId,
      firmwareVersion: device.FirmwareVersion,
      timezone: device._timezone ?? '',
      // Current state from decoded hex
      powerState: state.powerState,
      operationMode: state.operationMode,
      targetTemperature: state.targetTemperature,
      currentTemperature: state.indoorTemperature,
      outdoorTemperature: state.outdoorTemperature,
      fanSpeed: state.fanSpeed,
      swingMode: state.swingMode,
      pureState: state.pureState,
      // Features - check FunctionSettingsSupport
      hasEnergyConsumption: false, // Would need separate API call
      hasAutoClean: device.FunctionSettingsSupport?.FilterCleaningSupport ?? false,
      meritFeature: device.MeritFeature,
      // Raw data - cast to match expected type
      rawData: device as unknown as import('./types').ToshibaACMapping,
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Build a command state hex string.
   * Updates only the specified values, using 'ff' for unchanged bytes.
   */
  private buildCommandState(options: {
    power?: ToshibaPowerState
    mode?: ToshibaOperationMode
    temperature?: number
    fanSpeed?: ToshibaFanSpeed
    swingMode?: ToshibaSwingMode
    pure?: 'ON' | 'OFF'
  }): string {
    // 19-byte state array, initialized to 'ff' (unchanged)
    const state: string[] = new Array(19).fill('ff')

    if (options.power !== undefined) {
      state[STATE_OFFSETS_WRITE.POWER] = POWER_ENCODE[options.power]
    }
    if (options.mode !== undefined) {
      state[STATE_OFFSETS_WRITE.MODE] = MODE_ENCODE[options.mode]
    }
    if (options.temperature !== undefined) {
      // Send temperature as-is (no offset needed for writing)
      state[STATE_OFFSETS_WRITE.TEMP] = options.temperature.toString(16).padStart(2, '0')
    }
    if (options.fanSpeed !== undefined) {
      state[STATE_OFFSETS_WRITE.FAN] = FAN_ENCODE[options.fanSpeed]
    }
    if (options.swingMode !== undefined) {
      state[STATE_OFFSETS_WRITE.SWING] = SWING_ENCODE[options.swingMode]
    }
    if (options.pure !== undefined) {
      state[STATE_OFFSETS_WRITE.PURE] = PURE_ENCODE[options.pure]
    }

    return state.join('')
  }

  /**
   * Send a command to the AC via AMQP.
   */
  private async sendCommand(acId: string, options: {
    power?: ToshibaPowerState
    mode?: ToshibaOperationMode
    temperature?: number
    fanSpeed?: ToshibaFanSpeed
    swingMode?: ToshibaSwingMode
    pure?: 'ON' | 'OFF'
  }): Promise<void> {
    const deviceUniqueId = this.getDeviceUniqueId(acId)
    if (!deviceUniqueId) {
      // Try to fetch devices to populate cache
      await this.getDevices()
      const uniqueId = this.getDeviceUniqueId(acId)
      if (!uniqueId) {
        throw new ToshibaError(`Device not found in cache: ${acId}. Call getDevices() first.`)
      }
    }

    // Check if device is in "8°C mode" (low temp mode) by reading current state
    // In this mode, temperature values have +16 offset
    const cachedDevice = this.deviceCache[acId]
    let adjustedOptions = { ...options }

    if (options.temperature !== undefined && cachedDevice?.currentStateHex) {
      const currentTempByte = cachedDevice.currentStateHex.slice(STATE_OFFSETS_READ.TEMP * 2, STATE_OFFSETS_READ.TEMP * 2 + 2)
      const currentTempValue = parseInt(currentTempByte, 16)
      const isIn8CMode = currentTempValue > 30

      if (isIn8CMode) {
        // In 8°C mode, temperatures need +16 offset when writing
        this.log('Device in 8°C mode, applying +16 offset for temperature write:', options.temperature, '→', options.temperature + 16)
        adjustedOptions.temperature = options.temperature + 16
      }
    }

    const targetId = this.getDeviceUniqueId(acId)!
    const stateHex = this.buildCommandState(adjustedOptions)

    const message = {
      sourceId: this.deviceId,
      messageId: Date.now().toString(),
      targetId: [targetId],
      cmd: 'CMD_FCU_TO_AC',
      payload: { data: stateHex },
      timeStamp: Date.now().toString(),
    }

    await this.sendAmqpMessage(message)

    // Update cached state if we know the current state
    if (cachedDevice?.currentStateHex) {
      // Merge new values into cached state
      const currentState = cachedDevice.currentStateHex
      const newState = stateHex
      let mergedState = ''
      for (let i = 0; i < Math.max(currentState.length, newState.length); i += 2) {
        const currentByte = currentState.slice(i, i + 2)
        const newByte = newState.slice(i, i + 2)
        mergedState += (newByte !== 'ff' ? newByte : currentByte) || 'ff'
      }
      cachedDevice.currentStateHex = mergedState.slice(0, 38) // 19 bytes = 38 hex chars
    }
  }

  /**
   * Make an authenticated GET request.
   */
  private async authenticatedFetch<T>(endpoint: string): Promise<T | null> {
    if (!this.accessToken) {
      throw new ToshibaAuthError('Not authenticated. Call login() first.')
    }

    const url = `${TOSHIBA_API.BASE_URL}${endpoint}`
    this.log('Fetch:', url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')

        if (response.status === 401) {
          this.accessToken = null
          throw new ToshibaAuthError('Authentication expired', errorText)
        }

        throw new ToshibaError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      const data = await response.json() as ToshibaAPIResponse<T>

      if (!data.IsSuccess) {
        throw new ToshibaError(data.Message || 'API request failed')
      }

      return data.ResObj
    } catch (error) {
      if (error instanceof ToshibaError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ToshibaError('Request timed out')
      }
      throw new ToshibaError(`Request failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Log a debug message.
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[ToshibaClient]', ...args)
    }
  }
}
