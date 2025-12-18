/**
 * MyKid API Client
 *
 * TypeScript client for the MyKid.no kindergarten API.
 * Based on HAR analysis and live verification testing.
 *
 * CRITICAL IMPLEMENTATION NOTES:
 * 1. Login requires AJAX headers (Accept: application/json, X-Requested-With: XMLHttpRequest)
 * 2. There are TWO different CSRF tokens:
 *    - Login page: hidden input field
 *    - Dashboard: meta tag
 * 3. Photo JWT tokens are IP-locked - download during same request as login
 *
 * Usage:
 *   const client = new MyKidClient()
 *   await client.login(phone, password)
 *   const children = await client.getChildren()
 *   const events = await client.getCalendarEvents(from, to)
 */

import {
  type MyKidClientOptions,
  type MyKidChild,
  type MyKidCalendarEvent,
  type MyKidNewsletterSummary,
  type MyKidNewsletter,
  type MyKidPhoto,
  type MyKidPhotoJwt,
  type MyKidUnseenCounts,
  type MyKidConversationMessage,
  type MappedMyKidMessage,
  type MappedMyKidEvent,
  MyKidError,
  MyKidAuthError,
  MyKidCsrfError,
} from './types'

const BASE_URL = 'https://mykid.no'
const DEFAULT_TIMEOUT = 30000 // 30 seconds

export class MyKidClient {
  private cookies: Map<string, string> = new Map()
  private csrf: string | null = null
  private dashboardHtml: string | null = null
  private debug: boolean
  private timeout: number

  constructor(options: MyKidClientOptions = {}) {
    this.debug = options.debug ?? process.env.MYKID_DEBUG === 'true'
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
  }

  // ==========================================================================
  // Authentication (3-step process)
  // ==========================================================================

  /**
   * Login to MyKid with phone and password.
   *
   * Three-step process:
   * 1. GET /nb/logg_inn - Extract CSRF from hidden input
   * 2. POST /forside/forside/login - AJAX login with special headers
   * 3. GET /foreldre - Extract new CSRF from meta tag for subsequent requests
   */
  async login(phone: string, password: string): Promise<void> {
    this.log('Logging in as:', phone)

    // Step 1: Get login page for CSRF token
    this.log('Step 1: Fetching login page...')
    const loginPageResponse = await this.fetchWithTimeout(`${BASE_URL}/nb/logg_inn`)

    if (!loginPageResponse.ok) {
      throw new MyKidError(`Failed to fetch login page: ${loginPageResponse.status}`)
    }

    this.updateCookies(loginPageResponse.headers)
    const loginPageHtml = await loginPageResponse.text()

    // Extract CSRF from hidden input: <input type="hidden" name="_csrf_token" value="...">
    const loginCsrf = this.extractCsrfFromHiddenInput(loginPageHtml)
    if (!loginCsrf) {
      throw new MyKidCsrfError('Could not find CSRF token in login page')
    }
    this.log('Found login CSRF:', loginCsrf.substring(0, 20) + '...')

    // Step 2: POST login with AJAX headers (CRITICAL!)
    this.log('Step 2: Posting login...')
    const form = new URLSearchParams()
    form.append('_csrf_token', loginCsrf)
    form.append('pp', '47') // Norway country code
    form.append('m', phone)
    form.append('p', password)

    const loginResponse = await this.fetchWithTimeout(`${BASE_URL}/forside/forside/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.getCookieHeader(),
        Accept: 'application/json', // REQUIRED - without this, server returns CSRF error
        'X-Requested-With': 'XMLHttpRequest', // REQUIRED - identifies as AJAX request
        Origin: BASE_URL,
        Referer: `${BASE_URL}/nb/logg_inn`,
      },
      body: form.toString(),
    })

    this.updateCookies(loginResponse.headers)
    const loginBody = await loginResponse.text()

    // Parse JSON response
    let loginResult: { status: string; message?: string; link?: string }
    try {
      loginResult = JSON.parse(loginBody)
    } catch {
      throw new MyKidAuthError('Invalid login response (not JSON)', loginBody)
    }

    if (loginResult.status !== 'ok') {
      throw new MyKidAuthError(
        loginResult.message || 'Login failed',
        loginBody
      )
    }
    this.log('Login successful, redirect:', loginResult.link)

    // Step 3: Get dashboard for new CSRF token
    this.log('Step 3: Fetching dashboard...')
    const dashboardResponse = await this.fetchWithTimeout(`${BASE_URL}/foreldre`, {
      headers: {
        Cookie: this.getCookieHeader(),
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    if (!dashboardResponse.ok) {
      throw new MyKidError(`Failed to fetch dashboard: ${dashboardResponse.status}`)
    }

    this.updateCookies(dashboardResponse.headers)
    this.dashboardHtml = await dashboardResponse.text()

    // Extract CSRF from meta tag: <meta name="_csrf_token" content="...">
    this.csrf = this.extractCsrfFromMetaTag(this.dashboardHtml)
    if (!this.csrf) {
      throw new MyKidCsrfError('Could not find CSRF token in dashboard')
    }
    this.log('Dashboard CSRF:', this.csrf.substring(0, 20) + '...')
    this.log('Login complete')
  }

  /**
   * Check if the client is authenticated.
   */
  isAuthenticated(): boolean {
    return this.csrf !== null && this.cookies.size > 0
  }

  /**
   * Clear authentication state.
   */
  logout(): void {
    this.cookies.clear()
    this.csrf = null
    this.dashboardHtml = null
  }

  // ==========================================================================
  // Children
  // ==========================================================================

  /**
   * Get children from InfoBus topics.
   * This is the most reliable method to discover child IDs.
   */
  async getChildren(): Promise<MyKidChild[]> {
    this.ensureAuthenticated()
    this.log('Fetching children from InfoBus topics')

    const response = await this.ajaxRequest('GET', `/_ajax/infobus/get_topics?_csrf=${this.csrf}`)

    if (!response.ok) {
      this.log(`get_topics failed with status ${response.status}`)
      throw new MyKidError(`Failed to fetch topics: ${response.status}`)
    }

    const text = await response.text()
    this.log(`get_topics response: ${text.substring(0, 200)}`)

    let topics: string[]
    try {
      topics = JSON.parse(text) as string[]
    } catch {
      this.log('Failed to parse topics as JSON')
      throw new MyKidError('Invalid response from get_topics')
    }

    if (!Array.isArray(topics)) {
      this.log(`Topics is not an array: ${typeof topics}`)
      throw new MyKidError('get_topics returned non-array')
    }

    this.log(`Got ${topics.length} topics: ${topics.join(', ')}`)

    // Extract child IDs from topic patterns like "parent.kid.123456.update"
    const childIds = new Set<number>()
    for (const topic of topics) {
      const match = topic.match(/parent\.kid\.(\d+)\.update/)
      if (match) {
        childIds.add(parseInt(match[1]))
      }
    }

    this.log(`Found ${childIds.size} child IDs from topics`)

    // Try to extract names from dashboard HTML
    const children: MyKidChild[] = []
    for (const id of childIds) {
      const name = this.extractChildNameFromDashboard(id) || `Barn ${id}`
      children.push({ id, name })
    }

    this.log(`Returning ${children.length} children`)
    return children
  }

  /**
   * Extract child name from dashboard HTML by looking near avatar URLs.
   */
  private extractChildNameFromDashboard(childId: number): string | null {
    if (!this.dashboardHtml) return null

    // Look for patterns near the child avatar URL
    // Pattern: /_ajax/image/fetchimage/kid_avatar/{id}/... followed by name
    const patterns = [
      // Look for name in data attributes or nearby text
      new RegExp(`kid_avatar/${childId}/[^"]*"[^>]*>\\s*([^<]+)`, 'i'),
      new RegExp(`data-childid="${childId}"[^>]*>\\s*<[^>]*>\\s*([^<]+)`, 'i'),
    ]

    for (const pattern of patterns) {
      const match = this.dashboardHtml.match(pattern)
      if (match && match[1]?.trim()) {
        return match[1].trim()
      }
    }

    return null
  }

  // ==========================================================================
  // Calendar
  // ==========================================================================

  /**
   * Get calendar events for a date range.
   * This endpoint returns clean JSON!
   */
  async getCalendarEvents(from: Date, to: Date): Promise<MyKidCalendarEvent[]> {
    this.ensureAuthenticated()

    const fromStr = this.formatDate(from)
    const toStr = this.formatDate(to)
    this.log(`Fetching calendar events from ${fromStr} to ${toStr}`)

    const response = await this.ajaxRequest(
      'POST',
      '/_ajax/calendar/fetch_calendar_data',
      `from=${fromStr}&to=${toStr}`
    )

    const events = await response.json() as MyKidCalendarEvent[]
    this.log(`Found ${events.length} calendar events`)
    return events
  }

  // ==========================================================================
  // Newsletters
  // ==========================================================================

  /**
   * Get unseen counts for newsletters.
   */
  async getUnseenCounts(): Promise<MyKidUnseenCounts> {
    this.ensureAuthenticated()

    const response = await this.ajaxRequest('POST', '/_ajax/nyhetsbrev/get_unseen_news')
    const data = await response.json() as Record<string, string>

    return {
      local: parseInt(data.local || '0'),
      su: parseInt(data.su || '0'),
      other: Object.fromEntries(
        Object.entries(data)
          .filter(([k]) => k !== 'local' && k !== 'su')
          .map(([k, v]) => [k, parseInt(v)])
      ),
    }
  }

  /**
   * Get list of newsletters.
   * Returns HTML that needs to be parsed.
   */
  async getNewsletterList(): Promise<MyKidNewsletterSummary[]> {
    this.ensureAuthenticated()
    this.log('Fetching newsletter list')

    const response = await this.ajaxRequest(
      'POST',
      '/_ajax/nyhetsbrev/list_news_letters',
      'filter[page]=alle'
    )

    const html = await response.text()
    return this.parseNewsletterList(html)
  }

  /**
   * Parse newsletter list HTML to extract IDs and titles.
   */
  private parseNewsletterList(html: string): MyKidNewsletterSummary[] {
    const newsletters: MyKidNewsletterSummary[] = []

    // Pattern: onclick="showLocalNews(1977044)" or similar
    const idPattern = /showLocalNews\((\d+)\)/g
    const ids = new Set<number>()
    let match

    while ((match = idPattern.exec(html)) !== null) {
      ids.add(parseInt(match[1]))
    }

    // Also try data attributes
    const dataPattern = /data-newsid="(\d+)"/g
    while ((match = dataPattern.exec(html)) !== null) {
      ids.add(parseInt(match[1]))
    }

    // Try to extract titles for each ID
    for (const id of ids) {
      // Look for title near the ID
      const titlePattern = new RegExp(
        `(?:showLocalNews\\(${id}\\)|data-newsid="${id}")[^>]*>[\\s\\S]*?<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)`,
        'i'
      )
      const titleMatch = html.match(titlePattern)

      // Look for date
      const datePattern = new RegExp(
        `(?:showLocalNews\\(${id}\\)|id="${id}")[\\s\\S]*?(\\d{1,2}\\.\\d{1,2}\\.\\d{4})`,
        'i'
      )
      const dateMatch = html.match(datePattern)

      newsletters.push({
        id,
        title: titleMatch?.[1]?.trim() || `Newsletter ${id}`,
        date: dateMatch?.[1] || '',
      })
    }

    this.log(`Parsed ${newsletters.length} newsletters`)
    return newsletters
  }

  /**
   * Get full newsletter content.
   */
  async getNewsletterContent(newsId: number): Promise<MyKidNewsletter> {
    this.ensureAuthenticated()
    this.log(`Fetching newsletter ${newsId}`)

    const response = await this.ajaxRequest(
      'POST',
      '/_ajax/nyhetsbrev/hent_news_letter_local',
      `newsid=${newsId}`
    )

    const html = await response.text()
    return this.parseNewsletterContent(newsId, html)
  }

  /**
   * Parse newsletter content HTML.
   */
  private parseNewsletterContent(id: number, html: string): MyKidNewsletter {
    // Extract title from h2
    const titleMatch = html.match(/<h2[^>]*class="[^"]*newstitle[^"]*"[^>]*>([^<]+)/i)
      || html.match(/<h2[^>]*>([^<]+)/i)

    // Extract date
    const dateMatch = html.match(/(\d{1,2}\.\d{1,2}\.\d{4})/)

    // Extract attachments
    const attachments: { id: number; filename: string; url: string }[] = []
    const attachPattern = /href="(\/[^"]*fetchimage\/news_att\/(\d+)\/[^"]*)"[^>]*>[\s\S]*?([^<]+\.(?:pdf|doc|docx|xls|xlsx|jpg|png|gif))/gi
    let attMatch

    while ((attMatch = attachPattern.exec(html)) !== null) {
      attachments.push({
        id: parseInt(attMatch[2]),
        url: attMatch[1],
        filename: attMatch[3].trim(),
      })
    }

    // Get content (everything inside the main content div)
    const contentMatch = html.match(/<div[^>]*(?:id="mykid_show_id"|class="[^"]*content[^"]*")[^>]*>([\s\S]*?)<\/div>/i)

    return {
      id,
      title: titleMatch?.[1]?.trim() || `Newsletter ${id}`,
      date: dateMatch?.[1] || '',
      content: contentMatch?.[1]?.trim() || html,
      attachments,
    }
  }

  // ==========================================================================
  // Photos
  // ==========================================================================

  /**
   * Get photo URLs from dashboard HTML.
   * Photos are served from media1.intutor.no with JWT tokens.
   */
  getPhotoUrls(): MyKidPhoto[] {
    if (!this.dashboardHtml) {
      this.log('No dashboard HTML available for photo extraction')
      return []
    }

    const photos: MyKidPhoto[] = []
    const pattern = /https:\/\/media\d*\.intutor\.no\/photo\.php\?t=([^"'\s&]+)/g
    const seen = new Set<string>()
    let urlMatch

    while ((urlMatch = pattern.exec(this.dashboardHtml)) !== null) {
      const token = urlMatch[1]
      if (seen.has(token)) continue
      seen.add(token)

      try {
        const jwt = this.decodePhotoJwt(token)
        photos.push({
          url: `https://media1.intutor.no/photo.php?t=${token}`,
          expiresAt: new Date(jwt.exp * 1000),
          photoId: jwt.name,
          companyId: jwt.companyId,
          date: jwt.date,
        })
      } catch (e) {
        this.log('Failed to decode photo JWT:', e)
      }
    }

    this.log(`Found ${photos.length} photos in dashboard`)
    return photos
  }

  /**
   * Decode photo JWT to extract metadata.
   * Note: Does NOT verify signature, just decodes payload.
   */
  private decodePhotoJwt(token: string): MyKidPhotoJwt {
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format')
    }

    const payload = parts[1]
    // Handle base64url encoding
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4)
    const decoded = Buffer.from(padded, 'base64').toString('utf-8')

    return JSON.parse(decoded) as MyKidPhotoJwt
  }

  /**
   * Download a photo from the CDN.
   * Note: JWT tokens include IP validation - must download from same IP that generated the token!
   */
  async downloadPhoto(photoUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    this.log(`Downloading photo: ${photoUrl.substring(0, 60)}...`)

    // Photos don't need session cookies - JWT is sufficient
    const response = await this.fetchWithTimeout(photoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    })

    if (!response.ok) {
      throw new MyKidError(`Failed to download photo: ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const arrayBuffer = await response.arrayBuffer()

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
    }
  }

  /**
   * Get child avatar.
   */
  async getChildAvatar(childId: number, size: number = 200): Promise<Buffer> {
    this.ensureAuthenticated()
    this.log(`Fetching avatar for child ${childId}`)

    const response = await this.fetchWithTimeout(
      `${BASE_URL}/_ajax/image/fetchimage/kid_avatar/${childId}/${size}`,
      {
        headers: {
          Cookie: this.getCookieHeader(),
        },
      }
    )

    if (!response.ok) {
      throw new MyKidError(`Failed to fetch avatar: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  // ==========================================================================
  // Conversations
  // ==========================================================================

  /**
   * Get conversation messages.
   */
  async getConversation(): Promise<MyKidConversationMessage[]> {
    this.ensureAuthenticated()
    this.log('Fetching conversation')

    const response = await this.ajaxRequest('GET', `/_ajax/kommunikasjon/get_sms_conversation?_csrf=${this.csrf}`)
    const html = await response.text()

    return this.parseConversation(html)
  }

  /**
   * Parse conversation HTML.
   */
  private parseConversation(html: string): MyKidConversationMessage[] {
    const messages: MyKidConversationMessage[] = []

    // Pattern for messages - look for message divs
    const messagePattern = /<div[^>]*class="[^"]*(?:leftcom|rightcom)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    let msgMatch

    while ((msgMatch = messagePattern.exec(html)) !== null) {
      const content = msgMatch[1]

      // Extract sender and text
      const senderMatch = content.match(/class="[^"]*sender[^"]*"[^>]*>([^<]+)/i)
      const textMatch = content.match(/>([^<]+)</g)

      if (textMatch && textMatch.length > 0) {
        messages.push({
          senderName: senderMatch?.[1]?.trim() || 'Unknown',
          content: textMatch.map(t => t.replace(/[><]/g, '')).join(' ').trim(),
          timestamp: new Date(), // Would need better parsing for actual timestamp
          isFromKindergarten: msgMatch[0].includes('leftcom'),
        })
      }
    }

    return messages
  }

  // ==========================================================================
  // Data Mapping Utilities
  // ==========================================================================

  /**
   * Map calendar event to database format.
   */
  static mapCalendarEventToDb(event: MyKidCalendarEvent): MappedMyKidEvent {
    return {
      externalId: event.id,
      externalGroupId: null,
      title: event.title,
      description: event.description,
      eventDate: event.event_at,
      eventTime: null,
      endDate: event.event_until,
      endTime: null,
      eventType: event.class,
      rawData: event,
    }
  }

  /**
   * Map newsletter to database format.
   */
  static mapNewsletterToDb(newsletter: MyKidNewsletter): MappedMyKidMessage {
    return {
      externalId: `newsletter_${newsletter.id}`,
      externalGroupId: null,
      chatId: null,
      senderName: null,
      title: newsletter.title,
      body: newsletter.content,
      messageDate: MyKidClient.parseNorwegianDate(newsletter.date)?.toISOString() || new Date().toISOString(),
      sourceType: 'newsletter',
      rawData: newsletter,
    }
  }

  /**
   * Parse Norwegian date format (dd.mm.yyyy).
   */
  static parseNorwegianDate(dateStr: string): Date | null {
    if (!dateStr) return null

    const result = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
    if (!result) return null

    const [, day, month, year] = result
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Make an AJAX request with proper headers.
   */
  private async ajaxRequest(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: string
  ): Promise<Response> {
    this.ensureAuthenticated()

    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`
    const hasQuery = url.includes('?')

    // For GET requests, append CSRF to query string if not already there
    let finalUrl = url
    if (method === 'GET' && !url.includes('_csrf=')) {
      finalUrl = `${url}${hasQuery ? '&' : '?'}_csrf=${this.csrf}`
    }

    const response = await this.fetchWithTimeout(finalUrl, {
      method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.getCookieHeader(),
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${BASE_URL}/foreldre`,
      },
      body: method === 'POST' ? `${body || ''}&_csrf=${this.csrf}` : undefined,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      if (text.includes('CSRF') || response.status === 403) {
        throw new MyKidCsrfError(`CSRF error on ${endpoint}`)
      }
      throw new MyKidError(`Request failed: ${response.status}`, response.status, text)
    }

    return response
  }

  /**
   * Ensure client is authenticated.
   */
  private ensureAuthenticated(): void {
    if (!this.csrf) {
      throw new MyKidAuthError('Not authenticated. Call login() first.')
    }
  }

  /**
   * Fetch with timeout support.
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MyKidError('Request timed out')
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Update cookies from response headers.
   */
  private updateCookies(headers: Headers): void {
    try {
      // Use getSetCookie() for Node.js 18+ (works in Vercel)
      const setCookies = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
        || [headers.get('set-cookie')].filter(Boolean) as string[]

      for (const cookieStr of setCookies) {
        if (!cookieStr) continue

        // Handle multiple cookies (comma-separated, but watch for dates like "Mon, 18 Dec")
        const parts = cookieStr.split(/,(?=\s*[^;]+=)/)

        for (const part of parts) {
          const nameValue = part.trim().split(';')[0]
          const [name, value] = nameValue.split('=')
          if (name && value) {
            this.cookies.set(name.trim(), value)
          }
        }
      }
    } catch (e) {
      this.log('Failed to parse cookies:', e)
    }
  }

  /**
   * Get cookie header string.
   */
  private getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }

  /**
   * Extract CSRF token from hidden input field.
   */
  private extractCsrfFromHiddenInput(html: string): string | null {
    const result = html.match(/name="_csrf_token"\s+value="([^"]+)"/i)
      || html.match(/value="([^"]+)"\s+name="_csrf_token"/i)
    return result?.[1] || null
  }

  /**
   * Extract CSRF token from meta tag.
   */
  private extractCsrfFromMetaTag(html: string): string | null {
    const result = html.match(/<meta\s+name="_csrf_token"\s+content="([^"]+)"/i)
      || html.match(/<meta\s+content="([^"]+)"\s+name="_csrf_token"/i)
    return result?.[1] || null
  }

  /**
   * Format date as YYYY-MM-DD.
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]
  }

  /**
   * Log debug message.
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[MyKidClient]', ...args)
    }
  }
}
