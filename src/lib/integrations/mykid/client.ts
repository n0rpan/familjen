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
import { sanitizeDate } from '@/lib/sanitize'

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
    // Mask phone in logs to prevent credential exposure
    const maskedPhone = phone.length > 4 ? phone.substring(0, 4) + '***' : '***'
    this.log('Logging in as:', maskedPhone)

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

    // Try to extract names - first from dashboard, then from newsletter page
    const children: MyKidChild[] = []
    let needsNewsletterFetch = false

    for (const id of childIds) {
      const name = this.extractChildNameFromHtml(id, this.dashboardHtml)
      if (name) {
        children.push({ id, name })
      } else {
        needsNewsletterFetch = true
        children.push({ id, name: '' }) // Placeholder
      }
    }

    // If we couldn't find names in dashboard, try fetching newsletter page
    if (needsNewsletterFetch) {
      this.log('Names not found in dashboard, fetching newsletter page...')
      try {
        const newsletterRes = await this.ajaxRequest('GET', '/nyhetsbrev')
        if (newsletterRes.ok) {
          const newsletterHtml = await newsletterRes.text()
          this.log(`Newsletter page fetched: ${newsletterHtml.length} bytes`)

          // Try to extract names from newsletter page
          for (const child of children) {
            if (!child.name) {
              const name = this.extractChildNameFromHtml(child.id, newsletterHtml)
              child.name = name || `Barn ${child.id}`
            }
          }
        }
      } catch (e) {
        this.log(`Failed to fetch newsletter page: ${e}`)
      }
    }

    // Ensure all children have names
    for (const child of children) {
      if (!child.name) {
        child.name = `Barn ${child.id}`
      }
    }

    this.log(`Returning ${children.length} children: ${children.map((c) => c.name).join(', ')}`)
    return children
  }

  /**
   * Extract child name from HTML by looking for various patterns.
   */
  private extractChildNameFromHtml(childId: number, html: string | null): string | null {
    if (!html) return null

    const patterns = [
      // Pattern from newsletter: kid_avatar/123/50" /> <span class="dep-name">  Name  </span>
      new RegExp(`kid_avatar/${childId}/[^>]*>\\s*<span[^>]*class="dep-name"[^>]*>\\s*([^<]+)`, 'i'),
      // Alternative dep-name pattern: just find dep-name near the child ID
      new RegExp(`${childId}[\\s\\S]{0,100}class="dep-name"[^>]*>\\s*([^<]+)`, 'i'),
      // Child switcher dropdown option: <a href="/_ajax/avdelinger/bytt_barn/123/...">Name</a>
      new RegExp(`bytt_barn/${childId}/[^"]*"[^>]*>\\s*([^<]+)`, 'i'),
      // Option or list item with data attribute: data-id="123" or data-kid="123"
      new RegExp(`data-(?:id|kid|child|childid)=["']${childId}["'][^>]*>\\s*([^<]+)`, 'i'),
      // Avatar URL followed by name: kid_avatar/123/...">Name
      new RegExp(`kid_avatar/${childId}/[^"]*"[^>]*>\\s*([^<]+)`, 'i'),
      // Link with child ID in href followed by img then span: href="...123..."...><img ...><span ...>Name
      new RegExp(`href="[^"]*${childId}[^"]*"[^>]*>[\\s\\S]{0,200}<span[^>]*>\\s*([^<]+)`, 'i'),
      // Value attribute: value="123">Name
      new RegExp(`value=["']${childId}["'][^>]*>([^<]+)`, 'i'),
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match && match[1]?.trim()) {
        const name = match[1].trim()
        // Skip if it looks like a number, URL, or HTML
        if (!/^\d+$/.test(name) && !name.includes('/') && !name.includes('<') && name.length > 1) {
          this.log(`Found name for child ${childId}: "${name}"`)
          return name
        }
      }
    }

    // Log a snippet of HTML around the child ID for debugging
    const idx = html.indexOf(String(childId))
    if (idx > -1) {
      const snippet = html.substring(Math.max(0, idx - 50), idx + 200)
      this.log(`Could not extract name for ${childId}. HTML snippet: ${snippet.replace(/\s+/g, ' ').substring(0, 250)}`)
    } else {
      this.log(`Child ID ${childId} not found in HTML`)
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
    this.log(`Newsletter list response: ${html.length} bytes`)

    // Log a sample of the HTML for debugging
    if (html.length > 0) {
      this.log(`Newsletter HTML sample (first 500 chars): ${html.substring(0, 500).replace(/\s+/g, ' ')}`)
    }

    return this.parseNewsletterList(html)
  }

  /**
   * Parse newsletter list HTML to extract IDs and titles.
   */
  private parseNewsletterList(html: string): MyKidNewsletterSummary[] {
    const newsletters: MyKidNewsletterSummary[] = []
    const ids = new Set<number>()
    let match

    // Pattern 1: onclick="showLocalNews(1977044)"
    const pattern1 = /showLocalNews\((\d+)\)/g
    while ((match = pattern1.exec(html)) !== null) {
      ids.add(parseInt(match[1]))
    }
    this.log(`Pattern showLocalNews: found ${ids.size} IDs`)

    // Pattern 2: data-newsid="12345"
    const pattern2 = /data-newsid="(\d+)"/g
    while ((match = pattern2.exec(html)) !== null) {
      ids.add(parseInt(match[1]))
    }
    this.log(`After data-newsid: total ${ids.size} IDs`)

    // Pattern 3: news_id or newsid in any attribute
    const pattern3 = /(?:news_id|newsid)[=:]["']?(\d+)/gi
    while ((match = pattern3.exec(html)) !== null) {
      ids.add(parseInt(match[1]))
    }
    this.log(`After news_id patterns: total ${ids.size} IDs`)

    // Pattern 4: hent_news_letter_local with ID
    const pattern4 = /hent_news_letter_local[^)]*?(\d{5,})/g
    while ((match = pattern4.exec(html)) !== null) {
      ids.add(parseInt(match[1]))
    }
    this.log(`After hent_news_letter_local: total ${ids.size} IDs`)

    // Pattern 5: any 6-7 digit number that looks like a newsletter ID
    // (be careful - only use if we found nothing else)
    if (ids.size === 0) {
      const pattern5 = /["'](\d{6,7})["']/g
      while ((match = pattern5.exec(html)) !== null) {
        ids.add(parseInt(match[1]))
      }
      this.log(`Fallback digit pattern: found ${ids.size} IDs`)
    }

    // Try to extract titles for each ID
    for (const id of ids) {
      // Look for title near the ID
      const titlePattern = new RegExp(
        `(?:showLocalNews\\(${id}\\)|data-newsid="${id}"|["']${id}["'])[^>]*>[\\s\\S]*?<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)`,
        'i'
      )
      const titleMatch = html.match(titlePattern)

      // Look for date
      const datePattern = new RegExp(
        `(?:showLocalNews\\(${id}\\)|id="${id}"|["']${id}["'])[\\s\\S]*?(\\d{1,2}\\.\\d{1,2}\\.\\d{4})`,
        'i'
      )
      const dateMatch = html.match(datePattern)

      newsletters.push({
        id,
        title: titleMatch?.[1]?.trim() || `Newsletter ${id}`,
        date: dateMatch?.[1] || '',
      })
    }

    this.log(`Parsed ${newsletters.length} newsletters from HTML`)
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
   * Get photos from the /foto gallery page.
   * This is where ALL photos are stored, not just recent ones.
   */
  async getPhotoGallery(): Promise<MyKidPhoto[]> {
    this.ensureAuthenticated()

    this.log('Fetching /foto gallery page...')
    const response = await fetch('https://mykid.no/foto', {
      method: 'GET',
      headers: {
        Cookie: this.getCookieHeader(),
        Accept: 'text/html',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      this.log(`/foto request failed: ${response.status}`)
      return []
    }

    const html = await response.text()
    this.log(`/foto page size: ${html.length} bytes`)

    const photos = this.extractPhotosFromHtml(html)
    this.log(`Found ${photos.length} photos in /foto gallery`)
    return photos
  }

  /**
   * Get photos from My Day for a specific date.
   * This fetches from the show_myday_photos AJAX endpoint.
   */
  async getPhotosForDate(date: Date): Promise<MyKidPhoto[]> {
    this.ensureAuthenticated()

    const dateStr = date.toISOString().split('T')[0] + '+00:00:00'
    this.log(`Fetching photos for date: ${dateStr}`)

    const response = await this.ajaxRequest(
      'POST',
      '/_ajax/dagenmin/show_myday_photos',
      `date=${encodeURIComponent(dateStr)}&_csrf=${this.csrf}`
    )

    if (!response.ok) {
      this.log(`show_myday_photos failed: ${response.status}`)
      return []
    }

    const html = await response.text()
    return this.extractPhotosFromHtml(html)
  }

  /**
   * Get photos from multiple days (for comprehensive sync).
   * @param days Number of days to look back (default 30)
   */
  async getPhotosFromRecentDays(_days: number = 30): Promise<MyKidPhoto[]> {
    this.ensureAuthenticated()
    const allPhotos: MyKidPhoto[] = []
    const seen = new Set<string>()

    // Primary source: /foto gallery page (has ALL photos)
    try {
      const galleryPhotos = await this.getPhotoGallery()
      this.log(`Gallery returned ${galleryPhotos.length} photos`)
      for (const p of galleryPhotos) {
        if (!seen.has(p.photoId)) {
          seen.add(p.photoId)
          allPhotos.push(p)
        }
      }
    } catch (e) {
      this.log(`Error fetching photo gallery: ${e}`)
    }

    // Secondary source: dashboard photos
    const dashboardPhotos = this.getPhotoUrls()
    this.log(`Dashboard returned ${dashboardPhotos.length} photos`)
    for (const p of dashboardPhotos) {
      if (!seen.has(p.photoId)) {
        seen.add(p.photoId)
        allPhotos.push(p)
      }
    }

    this.log(`Photo summary: ${allPhotos.length} unique photos total`)
    return allPhotos
  }

  /**
   * Extract photo URLs from HTML content.
   */
  private extractPhotosFromHtml(html: string): MyKidPhoto[] {
    const photos: MyKidPhoto[] = []
    const pattern = /https:\/\/media\d*\.intutor\.no\/photo\.php\?t=([^"'\s&]+)/g
    const seen = new Set<string>()
    let urlMatch

    while ((urlMatch = pattern.exec(html)) !== null) {
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
   * Download an attachment (PDF, etc.) from a newsletter.
   * URL pattern: /_ajax/image/fetchimage/news_att/{id}/orig
   */
  async downloadAttachment(attachmentPath: string): Promise<{ buffer: Buffer; contentType: string; filename?: string }> {
    this.ensureAuthenticated()
    const url = attachmentPath.startsWith('http') ? attachmentPath : `${BASE_URL}${attachmentPath}`
    this.log(`Downloading attachment: ${url.substring(0, 80)}...`)

    const response = await this.fetchWithTimeout(url, {
      headers: {
        Cookie: this.getCookieHeader(),
        'User-Agent': 'Mozilla/5.0',
      },
    })

    if (!response.ok) {
      throw new MyKidError(`Failed to download attachment: ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const contentDisposition = response.headers.get('content-disposition')
    let filename: string | undefined

    // Extract filename from content-disposition header if available
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (match) {
        filename = match[1].replace(/['"]/g, '')
      }
    }

    const arrayBuffer = await response.arrayBuffer()

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
      filename,
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
  static mapCalendarEventToDb(event: MyKidCalendarEvent): MappedMyKidEvent | null {
    // Validate dates before storing. event_at is documented YYYY-MM-DD; if the API
    // ever returns a datetime or non-ISO value, take the date portion and validate.
    // Returning null (skip) is better than writing a wrong/invalid event_date -
    // wrong data is worse than a missing event.
    const eventDate = sanitizeDate(String(event.event_at).slice(0, 10))
    if (!eventDate) return null
    const endDate = event.event_until ? sanitizeDate(String(event.event_until).slice(0, 10)) : null

    return {
      externalId: event.id,
      externalGroupId: null,
      title: event.title,
      description: event.description,
      eventDate,
      eventTime: null,
      endDate,
      endTime: null,
      eventType: event.class,
      rawData: event,
    }
  }

  /**
   * Map newsletter to database format.
   */
  static mapNewsletterToDb(newsletter: MyKidNewsletter): MappedMyKidMessage | null {
    // Do NOT fall back to "now" when the date can't be parsed: that stamps the
    // newsletter with the sync time, so it sorts to the top of the feed as if
    // brand-new on every nightly sync. Skip it instead (message_date is NOT NULL).
    const parsed = MyKidClient.parseNorwegianDate(newsletter.date)
    if (!parsed) return null

    return {
      externalId: `newsletter_${newsletter.id}`,
      externalGroupId: null,
      chatId: null,
      senderName: null,
      title: newsletter.title,
      body: newsletter.content,
      messageDate: parsed.toISOString(),
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
