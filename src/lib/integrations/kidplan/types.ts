/**
 * Kidplan API Types
 *
 * Based on HAR analysis and PoC testing of the Kidplan app.
 * See: docs/kidplan-integration-research.md
 */

// ============================================================================
// Authentication
// ============================================================================

export interface KidplanKindergarten {
  Id: number
  Name: string
  UserIsActive: boolean
  InactiveUserInformation: string
}

export interface KidplanSession {
  cookie: string
  kindergartenId: number
  kindergartenName: string
}

// ============================================================================
// Children
// ============================================================================

export interface KidplanNextOfKin {
  NokId: number
  FirstName: string
  LastName: string
  Name: string
  Street?: string
  PONumber?: string
  PO?: string
  Email?: string
  Note?: string
  VisibleToOtherNextOfKins: boolean
  CommitteeMember: boolean
  HasPermitAnswerRights: boolean
  KinTypeEnum: number // 1 = Far, 2 = Mor
  KinType: string // "Far", "Mor", etc.
  Phone?: string
  FormattedPhone?: string
  DefaultRegion?: string
}

export interface KidplanChild {
  ChildId: number
  Firstname: string
  Lastname: string
  Name: string
  unitName: string
  PictureId?: string
  Birthdate: string // Microsoft JSON date: /Date(1677754800000)/
  StartDate: string
  EndDate: string
  MaxSleepTime: number
  NoSleep: boolean
  Note?: string
  NextOfKins: KidplanNextOfKin[]
  ImagePath?: string
}

export interface KidplanChildrenResponse {
  ChildList: KidplanChild[]
}

// ============================================================================
// Board Posts (Tavla)
// ============================================================================

export interface KidplanBoardPost {
  PostId: number
  Title: string
  Content: string
  Created: string
  UnitName: string
  AuthorName: string
  // Additional fields from API
  [key: string]: unknown
}

export interface KidplanLatestPicture {
  PictureId: string
  AlbumId: number
  AlbumName: string
  Created: string
  UnitName: string
  // Additional fields
  [key: string]: unknown
}

export interface KidplanBoardResponse {
  KindergartenName: string
  BoardPosts: KidplanBoardPost[]
  LatestPictures: KidplanLatestPicture[]
  MorePostsAvaliable: boolean // Note: typo in API
  OldestItemDate: string
  LastSeenDateTime: string
  UserIsEmployee: boolean
  UnitsPredicate?: unknown
  UnitsForCurrentUser?: unknown[]
}

// ============================================================================
// Conversations
// ============================================================================

export interface KidplanConversation {
  ConversationId: number
  Updated: string
  Participants: KidplanParticipant[]
  ParticipantsAsString: string
  LastMessage: string
  LastMessageDate: string
  MessageCount: number
  CurrentParticipant?: unknown
  possibleSenders?: unknown
  // Additional fields
  [key: string]: unknown
}

export interface KidplanParticipant {
  Id: number
  Name: string
  // Additional fields
  [key: string]: unknown
}

export interface KidplanMessage {
  MessageId: number
  ConversationId: number
  SenderId: number
  SenderName: string
  Body: string
  Created: string
  // Additional fields
  [key: string]: unknown
}

// ============================================================================
// Daily Log (Dagslogg)
// ============================================================================

export interface KidplanDayStatus {
  Date: string // Microsoft JSON date
  Status?: string
  Sleep?: string
  Meals?: string
  Activities?: string
  Notes?: string
  // Additional fields
  [key: string]: unknown
}

export interface KidplanDailyLogResponse {
  Children: unknown[]
  Days: KidplanDayStatus[]
  WeekNumbers: number[]
}

// ============================================================================
// Photos
// ============================================================================

export interface KidplanPhotoInfo {
  id: string
  token: string
  fullUrl: string
  albumId?: number
  albumName?: string
}

// ============================================================================
// Client Options
// ============================================================================

export interface KidplanClientOptions {
  /** Enable debug logging */
  debug?: boolean
  /** Request timeout in milliseconds */
  timeout?: number
}

// ============================================================================
// Error Types
// ============================================================================

export class KidplanError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message)
    this.name = 'KidplanError'
  }
}

export class KidplanAuthError extends KidplanError {
  constructor(message: string, response?: unknown) {
    super(message, 401, response)
    this.name = 'KidplanAuthError'
  }
}

// ============================================================================
// Mapped Types (for our database)
// ============================================================================

export interface MappedKidplanMessage {
  externalId: string
  externalGroupId: string | null
  chatId: string | null
  senderName: string | null
  title: string | null
  body: string
  messageDate: string // ISO datetime
  sourceType: 'board_post' | 'conversation'
  rawData: KidplanBoardPost | KidplanMessage
}

export interface MappedKidplanPhoto {
  externalId: string
  title: string | null
  takenAt: string | null
  albumName: string | null
  sourceUrl: string
  rawData: KidplanLatestPicture
}
