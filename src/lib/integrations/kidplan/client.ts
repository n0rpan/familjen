/**
 * Kidplan API Client
 *
 * TypeScript client for the Kidplan (kindergarten) API.
 * Based on HAR analysis and PoC testing.
 *
 * Usage:
 *   const client = new KidplanClient()
 *   const session = await client.login(email, password)
 *   const children = await client.getChildren()
 */

import {
  type KidplanClientOptions,
  type KidplanKindergarten,
  type KidplanSession,
  type KidplanChildrenResponse,
  type KidplanBoardResponse,
  type KidplanConversation,
  type KidplanMessage,
  type KidplanDailyLogResponse,
  type KidplanPhotoInfo,
  type MappedKidplanMessage,
  type MappedKidplanPhoto,
  KidplanError,
  KidplanAuthError,
} from './types'

const BASE_URL = 'https://app.kidplan.com'
const IMG_BASE_URL = 'https://img.kidplan.com'
const DEFAULT_TIMEOUT = 30000 // 30 seconds

export class KidplanClient {
  private sessionCookie: string | null = null
  private kindergartenId: number | null = null
  private kindergartenName: string | null = null
  private debug: boolean
  private timeout: number

  constructor(options: KidplanClientOptions = {}) {
    this.debug = options.debug ?? process.env.KIDPLAN_DEBUG === 'true'
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
  }

  // ==========================================================================
  // Authentication (2-step process)
  // ==========================================================================

  /**
   * Get available kindergartens for a user.
   * This is step 1 of authentication.
   */
  async getKindergartens(email: string, password: string): Promise<KidplanKindergarten[]> {
    this.log('Getting kindergartens for:', email)

    const url = `${BASE_URL}/Account/GetKinderGartenIds?username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new KidplanAuthError(`Failed to get kindergartens: ${response.status}`, text)
    }

    const kindergartens = await response.json() as KidplanKindergarten[]
    this.log(`Found ${kindergartens.length} kindergartens`)

    return kindergartens
  }

  /**
   * Login to Kidplan with a specific kindergarten.
   * This is step 2 of authentication.
   */
  async login(email: string, password: string, kindergartenId?: number): Promise<KidplanSession> {
    this.log('Logging in as:', email)

    // Step 1: Get kindergartens
    const kindergartens = await this.getKindergartens(email, password)

    if (!kindergartens || kindergartens.length === 0) {
      throw new KidplanAuthError('No kindergartens found for this user')
    }

    // Select kindergarten (use provided ID or first one)
    const kindergarten = kindergartenId
      ? kindergartens.find(k => k.Id === kindergartenId) || kindergartens[0]
      : kindergartens[0]

    if (!kindergarten.UserIsActive) {
      throw new KidplanAuthError(`User is not active at ${kindergarten.Name}`)
    }

    this.log(`Logging into kindergarten: ${kindergarten.Name} (ID: ${kindergarten.Id})`)

    // Step 2: Login with selected kindergarten
    const loginUrl = `${BASE_URL}/LogOn?kid=${kindergarten.Id}`
    const body = `UserName=${encodeURIComponent(email)}&Password=${encodeURIComponent(password)}&RememberMe=true&RememberMe=false`

    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      body,
      redirect: 'manual',
    })

    // Extract session cookie from response
    // Note: In serverless environments, we need to handle multiple Set-Cookie headers
    let sessionCookie: string | null = null

    // Try getSetCookie() first (works in Node.js 18+ and modern runtimes)
    const setCookieHeaders = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
      || [response.headers.get('set-cookie')].filter(Boolean) as string[]

    this.log('Set-Cookie headers:', setCookieHeaders.length)

    for (const cookieStr of setCookieHeaders) {
      if (!cookieStr) continue

      // Handle multiple cookies in one header (comma-separated, but watch for dates)
      // Split carefully - dates have commas like "Mon, 18 Dec 2025"
      const cookieParts = cookieStr.split(/,(?=\s*[^;]+=)/)

      for (const part of cookieParts) {
        if (part.includes('.ASPXAUTH')) {
          // Extract just the cookie name=value part
          sessionCookie = part.trim().split(';')[0]
          this.log('Found .ASPXAUTH cookie')
          break
        }
      }
      if (sessionCookie) break
    }

    if (!sessionCookie) {
      this.log('Available headers:', [...response.headers.entries()])
      throw new KidplanAuthError('Login failed: no session cookie received. Headers: ' + JSON.stringify([...response.headers.entries()]))
    }

    this.sessionCookie = sessionCookie
    this.kindergartenId = kindergarten.Id
    this.kindergartenName = kindergarten.Name

    this.log('Login successful')

    return {
      cookie: sessionCookie,
      kindergartenId: kindergarten.Id,
      kindergartenName: kindergarten.Name,
    }
  }

  /**
   * Restore session from saved credentials.
   */
  restoreSession(session: KidplanSession): void {
    this.sessionCookie = session.cookie
    this.kindergartenId = session.kindergartenId
    this.kindergartenName = session.kindergartenName
  }

  /**
   * Check if the client is authenticated.
   */
  isAuthenticated(): boolean {
    return this.sessionCookie !== null
  }

  /**
   * Clear authentication state.
   */
  logout(): void {
    this.sessionCookie = null
    this.kindergartenId = null
    this.kindergartenName = null
  }

  // ==========================================================================
  // Children
  // ==========================================================================

  /**
   * Get all children for the authenticated user.
   */
  async getChildren(): Promise<KidplanChildrenResponse> {
    this.log('Fetching children')

    const response = await this.authenticatedFetch<KidplanChildrenResponse>(
      '/ChildPage/GetChildrenInfo/',
      'POST'
    )

    this.log(`Found ${response.ChildList.length} children`)
    return response
  }

  // ==========================================================================
  // Board Posts (Tavla)
  // ==========================================================================

  /**
   * Get board posts and latest pictures.
   */
  async getBoardPosts(unitId = -1): Promise<KidplanBoardResponse> {
    this.log('Fetching board posts')

    // First set unit predicate
    await this.authenticatedFetch(`/Board/SetUnitPredicateListAsSingle/?unitId=${unitId}`)

    // Then get posts
    const response = await this.authenticatedFetch<KidplanBoardResponse>(
      '/Board/GetBoardPosts/',
      'POST',
      JSON.stringify({ groupId: -1 })
    )

    this.log(`Found ${response.BoardPosts?.length || 0} posts, ${response.LatestPictures?.length || 0} pictures`)
    return response
  }

  // ==========================================================================
  // Conversations
  // ==========================================================================

  /**
   * Get conversations list.
   */
  async getConversations(take = 20, skip = 0): Promise<KidplanConversation[]> {
    this.log('Fetching conversations')

    const response = await this.authenticatedFetch<KidplanConversation[]>(
      `/Conversation/GetConversations/?take=${take}&skip=${skip}`
    )

    this.log(`Found ${response.length} conversations`)
    return response
  }

  /**
   * Get messages in a conversation.
   */
  async getMessages(conversationId: number, take = 20, skip = 0): Promise<KidplanMessage[]> {
    this.log(`Fetching messages for conversation ${conversationId}`)

    const response = await this.authenticatedFetch<KidplanMessage[]>(
      `/Conversation/GetMessages/?conversationId=${conversationId}&take=${take}&skip=${skip}`
    )

    this.log(`Found ${response.length} messages`)
    return response
  }

  /**
   * Get unread message count.
   */
  async getUnreadCount(): Promise<number> {
    const response = await this.authenticatedFetch<number>(
      '/conversation/GetUnreadMessageCount/'
    )
    return response
  }

  // ==========================================================================
  // Daily Log
  // ==========================================================================

  /**
   * Get daily status entries for a child.
   */
  async getDailyLog(childId: number, year?: number, month?: number): Promise<KidplanDailyLogResponse> {
    const now = new Date()
    const y = year ?? now.getFullYear()
    const m = month ?? now.getMonth() + 1 // 1-indexed

    this.log(`Fetching daily log for child ${childId}, ${y}-${m}`)

    const response = await this.authenticatedFetch<KidplanDailyLogResponse>(
      '/Information/GetStatusesFromChild/',
      'POST',
      JSON.stringify({ _childId: childId, year: y, month: m })
    )

    this.log(`Found ${response.Days?.length || 0} day entries`)
    return response
  }

  // ==========================================================================
  // Photos
  // ==========================================================================

  /**
   * Extract photo URLs from the latest pictures page.
   * Returns photo info with URLs that can be fetched directly.
   */
  async getLatestPhotos(): Promise<KidplanPhotoInfo[]> {
    this.log('Fetching latest photos page')

    const response = await fetch(`${BASE_URL}/bilder/nyeste-bilder`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Cookie: this.sessionCookie || '',
      },
    })

    if (!response.ok) {
      throw new KidplanError(`Failed to fetch photos page: ${response.status}`)
    }

    const html = await response.text()

    // Extract image URLs from HTML
    // Format: https://img.kidplan.com/albumpicture/?id=xxx.jpeg&token=yyy
    const imgMatches = html.match(
      /https:\/\/img\.kidplan\.com\/albumpicture\/\?id=[a-f0-9-]+\.[a-z]+&amp;token=[A-Za-z0-9=+/]+/g
    )

    const photos: KidplanPhotoInfo[] = []

    if (imgMatches) {
      const seen = new Set<string>()

      for (let url of imgMatches) {
        // Decode HTML entities
        url = url.replace(/&amp;/g, '&')

        const idMatch = url.match(/id=([^&]+)/)
        const tokenMatch = url.match(/token=([^&"'\s]+)/)

        if (idMatch && tokenMatch && !seen.has(idMatch[1])) {
          seen.add(idMatch[1])
          photos.push({
            id: idMatch[1],
            token: tokenMatch[1],
            fullUrl: url,
          })
        }
      }
    }

    this.log(`Found ${photos.length} unique photos`)
    return photos
  }

  /**
   * Fetch a photo as a buffer.
   * The URL must include the token from getLatestPhotos().
   */
  async fetchPhoto(photoUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    this.log(`Fetching photo: ${photoUrl.substring(0, 60)}...`)

    const response = await fetch(photoUrl)

    if (!response.ok) {
      throw new KidplanError(`Failed to fetch photo: ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const arrayBuffer = await response.arrayBuffer()

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
    }
  }

  // ==========================================================================
  // Data Mapping Utilities
  // ==========================================================================

  /**
   * Parse Microsoft JSON date format or ISO date string.
   * Format: /Date(1677754800000)/ or ISO string
   */
  static parseMicrosoftDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr) return null
    const match = dateStr.match(/\/Date\((-?\d+)\)\//)
    if (match) {
      return new Date(parseInt(match[1]))
    }
    // Try parsing as ISO date or other format
    return new Date(dateStr)
  }

  /**
   * Map a board post to our database format.
   */
  static mapBoardPostToDb(post: KidplanBoardResponse['BoardPosts'][0], kindergartenId: number): MappedKidplanMessage {
    return {
      externalId: `boardpost_${post.PostId}`,
      externalGroupId: String(kindergartenId),
      chatId: null,
      senderName: post.AuthorName || null,
      title: post.Title || null,
      body: post.Content || '',
      messageDate: KidplanClient.parseMicrosoftDate(post.Created)?.toISOString() || new Date().toISOString(),
      sourceType: 'board_post',
      rawData: post,
    }
  }

  /**
   * Map a conversation message to our database format.
   */
  static mapMessageToDb(message: KidplanMessage, kindergartenId: number): MappedKidplanMessage {
    return {
      externalId: `message_${message.MessageId}`,
      externalGroupId: String(kindergartenId),
      chatId: String(message.ConversationId),
      senderName: message.SenderName || null,
      title: null,
      body: message.Body || '',
      messageDate: KidplanClient.parseMicrosoftDate(message.Created)?.toISOString() || new Date().toISOString(),
      sourceType: 'conversation',
      rawData: message,
    }
  }

  /**
   * Map a photo to our database format.
   */
  static mapPhotoToDb(picture: KidplanBoardResponse['LatestPictures'][0]): MappedKidplanPhoto {
    return {
      externalId: picture.PictureId,
      title: picture.AlbumName || null,
      takenAt: KidplanClient.parseMicrosoftDate(picture.Created)?.toISOString() || null,
      albumName: picture.AlbumName || null,
      sourceUrl: `${IMG_BASE_URL}/albumpicture/?id=${picture.PictureId}`,
      rawData: picture,
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Make an authenticated API request.
   */
  private async authenticatedFetch<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: string
  ): Promise<T> {
    if (!this.sessionCookie) {
      throw new KidplanAuthError('Not authenticated. Call login() first.')
    }

    const url = `${BASE_URL}${endpoint}`
    this.log(`${method} ${endpoint}`)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json;charset=UTF-8',
          Cookie: this.sessionCookie,
        },
        body,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')

        if (response.status === 401 || response.status === 302) {
          // Session expired - clear it
          this.sessionCookie = null
          throw new KidplanAuthError('Session expired', errorText)
        }

        throw new KidplanError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      return response.json() as Promise<T>
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof KidplanError) {
        throw error
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new KidplanError('Request timed out')
      }
      throw new KidplanError(`Request failed: ${error}`)
    }
  }

  /**
   * Log a debug message.
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[KidplanClient]', ...args)
    }
  }
}
