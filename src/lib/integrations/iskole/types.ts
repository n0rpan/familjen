/**
 * iSkole Integration Types
 *
 * Based on HAR analysis of the iSkole parent portal (iskole.net/forelder).
 * iSkole is a Norwegian school administration system using Oracle ADF REST APIs.
 */

// ========================================
// Authentication Types
// ========================================

export interface ISkoleCredentials {
  username: string // Fødselsnummer (11-digit Norwegian national ID)
  passwordHash: string // SHA256 hashed password
}

export interface ISkoleValidationResult {
  ret_code: number // Person ID if positive, error code if negative
  navn: string
  tofaktor: string // "0" = no 2FA, "1" = 2FA required
  error_text: string | null
}

export interface ISkoleSession {
  personId: number
  jsessionid: string
  fullname: string
  securityLevel: string
  antallBarn: number
}

// ========================================
// Child Types
// ========================================

export interface ISkoleChild {
  Id: number
  Fylkeid: string // County ID
  Skoleid: string // School ID
  Planperi: string // School year (e.g., "2025-26")
  Elevnr: number // Student number
  Elev: string // Child name
  Klasse: string // Class (e.g., "1A")
  Skolenavn: string // School name
  Bilde: string | null // Photo (base64)
  Logo: string | null // School logo (base64)
  AntallMeldinger: number // Unread message count
}

export interface ISkoleChildrenResponse {
  items: ISkoleChild[]
  totalResults: number
  count: number
  hasMore: boolean
  limit: number
  offset: number
}

// ========================================
// Message Types
// ========================================

export interface ISkoleMessage {
  Meldingid: number
  Mottatt: string // ISO timestamp
  Apnet: string | null // When opened
  Emne: string // Subject
  Lname: string // Sender last name
  Fname: string // Sender first name
  Epost: string | null // Sender email
  Tekst: string // HTML content
  PersonidMottaker: number
  Elevnr: number
  Elevnavn: string
}

export interface ISkoleMessagesResponse {
  items: ISkoleMessage[]
  totalResults: number
  count: number
  hasMore: boolean
  limit: number
  offset: number
}

// ========================================
// Timetable Types
// ========================================

export interface ISkoleTimeplanEntry {
  Id: string
  Dato: string // "20251215" format
  Timenr: number
  Fradato: string // ISO timestamp
  Tildato: string // ISO timestamp
  Fag: string // Subject code
  Fagnavn: string // Subject name
  Skoletype: string // "SD" = school day
  Romnr: string // Room number
  Kode: string
  Faglaerer: string // Teacher name
  ProviderId: string
  Fravaer: string | null // Absence info
  Merknad: string | null // Notes
  Egenmelding: string // "Ja" or "Nei"
  Dokumentert: string // Documentation status
  Tidssone: string
  Timetype: string // "TIME"
}

export interface ISkoleTimeplanResponse {
  items: ISkoleTimeplanEntry[]
  totalResults: number
  count: number
  hasMore: boolean
  limit: number
  offset: number
}

// ========================================
// Absence Types
// ========================================

export interface ISkoleAbsence {
  Id: string
  Sortering: number
  Dato: string // ISO timestamp
  Timenr: number
  StartKl: string | null
  SluttKl: string | null
  Minutter: number
  Fag: string
  Typefravaer: string // "D" = day, "T" = time
  RegistrertDok: string | null
  Dokumentasjonstypeid: number | null
  Dokumentasjonstypetekst: string | null
  Merknad: string | null
  RegistrertEgenm: string | null
  RegistrertEgenmJaNei: string
  RegistrertDokJaNei: string
}

export interface ISkoleAbsenceResponse {
  items: ISkoleAbsence[]
  totalResults: number
  count: number
  hasMore: boolean
  limit: number
  offset: number
}

// ========================================
// School Calendar Types
// ========================================

export interface ISkoleSchoolCalendarDay {
  Dato: string // "20250801" format
  Uke: string // Week number
  Mandag: string | null
  Tirsdag: string | null
  Onsdag: string | null
  Torsdag: string | null
  Fredag: string | null
  Lordag: string | null
  Sondag: string | null
  SkoletypeMandag: string | null // "SD", "FD", "PD"
  SkoletypeTirsdag: string | null
  SkoletypeOnsdag: string | null
  SkoletypeTorsdag: string | null
  SkoletypeFredag: string | null
  SkoletypeLordag: string | null
  SkoletypeSondag: string | null
}

export interface ISkoleSchoolCalendarResponse {
  items: ISkoleSchoolCalendarDay[]
  totalResults: number
  count: number
  hasMore: boolean
  limit: number
  offset: number
}

// Day type codes
export const ISKOLE_DAY_TYPES = {
  SD: 'School Day',
  FD: 'Day Off',
  PD: 'Planning Day',
} as const

// ========================================
// Student Info Types
// ========================================

export interface ISkoleStudentInfo {
  Elevnr: number
  Klasse: string
  Lname: string
  Fname: string
  Birthdate: string // ISO timestamp
  Myndig: number // 0 = minor, 1 = adult
  Startdato: string
  Sluttdato: string
  Mobile: string | null
  Epost: string | null
  Skyss: string // "Ja" or "Nei" (school transport)
  Epostskole: string | null
  Kurskode: string
  Kursnavn: string
  Kontaktlaerer: string
  Gender: string // "M" or "F"
  Fname1: string | null // Parent 1 first name
  Lname1: string | null // Parent 1 last name
  Gate1: string | null
  Postnr1: string | null
  Poststed1: string | null
  Mobil1: string | null
  Epost1: string | null
  Fname2: string | null // Parent 2 first name
  Lname2: string | null
}

// ========================================
// Error Types
// ========================================

export class ISkoleError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'ISkoleError'
  }
}

export class ISkoleAuthError extends ISkoleError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR', 401)
    this.name = 'ISkoleAuthError'
  }
}

export class ISkoleSessionExpiredError extends ISkoleError {
  constructor(message: string = 'Session expired') {
    super(message, 'SESSION_EXPIRED', 401)
    this.name = 'ISkoleSessionExpiredError'
  }
}

// ========================================
// Mapped Types for Database Storage
// ========================================

export interface MappedISkoleMessage {
  external_id: string
  external_group_id: string | null
  chat_id: string | null
  sender_name: string | null
  title: string | null
  body: string
  message_date: string
  source_type: 'school_message'
  raw_data: ISkoleMessage
}

export interface MappedISkoleEvent {
  external_id: string
  external_group_id: string | null
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  location: string | null
  event_type: string
  raw_data: unknown
}
