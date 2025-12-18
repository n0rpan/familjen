/**
 * iSkole API Client
 *
 * Reverse-engineered client for the iSkole parent portal (iskole.net).
 * Uses Oracle ADF REST APIs with session-based authentication.
 *
 * Authentication flow:
 * 1. VoValidateUserCredentials with SHA256 hashed password
 * 2. login/login/{personId} to establish session
 * 3. VoUserData to get jsessionid token
 * 4. All subsequent requests include jsessionid in URL path
 */

import { createHash } from 'crypto'
import type {
  ISkoleSession,
  ISkoleChild,
  ISkoleChildrenResponse,
  ISkoleMessage,
  ISkoleMessagesResponse,
  ISkoleTimeplanEntry,
  ISkoleTimeplanResponse,
  ISkoleAbsence,
  ISkoleAbsenceResponse,
  ISkoleSchoolCalendarDay,
  ISkoleSchoolCalendarResponse,
  ISkoleValidationResult,
  MappedISkoleMessage,
} from './types'
import { ISkoleError, ISkoleAuthError, ISkoleSessionExpiredError } from './types'

const BASE_URL = 'https://iskole.net'
const PARENT_PATH = 'iskole_forelder'
const STUDENT_PATH = 'iskole_elev' // Used for some endpoints like school calendar

interface ISkoleClientOptions {
  debug?: boolean
}

export class ISkoleClient {
  private session: ISkoleSession | null = null
  private cookies: string[] = []
  private debug: boolean

  constructor(options: ISkoleClientOptions = {}) {
    this.debug = options.debug ?? false
  }

  /**
   * Hash password using SHA256 (required by iSkole API)
   */
  static hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex')
  }

  /**
   * Log debug messages
   */
  private log(...args: unknown[]) {
    if (this.debug) {
      console.log('[ISkoleClient]', ...args)
    }
  }

  /**
   * Make an authenticated request to the iSkole API
   */
  private async request<T>(
    path: string,
    options: RequestInit = {},
    useStudentPath = false
  ): Promise<T> {
    const basePath = useStudentPath ? STUDENT_PATH : PARENT_PATH
    let url = `${BASE_URL}/${basePath}/rest/v0/${path}`

    // Add jsessionid to path if we have a session
    if (this.session?.jsessionid && !path.includes('jsessionid')) {
      // Insert jsessionid before query params
      const [pathPart, queryPart] = url.split('?')
      const restPathIndex = pathPart.indexOf('/rest/v0/') + '/rest/v0/'.length
      const endpointPart = pathPart.substring(restPathIndex)
      const basePart = pathPart.substring(0, restPathIndex)

      if (endpointPart.includes(';')) {
        url = queryPart ? `${pathPart}?${queryPart}` : pathPart
      } else {
        url = queryPart
          ? `${basePart}${endpointPart};jsessionid=${this.session.jsessionid}?${queryPart}`
          : `${basePart}${endpointPart};jsessionid=${this.session.jsessionid}`
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      ...(options.headers as Record<string, string>),
    }

    // Add cookies if we have them
    if (this.cookies.length > 0) {
      headers['Cookie'] = this.cookies.join('; ')
    }

    this.log('Request:', options.method || 'GET', url)

    const response = await fetch(url, {
      ...options,
      headers,
    })

    // Collect cookies from response
    const setCookies = response.headers.getSetCookie?.() || []
    if (setCookies.length > 0) {
      this.cookies = [
        ...this.cookies.filter((c) => {
          const name = c.split('=')[0]
          return !setCookies.some((sc) => sc.startsWith(name + '='))
        }),
        ...setCookies.map((c) => c.split(';')[0]),
      ]
      this.log('Cookies updated:', this.cookies.length, 'cookies')
    }

    if (!response.ok) {
      this.log('Response error:', response.status, response.statusText)
      if (response.status === 401 || response.status === 403) {
        throw new ISkoleSessionExpiredError()
      }
      throw new ISkoleError(`HTTP ${response.status}: ${response.statusText}`, 'HTTP_ERROR', response.status)
    }

    const data = await response.json()
    return data as T
  }

  /**
   * Step 1: Validate credentials and get person ID
   */
  private async validateCredentials(
    username: string,
    passwordHash: string
  ): Promise<ISkoleValidationResult> {
    const response = await this.request<{ result: string }>('VoValidateUserCredentials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.oracle.adf.action+json',
      },
      body: JSON.stringify({
        name: 'validateUserCredentials',
        parameters: [{ username }, { password: passwordHash }],
      }),
    })

    // Response is a JSON string inside result field
    const results = JSON.parse(response.result) as ISkoleValidationResult[]
    const result = results[0]

    if (result.ret_code < 0 || result.error_text) {
      throw new ISkoleAuthError(result.error_text || 'Invalid credentials')
    }

    this.log('Credentials validated, personId:', result.ret_code)
    return result
  }

  /**
   * Step 2: Establish session with login endpoint
   */
  private async establishSession(personId: number, passwordHash: string): Promise<void> {
    const formData = new FormData()
    formData.append('password', passwordHash)
    formData.append('tofaktorkode', '')

    const url = `${BASE_URL}/${PARENT_PATH}/login/login/${personId}`
    this.log('Establishing session at:', url)

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    })

    // Collect cookies
    const setCookies = response.headers.getSetCookie?.() || []
    if (setCookies.length > 0) {
      this.cookies = [
        ...this.cookies.filter((c) => {
          const name = c.split('=')[0]
          return !setCookies.some((sc) => sc.startsWith(name + '='))
        }),
        ...setCookies.map((c) => c.split(';')[0]),
      ]
      this.log('Session cookies collected:', this.cookies.length)
    }

    if (!response.ok) {
      throw new ISkoleAuthError('Failed to establish session')
    }

    this.log('Session established')
  }

  /**
   * Step 3: Get jsessionid token
   */
  private async getSessionToken(
    personId: number,
    fullname: string
  ): Promise<ISkoleSession> {
    const response = await this.request<{ result: string }>('VoUserData', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.oracle.adf.action+json',
      },
      body: JSON.stringify({
        name: 'validateJsessionId',
      }),
    })

    // Response is a JSON string inside result field
    const results = JSON.parse(response.result) as Array<{
      fullname: string
      personid: string
      security_level: string
      antall_barn: string
      jsessionid: string
    }>
    const result = results[0]

    if (!result.jsessionid || result.jsessionid === 'null') {
      throw new ISkoleAuthError('Failed to get session token')
    }

    const session: ISkoleSession = {
      personId,
      jsessionid: result.jsessionid,
      fullname: result.fullname || fullname,
      securityLevel: result.security_level,
      antallBarn: parseInt(result.antall_barn, 10) || 0,
    }

    this.log('Session token acquired:', session.jsessionid.substring(0, 10) + '...')
    return session
  }

  /**
   * Full login flow
   *
   * @param username Fødselsnummer (11-digit Norwegian national ID)
   * @param password Plain text password (will be hashed)
   */
  async login(username: string, password: string): Promise<ISkoleSession> {
    // Reset state
    this.session = null
    this.cookies = []

    const passwordHash = ISkoleClient.hashPassword(password)
    this.log('Starting login for:', username.substring(0, 6) + '...')

    // Step 1: Validate credentials
    const validation = await this.validateCredentials(username, passwordHash)

    // Check for 2FA requirement
    if (validation.tofaktor === '1') {
      throw new ISkoleError(
        'Two-factor authentication is required but not supported',
        '2FA_REQUIRED'
      )
    }

    // Step 2: Establish session
    await this.establishSession(validation.ret_code, passwordHash)

    // Step 3: Get session token
    this.session = await this.getSessionToken(validation.ret_code, validation.navn)

    return this.session
  }

  /**
   * Get list of children for the logged-in parent
   */
  async getChildren(): Promise<ISkoleChild[]> {
    if (!this.session) {
      throw new ISkoleError('Not logged in', 'NOT_LOGGED_IN')
    }

    const response = await this.request<ISkoleChildrenResponse>(
      'VoBarn?onlyData=true&fields=Id,Fylkeid,Skoleid,Planperi,Elevnr,Elev,Klasse,Skolenavn,Bilde,Logo,AntallMeldinger'
    )

    this.log('Fetched', response.items?.length || 0, 'children')
    return response.items || []
  }

  /**
   * Get messages for a specific child
   *
   * @param elevnr Student number
   * @param fylkeid County ID
   * @param planperi School year
   * @param skoleid School ID
   * @param limit Max messages to fetch
   * @param offset Pagination offset
   */
  async getMessages(
    elevnr: number,
    fylkeid: string,
    planperi: string,
    skoleid: string,
    limit = 50,
    offset = 0
  ): Promise<ISkoleMessage[]> {
    if (!this.session) {
      throw new ISkoleError('Not logged in', 'NOT_LOGGED_IN')
    }

    const finder = `RESTFilter;fylkeid=${fylkeid},planperi=${planperi},skoleid=${skoleid},elevnr=${elevnr},mappeid=INB`
    const query = new URLSearchParams({
      finder,
      onlyData: 'true',
      limit: String(limit),
      offset: String(offset),
      totalResults: 'true',
      orderBy: 'Mottatt:desc',
    })

    const response = await this.request<ISkoleMessagesResponse>(`VoPostkasse?${query}`)

    this.log('Fetched', response.items?.length || 0, 'messages for student', elevnr)
    return response.items || []
  }

  /**
   * Get timetable for a specific child and date range
   *
   * @param elevnr Student number
   * @param fylkeid County ID
   * @param planperi School year
   * @param skoleid School ID
   * @param startDate Start date (YYYYMMDD format)
   * @param endDate End date (YYYYMMDD format)
   */
  async getTimetable(
    elevnr: number,
    fylkeid: string,
    planperi: string,
    skoleid: string,
    startDate: string,
    endDate: string
  ): Promise<ISkoleTimeplanEntry[]> {
    if (!this.session) {
      throw new ISkoleError('Not logged in', 'NOT_LOGGED_IN')
    }

    const finder = `RESTFilter;fylkeid=${fylkeid},planperi=${planperi},skoleid=${skoleid},elevnr=${elevnr},startDate=${startDate},endDate=${endDate}`
    const query = new URLSearchParams({
      finder,
      onlyData: 'true',
      limit: '500',
      offset: '0',
    })

    const response = await this.request<ISkoleTimeplanResponse>(`VoTimeplan_elev?${query}`)

    this.log('Fetched', response.items?.length || 0, 'timetable entries')
    return response.items || []
  }

  /**
   * Get all absences for a specific child
   *
   * @param elevnr Student number
   * @param fylkeid County ID
   * @param planperi School year
   * @param skoleid School ID
   */
  async getAbsences(
    elevnr: number,
    fylkeid: string,
    planperi: string,
    skoleid: string
  ): Promise<ISkoleAbsence[]> {
    if (!this.session) {
      throw new ISkoleError('Not logged in', 'NOT_LOGGED_IN')
    }

    const finder = `RESTFilter;fylkeid=${fylkeid},planperi=${planperi},skoleid=${skoleid},elevnr=${elevnr}`
    const query = new URLSearchParams({
      finder,
      onlyData: 'true',
      limit: '500',
      offset: '0',
    })

    const response = await this.request<ISkoleAbsenceResponse>(`VoFravaer_alt?${query}`)

    this.log('Fetched', response.items?.length || 0, 'absence records')
    return response.items || []
  }

  /**
   * Get school calendar for a specific month
   * Note: Uses the student path (iskole_elev) endpoint
   *
   * @param month Month number (1-12)
   * @param fylkeid County ID
   * @param planperi School year
   * @param skoleid School ID
   */
  async getSchoolCalendar(
    month: number,
    fylkeid: string,
    planperi: string,
    skoleid: string
  ): Promise<ISkoleSchoolCalendarDay[]> {
    if (!this.session) {
      throw new ISkoleError('Not logged in', 'NOT_LOGGED_IN')
    }

    const monthStr = month.toString().padStart(2, '0')
    const finder = `RESTFilter;fylkeid=${fylkeid},planperi=${planperi},skoleid=${skoleid},maaned=${monthStr}`
    const query = new URLSearchParams({
      finder,
      onlyData: 'true',
      limit: '50',
      offset: '0',
    })

    // School calendar uses the student path
    const response = await this.request<ISkoleSchoolCalendarResponse>(
      `VoSkolerute_maaned?${query}`,
      {},
      true // useStudentPath
    )

    this.log('Fetched', response.items?.length || 0, 'calendar entries for month', month)
    return response.items || []
  }

  /**
   * Check if currently logged in
   */
  isLoggedIn(): boolean {
    return this.session !== null
  }

  /**
   * Get current session info
   */
  getSession(): ISkoleSession | null {
    return this.session
  }

  // ========================================
  // Static Mapping Methods
  // ========================================

  /**
   * Map iSkole message to database format
   */
  static mapMessageToDb(message: ISkoleMessage, childId: string): MappedISkoleMessage {
    const senderName = [message.Fname, message.Lname].filter(Boolean).join(' ') || null

    return {
      external_id: `iskole_msg_${message.Meldingid}`,
      external_group_id: childId,
      chat_id: null,
      sender_name: senderName,
      title: message.Emne || null,
      body: message.Tekst || '',
      message_date: message.Mottatt,
      source_type: 'school_message',
      raw_data: message,
    }
  }

  /**
   * Format date for iSkole API (YYYYMMDD)
   */
  static formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    return `${year}${month}${day}`
  }

  /**
   * Parse iSkole date format (YYYYMMDD) to Date
   */
  static parseDate(dateStr: string): Date {
    const year = parseInt(dateStr.substring(0, 4), 10)
    const month = parseInt(dateStr.substring(4, 6), 10) - 1
    const day = parseInt(dateStr.substring(6, 8), 10)
    return new Date(year, month, day)
  }
}
