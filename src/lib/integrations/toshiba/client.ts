/**
 * Toshiba Home AC Control API Client
 *
 * TypeScript client for the Toshiba Home AC Control API.
 * Based on: https://github.com/KaSroka/Toshiba-AC-control
 *           https://gist.github.com/h4de5/7f97db0f4efc265e48904d4a84dab4fb
 *
 * Usage:
 *   const client = new ToshibaClient()
 *   await client.login(username, password)
 *   const devices = await client.getDevices()
 *   await client.setPowerState(acId, 'ON')
 *   await client.setTemperature(acId, 22)
 */

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

// Hex state byte positions (based on Toshiba AC Control reference)
const STATE_OFFSETS = {
  POWER: 0,
  MODE: 1,
  TEMP: 2,
  FAN: 4,
  SWING: 5,
  PURE: 6,
  INDOOR_TEMP: 11,
  OUTDOOR_TEMP: 12,
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
const FAN_MAP: Record<string, ToshibaFanSpeed> = {
  '31': 'AUTO',
  '32': 'QUIET',
  '33': 'LOW',
  '34': 'MEDIUM_LOW',
  '35': 'MEDIUM',
  '36': 'MEDIUM_HIGH',
  '37': 'HIGH',
}

// Swing mode code mappings
const SWING_MAP: Record<string, ToshibaSwingMode> = {
  '31': 'OFF',
  '41': 'ON',
  '42': 'VERTICAL',
  '43': 'HORIZONTAL',
}

export class ToshibaClient {
  private accessToken: string | null = null
  private consumerId: string | null = null
  private tokenExpiry: number = 0
  private debug: boolean
  private timeout: number

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
      this.tokenExpiry = Date.now() + TOSHIBA_API.TOKEN_VALIDITY_MS - TOSHIBA_API.TOKEN_REFRESH_MARGIN_MS

      this.log('Login successful, consumerId:', this.consumerId)
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
   * Login using existing tokens (for stored credentials).
   */
  loginWithToken(accessToken: string, consumerId: string, expiry?: number): void {
    this.accessToken = accessToken
    this.consumerId = consumerId
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
    this.tokenExpiry = 0
  }

  /**
   * Get current tokens for storage.
   */
  getTokens(): { accessToken: string | null; consumerId: string | null; expiry: number } {
    return {
      accessToken: this.accessToken,
      consumerId: this.consumerId,
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
          devices.push({
            ...device,
            _timezone: group.TimeZone,
          } as ToshibaACDevice & { _timezone: string })
        }
      }
    }

    this.log(`Found ${devices.length} devices across ${groups.length} groups`)
    if (devices.length > 0) {
      this.log('First device:', devices[0].Name, 'ID:', devices[0].Id)
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
   */
  async getMappedDevices(): Promise<MappedToshibaDevice[]> {
    const devices = await this.getDevices()
    return devices.map(device => this.mapDeviceToDb(device))
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
    if (!hexState || hexState.length < 26) {
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
    const getByte = (offset: number): string => hexState.slice(offset * 2, offset * 2 + 2)

    // Power state: 30 = ON, 31 = OFF
    const powerByte = getByte(STATE_OFFSETS.POWER)
    const powerState: ToshibaPowerState | null = powerByte === '30' ? 'ON' : powerByte === '31' ? 'OFF' : null

    // Operation mode: 41=AUTO, 42=COOL, 43=HEAT, 44=DRY, 45=FAN
    const modeByte = getByte(STATE_OFFSETS.MODE)
    const operationMode = MODE_MAP[modeByte] ?? null

    // Target temperature: hex value is the temperature
    const tempByte = getByte(STATE_OFFSETS.TEMP)
    const targetTemperature = tempByte ? parseInt(tempByte, 16) : null

    // Fan speed
    const fanByte = getByte(STATE_OFFSETS.FAN)
    const fanSpeed = FAN_MAP[fanByte] ?? null

    // Swing mode
    const swingByte = getByte(STATE_OFFSETS.SWING)
    const swingMode = SWING_MAP[swingByte] ?? null

    // Pure/ionizer state
    const pureByte = getByte(STATE_OFFSETS.PURE)
    const pureState: 'ON' | 'OFF' | null = pureByte === '10' ? 'ON' : pureByte === '00' ? 'OFF' : null

    // Indoor temperature (offset may vary, using common position)
    const indoorByte = getByte(STATE_OFFSETS.INDOOR_TEMP)
    const indoorTemperature = indoorByte && indoorByte !== 'fe' && indoorByte !== 'ff'
      ? parseInt(indoorByte, 16)
      : null

    // Outdoor temperature
    const outdoorByte = getByte(STATE_OFFSETS.OUTDOOR_TEMP)
    const outdoorTemperature = outdoorByte && outdoorByte !== 'fe' && outdoorByte !== 'ff'
      ? parseInt(outdoorByte, 16) - 128 // Often offset by 128
      : null

    return {
      powerState,
      operationMode,
      targetTemperature,
      fanSpeed,
      swingMode,
      pureState,
      indoorTemperature,
      outdoorTemperature: outdoorTemperature !== null && outdoorTemperature > -50 && outdoorTemperature < 60 ? outdoorTemperature : null,
    }
  }

  // ==========================================================================
  // Control Commands
  // ==========================================================================

  /**
   * Set power state (ON/OFF).
   */
  async setPowerState(acId: string, state: ToshibaPowerState): Promise<void> {
    this.log('Setting power state:', state, 'for device:', acId)
    await this.setACState(acId, { ACPowerState: state })
  }

  /**
   * Set operation mode (AUTO/COOL/HEAT/DRY/FAN).
   */
  async setOperationMode(acId: string, mode: ToshibaOperationMode): Promise<void> {
    this.log('Setting operation mode:', mode, 'for device:', acId)
    await this.setACState(acId, { ACOperationMode: mode })
  }

  /**
   * Set target temperature.
   */
  async setTemperature(acId: string, temperature: number): Promise<void> {
    // Clamp to valid range
    const temp = Math.max(17, Math.min(30, temperature))
    this.log('Setting temperature:', temp, 'for device:', acId)
    await this.setACState(acId, { ACSetpointTemperature: temp })
  }

  /**
   * Set fan speed.
   */
  async setFanSpeed(acId: string, speed: ToshibaFanSpeed): Promise<void> {
    this.log('Setting fan speed:', speed, 'for device:', acId)
    await this.setACState(acId, { ACFanSpeed: speed })
  }

  /**
   * Set swing mode.
   */
  async setSwingMode(acId: string, mode: ToshibaSwingMode): Promise<void> {
    this.log('Setting swing mode:', mode, 'for device:', acId)
    await this.setACState(acId, { ACSwingMode: mode })
  }

  /**
   * Set pure/ionizer state.
   */
  async setPureState(acId: string, state: 'ON' | 'OFF'): Promise<void> {
    this.log('Setting pure state:', state, 'for device:', acId)
    await this.setACState(acId, { ACPureState: state })
  }

  /**
   * Turn AC on with specified mode and temperature.
   */
  async turnOn(
    acId: string,
    mode?: ToshibaOperationMode,
    temperature?: number
  ): Promise<void> {
    const state: Partial<ToshibaACState> = { ACPowerState: 'ON' }
    if (mode) state.ACOperationMode = mode
    if (temperature) state.ACSetpointTemperature = Math.max(17, Math.min(30, temperature))

    this.log('Turning on device:', acId, 'mode:', mode, 'temp:', temperature)
    await this.setACState(acId, state)
  }

  /**
   * Turn AC off.
   */
  async turnOff(acId: string): Promise<void> {
    this.log('Turning off device:', acId)
    await this.setACState(acId, { ACPowerState: 'OFF' })
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
   * Set AC state via API.
   */
  private async setACState(acId: string, state: Partial<ToshibaACState>): Promise<void> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(`${TOSHIBA_API.BASE_URL}${TOSHIBA_ENDPOINTS.SET_STATE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          ACId: acId,
          ...state,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')

        if (response.status === 401) {
          this.accessToken = null
          throw new ToshibaAuthError('Authentication expired', errorText)
        }

        throw new ToshibaError(
          `Set state failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      const data = await response.json() as ToshibaAPIResponse<unknown>

      if (!data.IsSuccess) {
        throw new ToshibaError(data.Message || 'Failed to set AC state')
      }

      this.log('State updated successfully')
    } catch (error) {
      if (error instanceof ToshibaError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ToshibaError('Set state request timed out')
      }
      throw new ToshibaError(`Set state failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
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
