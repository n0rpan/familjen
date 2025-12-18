/**
 * MyKid Integration Types
 *
 * TypeScript interfaces for the MyKid.no API.
 * Based on HAR analysis and live verification testing.
 */

// =============================================================================
// Credentials
// =============================================================================

export interface MyKidCredentials {
  phone: string // Mobile phone number (login identifier)
  password: string
}

export interface MyKidSession {
  cookies: Map<string, string>
  csrf: string // From dashboard meta tag
  dashboardHtml?: string
}

// =============================================================================
// Children
// =============================================================================

export interface MyKidChild {
  id: number // e.g., 123456
  name: string // Parsed from dashboard
}

// =============================================================================
// Calendar
// =============================================================================

export interface MyKidCalendarEvent {
  id: string // e.g., "b_554975"
  event_at: string // YYYY-MM-DD
  event_until: string | null
  title: string
  description: string | null
  is_all_day: boolean
  isHolidayEvent: number // 0 or 1
  class: string // 'birthday', 'event', etc.
  icon: string // e.g., 'bursdag.png'
  editable: boolean
  allow_delete: boolean
  // Additional fields from API
  fromyear?: string
  frommonth?: string
  toyear?: string
  tomonth?: string
  fornavn?: string // First name (for birthdays)
  sortorder?: number
}

// =============================================================================
// Newsletters
// =============================================================================

export interface MyKidNewsletterSummary {
  id: number
  title: string
  date: string // "15.12.2025" format
  category?: string // "Nyhetsbrev - Hele barnehagen"
}

export interface MyKidNewsletter {
  id: number
  title: string
  date: string
  content: string // HTML content
  attachments: MyKidAttachment[]
}

export interface MyKidAttachment {
  id: number
  filename: string
  url: string // /_ajax/image/fetchimage/news_att/{id}/orig
}

// =============================================================================
// Photos
// =============================================================================

export interface MyKidPhoto {
  url: string // Full media1.intutor.no URL with JWT
  expiresAt: Date // From JWT exp
  photoId: string // Extracted from JWT name field
  companyId?: string
  date?: string
}

export interface MyKidPhotoJwt {
  exp: number
  iat: number
  ip: string // Client IP - token is IP-locked!
  date: string
  companyId: string
  name: string // Filename: {companyId}_{type}_{hash}.{ext}
}

// =============================================================================
// Messages / Conversations
// =============================================================================

export interface MyKidConversationMessage {
  id?: string
  senderName: string
  content: string
  timestamp: Date
  isFromKindergarten: boolean
}

// =============================================================================
// Unseen Counts
// =============================================================================

export interface MyKidUnseenCounts {
  local: number // Local newsletters
  su: number // SU (parent council)
  other: Record<string, number> // Other categories
}

// =============================================================================
// InfoBus (Real-time)
// =============================================================================

export interface MyKidInfoBusTopic {
  type: 'general' | 'parent'
  entity: 'user' | 'bell' | 'kid'
  id: number
  action: 'update'
}

// =============================================================================
// Mapped Types (for database storage)
// =============================================================================

export interface MappedMyKidMessage {
  externalId: string
  externalGroupId: string | null
  chatId: string | null
  senderName: string | null
  title: string | null
  body: string
  messageDate: string
  sourceType: 'newsletter' | 'conversation'
  rawData: unknown
}

export interface MappedMyKidEvent {
  externalId: string
  externalGroupId: string | null
  title: string
  description: string | null
  eventDate: string
  eventTime: string | null
  endDate: string | null
  endTime: string | null
  eventType: string | null
  rawData: unknown
}

export interface MappedMyKidPhoto {
  externalId: string
  title: string | null
  takenAt: string | null
  sourceUrl: string
  rawData: unknown
}

// =============================================================================
// Client Options
// =============================================================================

export interface MyKidClientOptions {
  debug?: boolean
  timeout?: number // Request timeout in ms
}

// =============================================================================
// Errors
// =============================================================================

export class MyKidError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message)
    this.name = 'MyKidError'
  }
}

export class MyKidAuthError extends MyKidError {
  constructor(message: string, responseBody?: string) {
    super(message, 401, responseBody)
    this.name = 'MyKidAuthError'
  }
}

export class MyKidCsrfError extends MyKidError {
  constructor(message: string) {
    super(message, 403)
    this.name = 'MyKidCsrfError'
  }
}
