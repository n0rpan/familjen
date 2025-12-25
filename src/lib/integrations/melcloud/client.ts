/**
 * Mitsubishi MELCloud API Client
 *
 * TypeScript client for the MELCloud API.
 * Based on: https://github.com/OlivierZal/melcloud-api
 *           https://github.com/vilppuvuorinen/pymelcloud
 *
 * Usage:
 *   const client = new MelCloudClient()
 *   await client.login(email, password)
 *   const devices = await client.getDevices()
 *   await client.setPowerState(deviceId, buildingId, true)
 *   await client.setTemperature(deviceId, buildingId, 22)
 */

import {
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
  MelCloudError,
  MelCloudAuthError,
  MelCloudDeviceType,
} from './types'
import {
  MELCLOUD_API,
  MELCLOUD_ENDPOINTS,
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

// Device cache to store device info
interface DeviceCache {
  [deviceId: number]: {
    buildingId: number
    currentState: MelCloudATADeviceData | null
  }
}

export class MelCloudClient {
  private contextKey: string | null = null
  private tokenExpiry: number = 0
  private debug: boolean
  private timeout: number

  // Device cache for storing device state
  private deviceCache: DeviceCache = {}

  constructor(options: MelCloudClientOptions = {}) {
    this.debug = options.debug ?? process.env.MELCLOUD_DEBUG === 'true'
    this.timeout = options.timeout ?? MELCLOUD_API.TIMEOUT_MS
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /**
   * Login to MELCloud.
   * Must be called before any other API methods.
   */
  async login(email: string, password: string): Promise<void> {
    const maskedEmail = email.length > 3 ? email.substring(0, 3) + '***' : '***'
    this.log('Logging in as:', maskedEmail)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(`${MELCLOUD_API.BASE_URL}${MELCLOUD_ENDPOINTS.LOGIN}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Email: email,
          Password: password,
          Language: MELCLOUD_API.DEFAULT_LANGUAGE,
          AppVersion: MELCLOUD_API.APP_VERSION,
          Persist: true,
          CaptchaResponse: null,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new MelCloudError(
          `Login request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      const data = await response.json() as MelCloudLoginResponse

      if (data.ErrorId !== null || !data.LoginData?.ContextKey) {
        throw new MelCloudAuthError(
          data.ErrorMessage || 'Invalid email or password',
          data
        )
      }

      this.contextKey = data.LoginData.ContextKey
      this.tokenExpiry = Date.now() + MELCLOUD_API.TOKEN_VALIDITY_MS - MELCLOUD_API.TOKEN_REFRESH_MARGIN_MS

      this.log('Login successful')
    } catch (error) {
      if (error instanceof MelCloudError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MelCloudError('Login request timed out')
      }
      throw new MelCloudError(`Login failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Login using existing context key (for stored credentials).
   */
  loginWithToken(contextKey: string, expiry?: number): void {
    this.contextKey = contextKey
    this.tokenExpiry = expiry ?? Date.now() + MELCLOUD_API.TOKEN_VALIDITY_MS
    this.log('Logged in with existing token')
  }

  /**
   * Check if the client is authenticated.
   */
  isAuthenticated(): boolean {
    return this.contextKey !== null
  }

  /**
   * Check if the token needs refresh.
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
    this.contextKey = null
    this.tokenExpiry = 0
    this.deviceCache = {}
  }

  /**
   * Get current tokens for storage.
   */
  getTokens(): {
    contextKey: string | null
    expiry: number
  } {
    return {
      contextKey: this.contextKey,
      expiry: this.tokenExpiry,
    }
  }

  // ==========================================================================
  // Device Discovery
  // ==========================================================================

  /**
   * Get all registered devices from all buildings.
   */
  async getDevices(): Promise<MelCloudDevice[]> {
    this.log('Fetching devices')

    const buildings = await this.authenticatedFetch<MelCloudBuilding[]>(
      MELCLOUD_ENDPOINTS.LIST_DEVICES
    )

    if (!buildings || buildings.length === 0) {
      this.log('No buildings found')
      return []
    }

    // Extract all ATA (Air-to-Air) devices from buildings
    const devices: MelCloudDevice[] = []

    for (const building of buildings) {
      // Devices at building level
      if (building.Structure.Devices) {
        for (const device of building.Structure.Devices) {
          if (device.Device?.DeviceType === MelCloudDeviceType.AirToAir) {
            devices.push(device)
            this.deviceCache[device.DeviceID] = {
              buildingId: building.ID,
              currentState: device.Device,
            }
          }
        }
      }

      // Devices in floors
      if (building.Structure.Floors) {
        for (const floor of building.Structure.Floors) {
          if (floor.Devices) {
            for (const device of floor.Devices) {
              if (device.Device?.DeviceType === MelCloudDeviceType.AirToAir) {
                devices.push(device)
                this.deviceCache[device.DeviceID] = {
                  buildingId: building.ID,
                  currentState: device.Device,
                }
              }
            }
          }
        }
      }

      // Devices in areas
      if (building.Structure.Areas) {
        for (const area of building.Structure.Areas) {
          if (area.Devices) {
            for (const device of area.Devices) {
              if (device.Device?.DeviceType === MelCloudDeviceType.AirToAir) {
                devices.push(device)
                this.deviceCache[device.DeviceID] = {
                  buildingId: building.ID,
                  currentState: device.Device,
                }
              }
            }
          }
        }
      }
    }

    this.log(`Found ${devices.length} ATA devices across ${buildings.length} buildings`)
    return devices
  }

  /**
   * Get current state of a specific device.
   */
  async getDeviceState(deviceId: number, buildingId: number): Promise<MelCloudATADeviceData> {
    this.log('Fetching device state:', deviceId)

    const data = await this.authenticatedFetch<MelCloudATADeviceData>(
      `${MELCLOUD_ENDPOINTS.GET_DEVICE}?id=${deviceId}&buildingID=${buildingId}`
    )

    if (!data) {
      throw new MelCloudError('Failed to get device state')
    }

    // Update cache
    this.deviceCache[deviceId] = {
      buildingId,
      currentState: data,
    }

    return data
  }

  /**
   * Get all devices mapped to our format.
   */
  async getMappedDevices(): Promise<MappedMelCloudDevice[]> {
    const devices = await this.getDevices()
    return devices.map(device => this.mapDeviceToDb(device))
  }

  // ==========================================================================
  // Control Commands
  // ==========================================================================

  /**
   * Set power state (ON/OFF).
   */
  async setPowerState(deviceId: number, buildingId: number, power: boolean): Promise<void> {
    this.log('Setting power state:', power, 'for device:', deviceId)
    await this.sendCommand(deviceId, buildingId, { Power: power }, EFFECTIVE_FLAGS.POWER)
  }

  /**
   * Set operation mode.
   */
  async setOperationMode(deviceId: number, buildingId: number, mode: MelCloudOperationMode): Promise<void> {
    this.log('Setting operation mode:', mode, 'for device:', deviceId)
    const modeValue = OPERATION_MODE_ENCODE[mode]
    await this.sendCommand(deviceId, buildingId, { OperationMode: modeValue }, EFFECTIVE_FLAGS.OPERATION_MODE)
  }

  /**
   * Set target temperature.
   */
  async setTemperature(deviceId: number, buildingId: number, temperature: number): Promise<void> {
    const temp = Math.max(16, Math.min(31, temperature))
    this.log('Setting temperature:', temp, 'for device:', deviceId)
    await this.sendCommand(deviceId, buildingId, { SetTemperature: temp }, EFFECTIVE_FLAGS.TEMPERATURE)
  }

  /**
   * Set fan speed.
   */
  async setFanSpeed(deviceId: number, buildingId: number, speed: MelCloudFanSpeed): Promise<void> {
    this.log('Setting fan speed:', speed, 'for device:', deviceId)
    const speedValue = FAN_SPEED_ENCODE[speed]
    await this.sendCommand(deviceId, buildingId, { SetFanSpeed: speedValue }, EFFECTIVE_FLAGS.FAN_SPEED)
  }

  /**
   * Set vertical vane position.
   */
  async setVaneVertical(deviceId: number, buildingId: number, position: MelCloudVaneVertical): Promise<void> {
    this.log('Setting vertical vane:', position, 'for device:', deviceId)
    const positionValue = VANE_VERTICAL_ENCODE[position]
    await this.sendCommand(deviceId, buildingId, { VaneVertical: positionValue }, EFFECTIVE_FLAGS.VANE_VERTICAL)
  }

  /**
   * Set horizontal vane position.
   */
  async setVaneHorizontal(deviceId: number, buildingId: number, position: MelCloudVaneHorizontal): Promise<void> {
    this.log('Setting horizontal vane:', position, 'for device:', deviceId)
    const positionValue = VANE_HORIZONTAL_ENCODE[position]
    await this.sendCommand(deviceId, buildingId, { VaneHorizontal: positionValue }, EFFECTIVE_FLAGS.VANE_HORIZONTAL)
  }

  /**
   * Turn AC on with specified settings.
   */
  async turnOn(
    deviceId: number,
    buildingId: number,
    mode?: MelCloudOperationMode,
    temperature?: number
  ): Promise<void> {
    this.log('Turning on device:', deviceId, 'mode:', mode, 'temp:', temperature)

    let flags = EFFECTIVE_FLAGS.POWER
    const updates: Record<string, unknown> = { Power: true }

    if (mode !== undefined) {
      updates.OperationMode = OPERATION_MODE_ENCODE[mode]
      flags |= EFFECTIVE_FLAGS.OPERATION_MODE
    }

    if (temperature !== undefined) {
      updates.SetTemperature = Math.max(16, Math.min(31, temperature))
      flags |= EFFECTIVE_FLAGS.TEMPERATURE
    }

    await this.sendCommand(deviceId, buildingId, updates, flags)
  }

  /**
   * Turn AC off.
   */
  async turnOff(deviceId: number, buildingId: number): Promise<void> {
    this.log('Turning off device:', deviceId)
    await this.sendCommand(deviceId, buildingId, { Power: false }, EFFECTIVE_FLAGS.POWER)
  }

  // ==========================================================================
  // Data Mapping
  // ==========================================================================

  /**
   * Map a MELCloud device to our simplified format.
   */
  mapDeviceToDb(device: MelCloudDevice): MappedMelCloudDevice {
    const data = device.Device

    // Decode values - convert to number for map lookup
    const operationMode = data?.OperationMode !== undefined
      ? OPERATION_MODE_MAP[Number(data.OperationMode)] ?? null
      : null

    const fanSpeed = data?.FanSpeed !== undefined
      ? FAN_SPEED_MAP[Number(data.FanSpeed)] ?? 'AUTO'
      : null

    const vaneVertical = data?.VaneVertical !== undefined
      ? VANE_VERTICAL_MAP[Number(data.VaneVertical)] ?? null
      : null

    const vaneHorizontal = data?.VaneHorizontal !== undefined
      ? VANE_HORIZONTAL_MAP[Number(data.VaneHorizontal)] ?? null
      : null

    return {
      deviceId: device.DeviceID,
      name: device.DeviceName,
      buildingId: device.BuildingID,
      buildingName: device.BuildingName || '',
      floorName: device.FloorName,
      areaName: device.AreaName,
      model: `Type ${data?.ModelType ?? 0}`,
      // Current state
      powerState: data?.Power ? 'ON' : 'OFF',
      operationMode,
      targetTemperature: data?.SetTemperature ?? null,
      currentTemperature: data?.RoomTemperature ?? null,
      outdoorTemperature: data?.HasOutdoorTemperature ? data.OutdoorTemperature : null,
      fanSpeed,
      vaneVertical,
      vaneHorizontal,
      // Capabilities
      numberOfFanSpeeds: data?.NumberOfFanSpeeds ?? 0,
      canCool: data?.CanCool ?? true,
      canHeat: data?.CanHeat ?? true,
      canDry: data?.ModelSupportsDry ?? true,
      hasVaneVertical: data?.ModelSupportsVaneVertical ?? false,
      hasVaneHorizontal: data?.ModelSupportsVaneHorizontal ?? false,
      hasSwing: data?.SwingFunction ?? false,
      hasWideVane: data?.HasWideVane ?? false,
      // Status
      offline: data?.Offline ?? false,
      hasError: device.HasError,
      errorCode: device.ErrorCode,
      wifiSignalStrength: device.WifiSignalStrength,
      // Raw data
      rawData: device,
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Send a command to the device via SetAta.
   */
  private async sendCommand(
    deviceId: number,
    buildingId: number,
    updates: Record<string, unknown>,
    effectiveFlags: number
  ): Promise<void> {
    // Get current device state from cache or fetch it
    let currentState = this.deviceCache[deviceId]?.currentState
    if (!currentState) {
      currentState = await this.getDeviceState(deviceId, buildingId)
    }

    // Build the command payload
    const payload = {
      DeviceID: deviceId,
      EffectiveFlags: effectiveFlags,
      HasPendingCommand: true,
      // Current state values (will be overwritten by updates)
      Power: currentState.Power,
      OperationMode: currentState.OperationMode,
      SetTemperature: currentState.SetTemperature,
      SetFanSpeed: currentState.FanSpeed,
      VaneVertical: currentState.VaneVertical,
      VaneHorizontal: currentState.VaneHorizontal,
      // Apply updates
      ...updates,
    }

    this.log('Sending SetAta command:', JSON.stringify(payload))

    await this.authenticatedPost(MELCLOUD_ENDPOINTS.SET_ATA, payload)

    // Update local cache optimistically
    if (currentState) {
      const updatedState = { ...currentState }
      if ('Power' in updates) updatedState.Power = updates.Power as boolean
      if ('OperationMode' in updates) updatedState.OperationMode = updates.OperationMode as number
      if ('SetTemperature' in updates) updatedState.SetTemperature = updates.SetTemperature as number
      if ('SetFanSpeed' in updates) updatedState.FanSpeed = updates.SetFanSpeed as number
      if ('VaneVertical' in updates) updatedState.VaneVertical = updates.VaneVertical as number
      if ('VaneHorizontal' in updates) updatedState.VaneHorizontal = updates.VaneHorizontal as number

      this.deviceCache[deviceId] = {
        buildingId,
        currentState: updatedState,
      }
    }
  }

  /**
   * Make an authenticated GET request.
   */
  private async authenticatedFetch<T>(endpoint: string): Promise<T | null> {
    if (!this.contextKey) {
      throw new MelCloudAuthError('Not authenticated. Call login() first.')
    }

    const url = `${MELCLOUD_API.BASE_URL}${endpoint}`
    this.log('Fetch:', url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-MitsContextKey': this.contextKey,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')

        if (response.status === 401) {
          this.contextKey = null
          throw new MelCloudAuthError('Authentication expired', errorText)
        }

        throw new MelCloudError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      return await response.json() as T
    } catch (error) {
      if (error instanceof MelCloudError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MelCloudError('Request timed out')
      }
      throw new MelCloudError(`Request failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Make an authenticated POST request.
   */
  private async authenticatedPost<T>(endpoint: string, body: unknown): Promise<T | null> {
    if (!this.contextKey) {
      throw new MelCloudAuthError('Not authenticated. Call login() first.')
    }

    const url = `${MELCLOUD_API.BASE_URL}${endpoint}`
    this.log('Post:', url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-MitsContextKey': this.contextKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')

        if (response.status === 401) {
          this.contextKey = null
          throw new MelCloudAuthError('Authentication expired', errorText)
        }

        throw new MelCloudError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      return await response.json() as T
    } catch (error) {
      if (error instanceof MelCloudError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MelCloudError('Request timed out')
      }
      throw new MelCloudError(`Request failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Log a debug message.
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[MelCloudClient]', ...args)
    }
  }
}
