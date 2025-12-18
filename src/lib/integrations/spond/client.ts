/**
 * Spond API Client
 *
 * Unofficial TypeScript client for the Spond API.
 * Ported from: https://github.com/Olen/Spond
 *
 * Usage:
 *   const client = new SpondClient()
 *   await client.login(email, password)
 *   const groups = await client.getGroups()
 */

import {
  type SpondClientOptions,
  type SpondGroup,
  type SpondEvent,
  type SpondChat,
  type SpondMessage,
  type SpondLoginResponse,
  type SpondChatAuthResponse,
  type GetEventsOptions,
  type GetChatsOptions,
  type MappedSpondEvent,
  type MappedSpondMessage,
  SpondError,
  SpondAuthError,
} from './types'

const API_BASE_URL = 'https://api.spond.com/core/v1/'
const DEFAULT_TIMEOUT = 30000 // 30 seconds

export class SpondClient {
  private token: string | null = null
  private chatUrl: string | null = null
  private chatAuth: string | null = null
  private debug: boolean
  private timeout: number

  constructor(options: SpondClientOptions = {}) {
    this.debug = options.debug ?? process.env.SPOND_DEBUG === 'true'
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /**
   * Login to Spond and obtain an auth token.
   * Must be called before any other API methods.
   */
  async login(email: string, password: string): Promise<void> {
    this.log('Logging in as:', email)

    const response = await this.fetch<SpondLoginResponse>('login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    })

    if (!response.loginToken) {
      throw new SpondAuthError('Login failed: no token received', response)
    }

    this.token = response.loginToken
    this.log('Login successful')
  }

  /**
   * Check if the client is authenticated.
   */
  isAuthenticated(): boolean {
    return this.token !== null
  }

  /**
   * Clear authentication state.
   */
  logout(): void {
    this.token = null
    this.chatUrl = null
    this.chatAuth = null
  }

  // ==========================================================================
  // Groups
  // ==========================================================================

  /**
   * Get all groups the authenticated user belongs to.
   */
  async getGroups(): Promise<SpondGroup[]> {
    this.log('Fetching groups')
    const groups = await this.authenticatedFetch<SpondGroup[]>('groups/')
    this.log(`Found ${groups.length} groups`)
    return groups
  }

  /**
   * Get a specific group by ID.
   */
  async getGroup(groupId: string): Promise<SpondGroup> {
    this.log('Fetching group:', groupId)
    return this.authenticatedFetch<SpondGroup>(`groups/${groupId}`)
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  /**
   * Get events (called "sponds" in the API).
   *
   * @param options - Filter options
   * @returns Array of events
   */
  async getEvents(options: GetEventsOptions = {}): Promise<SpondEvent[]> {
    const params = new URLSearchParams()

    if (options.groupId) {
      params.set('groupId', options.groupId)
    }

    if (options.includeScheduled !== false) {
      params.set('scheduled', 'true')
    }

    if (options.maxEvents) {
      params.set('max', String(options.maxEvents))
    }

    if (options.minEndTimestamp) {
      const date =
        typeof options.minEndTimestamp === 'string'
          ? options.minEndTimestamp
          : options.minEndTimestamp.toISOString()
      params.set('minEndTimestamp', date)
    }

    if (options.maxStartTimestamp) {
      const date =
        typeof options.maxStartTimestamp === 'string'
          ? options.maxStartTimestamp
          : options.maxStartTimestamp.toISOString()
      params.set('maxStartTimestamp', date)
    }

    const query = params.toString()
    const endpoint = query ? `sponds/?${query}` : 'sponds/'

    this.log('Fetching events:', endpoint)
    const events = await this.authenticatedFetch<SpondEvent[]>(endpoint)
    this.log(`Found ${events.length} events`)

    return events
  }

  /**
   * Get a specific event by ID.
   */
  async getEvent(eventId: string): Promise<SpondEvent> {
    this.log('Fetching event:', eventId)
    return this.authenticatedFetch<SpondEvent>(`sponds/${eventId}`)
  }

  // ==========================================================================
  // Chats / Messages
  // ==========================================================================

  /**
   * Initialize chat authentication.
   * Called automatically by getChats() if not already initialized.
   */
  private async initChat(): Promise<void> {
    if (this.chatUrl && this.chatAuth) {
      return
    }

    this.log('Initializing chat authentication')
    // The /chat endpoint requires POST to get auth token
    const response = await this.authenticatedFetch<SpondChatAuthResponse>('chat', 'POST')

    if (!response.url || !response.auth) {
      throw new SpondError('Failed to initialize chat: missing url or auth')
    }

    this.chatUrl = response.url
    this.chatAuth = response.auth
    this.log('Chat initialized:', this.chatUrl)
  }

  /**
   * Get all chats.
   */
  async getChats(options: GetChatsOptions = {}): Promise<SpondChat[]> {
    await this.initChat()

    const params = new URLSearchParams()
    if (options.limit) {
      params.set('max', String(options.limit))
    }

    const query = params.toString()
    const endpoint = query ? `chats/?${query}` : 'chats/'

    this.log('Fetching chats')
    const chats = await this.chatFetch<SpondChat[]>(endpoint)
    this.log(`Found ${chats.length} chats`)

    return chats
  }

  /**
   * Get messages from a specific chat.
   */
  async getChatMessages(
    chatId: string,
    options: { limit?: number } = {}
  ): Promise<SpondMessage[]> {
    await this.initChat()

    const params = new URLSearchParams()
    if (options.limit) {
      params.set('max', String(options.limit))
    }

    const query = params.toString()
    const endpoint = query ? `chats/${chatId}/messages?${query}` : `chats/${chatId}/messages`

    this.log('Fetching messages for chat:', chatId)
    const messages = await this.chatFetch<SpondMessage[]>(endpoint)
    this.log(`Found ${messages.length} messages`)

    return messages
  }

  // ==========================================================================
  // Data Mapping Utilities
  // ==========================================================================

  /**
   * Map a Spond event to our database format.
   */
  static mapEventToDb(event: SpondEvent, groupId: string): MappedSpondEvent {
    const startDate = new Date(event.startTimestamp)
    const endDate = event.endTimestamp ? new Date(event.endTimestamp) : null

    return {
      externalId: event.id,
      externalGroupId: groupId,
      title: event.heading,
      description: event.description || null,
      eventDate: startDate.toISOString().split('T')[0],
      eventTime: startDate.toTimeString().split(' ')[0],
      endDate: endDate ? endDate.toISOString().split('T')[0] : null,
      endTime: endDate ? endDate.toTimeString().split(' ')[0] : null,
      location: event.location?.address || event.location?.feature || null,
      eventType: event.type?.toLowerCase() || null,
      rawData: event,
    }
  }

  /**
   * Map a Spond message to our database format.
   */
  static mapMessageToDb(message: SpondMessage, chatId: string, groupId?: string): MappedSpondMessage {
    return {
      externalId: message.id,
      externalGroupId: groupId || null,
      chatId,
      senderName: message.sender
        ? `${message.sender.firstName} ${message.sender.lastName}`.trim()
        : null,
      title: null, // Messages don't have titles
      body: message.text,
      messageDate: message.timestamp,
      rawData: message,
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Make an authenticated API request, auto-retrying on 401.
   */
  private async authenticatedFetch<T>(endpoint: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
    if (!this.token) {
      throw new SpondAuthError('Not authenticated. Call login() first.')
    }

    try {
      return await this.fetch<T>(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      })
    } catch (error) {
      if (error instanceof SpondAuthError) {
        // Token expired - caller should re-login
        this.token = null
        throw error
      }
      throw error
    }
  }

  /**
   * Make an API request to the chat endpoint.
   */
  private async chatFetch<T>(endpoint: string): Promise<T> {
    if (!this.chatUrl || !this.chatAuth) {
      throw new SpondError('Chat not initialized. Call initChat() first.')
    }

    const url = `${this.chatUrl}/${endpoint}`.replace(/\/+/g, '/').replace(':/', '://')

    this.log('Chat fetch:', url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          auth: this.chatAuth,  // Custom auth header, not Bearer token
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')

        if (response.status === 401) {
          // Chat auth expired - clear it so it will be re-initialized
          this.chatUrl = null
          this.chatAuth = null
          throw new SpondAuthError('Chat authentication expired', errorText)
        }

        throw new SpondError(
          `Chat API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      return response.json() as Promise<T>
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof SpondError) {
        throw error
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SpondError('Chat request timed out')
      }
      throw new SpondError(`Chat request failed: ${error}`)
    }
  }

  /**
   * Make a raw API request.
   */
  private async fetch<T>(
    endpoint: string,
    options: {
      method?: string
      headers?: Record<string, string>
      body?: string
      skipAuth?: boolean
    } = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`
    this.log('Fetch:', options.method || 'GET', url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: options.body,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')

        if (response.status === 401) {
          throw new SpondAuthError('Authentication failed', errorText)
        }

        throw new SpondError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      return response.json() as Promise<T>
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof SpondError) {
        throw error
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SpondError('Request timed out')
      }
      throw new SpondError(`Request failed: ${error}`)
    }
  }

  /**
   * Log a debug message.
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[SpondClient]', ...args)
    }
  }
}
