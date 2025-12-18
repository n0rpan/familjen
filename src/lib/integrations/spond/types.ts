/**
 * Spond API Types
 *
 * Based on the unofficial Spond API documentation and Python library.
 * See: https://github.com/Olen/Spond
 */

// ============================================================================
// Authentication
// ============================================================================

export interface SpondLoginRequest {
  email: string
  password: string
}

export interface SpondLoginResponse {
  loginToken: string
  // Other fields may exist but we only need the token
}

export interface SpondChatAuthResponse {
  url: string
  auth: string
}

// ============================================================================
// Groups
// ============================================================================

export interface SpondGroup {
  id: string
  name: string
  description?: string
  imageUrl?: string
  members?: SpondGroupMember[]
  subGroups?: SpondSubGroup[]
  createdTime?: string
  // Additional fields we don't use but may exist
  [key: string]: unknown
}

export interface SpondGroupMember {
  id: string
  firstName: string
  lastName: string
  email?: string
  phoneNumber?: string
  roles?: string[]
  profile?: {
    id: string
  }
  subGroups?: string[] // IDs of subgroups this member belongs to
  guardians?: SpondGuardian[]
  [key: string]: unknown
}

export interface SpondGuardian {
  id: string
  firstName: string
  lastName: string
  email?: string
  phoneNumber?: string
  [key: string]: unknown
}

export interface SpondSubGroup {
  id: string
  name: string
  color?: string
  [key: string]: unknown
}

// ============================================================================
// Events (called "sponds" in the API)
// ============================================================================

export interface SpondEvent {
  id: string
  heading: string
  description?: string
  type?: string // 'EVENT', 'RECURRING', etc.
  startTimestamp: string // ISO datetime
  endTimestamp?: string // ISO datetime
  cancelled?: boolean
  location?: SpondLocation
  responses?: SpondEventResponse
  recipients?: {
    group?: { id: string; name: string }
    subGroups?: Array<{ id: string; name: string }>
  }
  tasks?: SpondTask[]
  comments?: SpondComment[]
  // We store the full object for debugging
  [key: string]: unknown
}

export interface SpondLocation {
  id?: string
  feature?: string
  address?: string
  latitude?: number
  longitude?: number
  [key: string]: unknown
}

export interface SpondEventResponse {
  acceptedIds?: string[]
  declinedIds?: string[]
  unansweredIds?: string[]
  waitinglistIds?: string[]
  unconfirmedIds?: string[]
  [key: string]: unknown
}

export interface SpondTask {
  id: string
  name: string
  description?: string
  adultsOnly?: boolean
  [key: string]: unknown
}

export interface SpondComment {
  id: string
  text: string
  timestamp: string
  sender?: {
    id: string
    firstName: string
    lastName: string
  }
  [key: string]: unknown
}

// ============================================================================
// Chats / Messages
// ============================================================================

export interface SpondChat {
  id: string
  groupId?: string
  type?: string // 'group', 'personal', etc.
  name?: string
  imageUrl?: string
  messages?: SpondMessage[]
  unread?: number
  latestMessage?: SpondMessage
  [key: string]: unknown
}

export interface SpondMessage {
  chatId: string
  msgNum: number
  text: string
  timestamp: string
  type?: string
  clubMessage?: boolean
  reactions?: unknown[]
  sender?: {
    id: string
    firstName: string
    lastName: string
    imageUrl?: string
  }
  // Other fields
  [key: string]: unknown
}

// ============================================================================
// Client Options
// ============================================================================

export interface SpondClientOptions {
  /** Enable debug logging */
  debug?: boolean
  /** Request timeout in milliseconds */
  timeout?: number
}

export interface GetEventsOptions {
  /** Group ID to filter by (optional - gets all groups if not specified) */
  groupId?: string
  /** Include scheduled/recurring events */
  includeScheduled?: boolean
  /** Maximum number of events to return (default: 100) */
  maxEvents?: number
  /** Start date filter (ISO string or Date) */
  minEndTimestamp?: string | Date
  /** End date filter (ISO string or Date) */
  maxStartTimestamp?: string | Date
}

export interface GetChatsOptions {
  /** Maximum number of chats to return (default: 100) */
  limit?: number
}

// ============================================================================
// Error Types
// ============================================================================

export class SpondError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message)
    this.name = 'SpondError'
  }
}

export class SpondAuthError extends SpondError {
  constructor(message: string, response?: unknown) {
    super(message, 401, response)
    this.name = 'SpondAuthError'
  }
}

// ============================================================================
// Mapped Types (for our database)
// ============================================================================

export interface MappedSpondEvent {
  externalId: string
  externalGroupId: string
  title: string
  description: string | null
  eventDate: string // YYYY-MM-DD
  eventTime: string | null // HH:MM:SS
  endDate: string | null
  endTime: string | null
  location: string | null
  eventType: string | null
  rawData: SpondEvent
}

export interface MappedSpondMessage {
  externalId: string
  externalGroupId: string | null
  chatId: string
  senderName: string | null
  title: string | null
  body: string
  messageDate: string // ISO datetime
  rawData: SpondMessage
}
