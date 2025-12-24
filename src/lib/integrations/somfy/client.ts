/**
 * Somfy/Overkiz API Client
 *
 * TypeScript client for the Overkiz API used by Somfy TaHoma, Connexoon, etc.
 * Based on: https://github.com/iMicknl/python-overkiz-api
 *
 * Usage:
 *   const client = new SomfyClient()
 *   await client.login(email, password)
 *   const devices = await client.getDevices()
 *   await client.execute(deviceUrl, 'open')
 */

import {
  type SomfyClientOptions,
  type OverkizServer,
  type OverkizServerConfig,
  type OverkizTokenResponse,
  type OverkizSetup,
  type OverkizDevice,
  type OverkizGateway,
  type OverkizCommand,
  type OverkizExecutionRequest,
  type MappedSomfyDevice,
  OVERKIZ_SERVERS,
  SomfyError,
  SomfyAuthError,
  isSupportedDevice,
} from './types'
import { SOMFY_API } from './constants'

export class SomfyClient {
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiry: number = 0
  private serverConfig: OverkizServerConfig
  private debug: boolean
  private timeout: number

  constructor(options: SomfyClientOptions = {}) {
    const server: OverkizServer = options.server ?? 'somfy_europe'
    this.serverConfig = OVERKIZ_SERVERS[server]
    this.debug = options.debug ?? process.env.SOMFY_DEBUG === 'true'
    this.timeout = options.timeout ?? SOMFY_API.TIMEOUT_MS
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /**
   * Login to Somfy/Overkiz using OAuth.
   * Must be called before any other API methods.
   */
  async login(email: string, password: string): Promise<void> {
    const maskedEmail = email.length > 3 ? email.substring(0, 3) + '***' : '***'
    this.log('Logging in as:', maskedEmail)

    // Get OAuth token using password grant
    const tokenResponse = await this.getOAuthToken(email, password)

    // Use the OAuth access token directly for API calls
    this.accessToken = tokenResponse.access_token
    this.refreshToken = tokenResponse.refresh_token
    this.tokenExpiry = Date.now() + (tokenResponse.expires_in * 1000) - SOMFY_API.TOKEN_REFRESH_MARGIN_MS

    this.log('Login successful')
  }

  /**
   * Login using an existing token (for stored credentials).
   */
  loginWithToken(accessToken: string, refreshToken?: string, expiry?: number): void {
    this.accessToken = accessToken
    this.refreshToken = refreshToken ?? null
    this.tokenExpiry = expiry ?? Date.now() + 3600000 // Default 1 hour
    this.log('Logged in with existing token')
  }

  /**
   * Check if the client is authenticated.
   */
  isAuthenticated(): boolean {
    return this.accessToken !== null
  }

  /**
   * Check if the token needs refresh.
   */
  needsRefresh(): boolean {
    return Date.now() >= this.tokenExpiry
  }

  /**
   * Refresh the access token using the refresh token.
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new SomfyAuthError('No refresh token available')
    }

    this.log('Refreshing access token')

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.serverConfig.clientId,
      client_secret: this.serverConfig.clientSecret,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(this.serverConfig.authEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new SomfyAuthError('Token refresh failed', errorText)
      }

      const tokenResponse = await response.json() as OverkizTokenResponse

      this.accessToken = tokenResponse.access_token
      this.refreshToken = tokenResponse.refresh_token
      this.tokenExpiry = Date.now() + (tokenResponse.expires_in * 1000) - SOMFY_API.TOKEN_REFRESH_MARGIN_MS

      this.log('Token refreshed successfully')
    } catch (error) {
      if (error instanceof SomfyError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SomfyError('Token refresh timed out')
      }
      throw new SomfyError(`Token refresh failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Get the token expiry time (for caching purposes).
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
    this.refreshToken = null
    this.tokenExpiry = 0
  }

  /**
   * Get current tokens for storage.
   */
  getTokens(): { accessToken: string | null; refreshToken: string | null; expiry: number } {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiry: this.tokenExpiry,
    }
  }

  // ==========================================================================
  // Setup / Devices
  // ==========================================================================

  /**
   * Get the full setup including all devices and gateways.
   */
  async getSetup(): Promise<OverkizSetup> {
    this.log('Fetching setup')
    return this.authenticatedFetch<OverkizSetup>('setup')
  }

  /**
   * Get all gateways.
   */
  async getGateways(): Promise<OverkizGateway[]> {
    this.log('Fetching gateways')
    return this.authenticatedFetch<OverkizGateway[]>('setup/gateways')
  }

  /**
   * Get all devices.
   */
  async getDevices(): Promise<OverkizDevice[]> {
    this.log('Fetching devices')
    return this.authenticatedFetch<OverkizDevice[]>('setup/devices')
  }

  /**
   * Get a specific device by URL.
   */
  async getDevice(deviceUrl: string): Promise<OverkizDevice> {
    const encodedUrl = encodeURIComponent(deviceUrl)
    this.log('Fetching device:', deviceUrl)
    return this.authenticatedFetch<OverkizDevice>(`setup/devices/${encodedUrl}`)
  }

  /**
   * Refresh states for a specific device.
   */
  async refreshDeviceStates(deviceUrl: string): Promise<void> {
    const encodedUrl = encodeURIComponent(deviceUrl)
    this.log('Refreshing device states:', deviceUrl)
    await this.authenticatedFetch(`setup/devices/${encodedUrl}/states/refresh`, 'POST')
  }

  /**
   * Get supported devices (blinds, screens, etc.) mapped to our format.
   */
  async getSupportedDevices(): Promise<MappedSomfyDevice[]> {
    const devices = await this.getDevices()
    return devices
      .filter(isSupportedDevice)
      .map(device => this.mapDeviceToDb(device))
  }

  // ==========================================================================
  // Commands / Execution
  // ==========================================================================

  /**
   * Execute a command on a device.
   *
   * Common commands:
   * - 'open' / 'close' / 'stop'
   * - 'setClosure' with parameter 0-100 (0=open, 100=closed)
   * - 'setPosition' with parameter 0-100
   * - 'my' - Go to favorite position
   */
  async execute(
    deviceUrl: string,
    command: string,
    parameters?: (string | number | boolean)[]
  ): Promise<string> {
    this.log('Executing command:', command, 'on device:', deviceUrl)

    const request: OverkizExecutionRequest = {
      label: `Familjen: ${command}`,
      actions: [
        {
          deviceURL: deviceUrl,
          commands: [
            {
              name: command,
              parameters: parameters,
            },
          ],
        },
      ],
    }

    const response = await this.authenticatedFetch<{ execId: string }>(
      'exec/apply',
      'POST',
      request
    )

    this.log('Execution started:', response.execId)
    return response.execId
  }

  /**
   * Execute multiple commands on multiple devices.
   */
  async executeMultiple(
    actions: Array<{
      deviceUrl: string
      command: string
      parameters?: (string | number | boolean)[]
    }>,
    label?: string
  ): Promise<string> {
    this.log('Executing multiple commands:', actions.length)

    const request: OverkizExecutionRequest = {
      label: label ?? 'Familjen: Multiple commands',
      actions: actions.map(action => ({
        deviceURL: action.deviceUrl,
        commands: [
          {
            name: action.command,
            parameters: action.parameters,
          },
        ],
      })),
    }

    const response = await this.authenticatedFetch<{ execId: string }>(
      'exec/apply',
      'POST',
      request
    )

    this.log('Execution started:', response.execId)
    return response.execId
  }

  /**
   * Stop all running executions.
   */
  async stopAllExecutions(): Promise<void> {
    this.log('Stopping all executions')
    await this.authenticatedFetch('exec/current/setup', 'DELETE')
  }

  /**
   * Convenience method: Open a device (blind, screen, etc.)
   */
  async open(deviceUrl: string): Promise<string> {
    return this.execute(deviceUrl, 'open')
  }

  /**
   * Convenience method: Close a device (blind, screen, etc.)
   */
  async close(deviceUrl: string): Promise<string> {
    return this.execute(deviceUrl, 'close')
  }

  /**
   * Convenience method: Stop a device
   */
  async stop(deviceUrl: string): Promise<string> {
    return this.execute(deviceUrl, 'stop')
  }

  /**
   * Convenience method: Set position (0 = open, 100 = closed)
   */
  async setPosition(deviceUrl: string, position: number): Promise<string> {
    const clamped = Math.max(0, Math.min(100, Math.round(position)))
    return this.execute(deviceUrl, 'setClosure', [clamped])
  }

  /**
   * Convenience method: Go to favorite position ("my" button)
   */
  async goToFavorite(deviceUrl: string): Promise<string> {
    return this.execute(deviceUrl, 'my')
  }

  // ==========================================================================
  // Data Mapping
  // ==========================================================================

  /**
   * Map an Overkiz device to our simplified format.
   */
  mapDeviceToDb(device: OverkizDevice): MappedSomfyDevice {
    // Extract position from states
    let position: number | undefined
    const closureState = device.states?.find(s =>
      s.name === 'core:ClosureState' ||
      s.name === 'core:TargetClosureState' ||
      s.name === 'core:DeploymentState'
    )
    if (closureState && typeof closureState.value === 'number') {
      position = closureState.value
    }

    // Get available commands
    const commands = device.definition?.commands?.map(c => c.commandName) ?? []

    return {
      deviceUrl: device.deviceURL,
      label: device.label,
      uiClass: device.uiClass,
      controllableName: device.controllableName,
      available: device.available,
      position,
      commands,
      rawData: device,
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Get OAuth token using password grant.
   */
  private async getOAuthToken(email: string, password: string): Promise<OverkizTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'password',
      username: email,
      password: password,
      client_id: this.serverConfig.clientId,
      client_secret: this.serverConfig.clientSecret,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(this.serverConfig.authEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')

        if (response.status === 400 || response.status === 401) {
          throw new SomfyAuthError('Invalid email or password', errorText)
        }

        throw new SomfyError(
          `OAuth request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      return response.json() as Promise<OverkizTokenResponse>
    } catch (error) {
      if (error instanceof SomfyError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SomfyError('OAuth request timed out')
      }
      throw new SomfyError(`OAuth request failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Make an authenticated API request.
   */
  private async authenticatedFetch<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: unknown
  ): Promise<T> {
    if (!this.accessToken) {
      throw new SomfyAuthError('Not authenticated. Call login() first.')
    }

    const url = `${this.serverConfig.apiEndpoint}${endpoint}`
    this.log('Fetch:', method, url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      }

      const options: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      }

      if (body) {
        options.body = JSON.stringify(body)
      }

      const response = await fetch(url, options)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')

        if (response.status === 401) {
          this.accessToken = null
          throw new SomfyAuthError('Authentication expired', errorText)
        }

        throw new SomfyError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      // Handle empty responses
      const text = await response.text()
      if (!text) {
        return {} as T
      }

      return JSON.parse(text) as T
    } catch (error) {
      if (error instanceof SomfyError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SomfyError('Request timed out')
      }
      throw new SomfyError(`Request failed: ${error}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Log a debug message.
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[SomfyClient]', ...args)
    }
  }
}
