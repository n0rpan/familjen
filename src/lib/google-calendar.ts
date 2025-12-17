import { google, calendar_v3, gmail_v1, Auth } from 'googleapis'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',  // To get the connected Gmail address
  'https://www.googleapis.com/auth/gmail.readonly',  // To read calendar invites from Gmail
]

// OAuth2 client singleton
let oauth2Client: Auth.OAuth2Client | null = null

export function getOAuth2Client(): Auth.OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    )
  }
  return oauth2Client
}

// Generate OAuth URL for user consent
export function getAuthUrl(): string {
  const client = getOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline', // Get refresh token
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
  })
}

// Exchange authorization code for tokens
export async function getTokensFromCode(code: string) {
  const client = getOAuth2Client()
  const { tokens } = await client.getToken(code)
  return tokens
}

// Set credentials on the client
export function setCredentials(tokens: { access_token?: string | null; refresh_token?: string | null }) {
  const client = getOAuth2Client()
  client.setCredentials(tokens)
}

// Get calendar client with credentials
export function getCalendarClient(tokens: { access_token?: string | null; refresh_token?: string | null }): calendar_v3.Calendar {
  const client = getOAuth2Client()
  client.setCredentials(tokens)
  return google.calendar({ version: 'v3', auth: client })
}

// Fetch events from calendar
export async function fetchCalendarEvents(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  options: {
    timeMin?: string // ISO date
    timeMax?: string // ISO date
    maxResults?: number
  } = {}
): Promise<calendar_v3.Schema$Event[]> {
  const calendar = getCalendarClient(tokens)

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: options.timeMin ? new Date(options.timeMin).toISOString() : undefined,
    timeMax: options.timeMax ? new Date(options.timeMax).toISOString() : undefined,
    maxResults: options.maxResults || 100,
    singleEvents: true,
    orderBy: 'startTime',
  })

  return response.data.items || []
}

// Create a calendar event (for sending pickup assignments to work calendars)
export async function createCalendarEvent(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  event: {
    summary: string
    description?: string
    start: { date?: string; dateTime?: string }
    end: { date?: string; dateTime?: string }
    attendees?: { email: string }[]
    location?: string
  }
): Promise<calendar_v3.Schema$Event> {
  const calendar = getCalendarClient(tokens)

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      attendees: event.attendees,
      location: event.location,
    },
    sendUpdates: event.attendees ? 'all' : 'none', // Send email to attendees
  })

  return response.data
}

// Update a calendar event
export async function updateCalendarEvent(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  eventId: string,
  event: {
    summary?: string
    description?: string
    start?: { date?: string; dateTime?: string }
    end?: { date?: string; dateTime?: string }
    attendees?: { email: string }[]
    location?: string
  }
): Promise<calendar_v3.Schema$Event> {
  const calendar = getCalendarClient(tokens)

  const response = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: {
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      attendees: event.attendees,
      location: event.location,
    },
    sendUpdates: event.attendees ? 'all' : 'none',
  })

  return response.data
}

// Delete a calendar event
export async function deleteCalendarEvent(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  eventId: string
): Promise<void> {
  const calendar = getCalendarClient(tokens)

  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
  })
}

// Parse event to extract sender email (from organizer or creator)
export function getEventSenderEmail(event: calendar_v3.Schema$Event): string | null {
  // For invites, the organizer is who sent the invite
  if (event.organizer?.email) {
    return event.organizer.email
  }
  // Fallback to creator
  if (event.creator?.email) {
    return event.creator.email
  }
  return null
}

// Check if event is cancelled
export function isEventCancelled(event: calendar_v3.Schema$Event): boolean {
  return event.status === 'cancelled'
}

// Extract date from event (handles both all-day and timed events)
export function getEventDates(event: calendar_v3.Schema$Event): { start: string; end: string | null } {
  const startDate = event.start?.date || event.start?.dateTime?.split('T')[0] || ''
  const endDate = event.end?.date || event.end?.dateTime?.split('T')[0] || ''

  // For all-day events, end date is exclusive (next day), so subtract 1
  let adjustedEnd: string | null = endDate
  if (event.end?.date && endDate) {
    const end = new Date(endDate)
    end.setDate(end.getDate() - 1)
    adjustedEnd = end.toISOString().split('T')[0]
  }

  return {
    start: startDate,
    end: startDate !== adjustedEnd ? adjustedEnd : null,
  }
}

// Map event to our MemberEvent type
export function mapGoogleEventToMemberEvent(
  event: calendar_v3.Schema$Event,
  memberId: string,
  householdId: string
) {
  const dates = getEventDates(event)
  const senderEmail = getEventSenderEmail(event)

  // Guess event type from summary
  const summary = event.summary?.toLowerCase() || ''
  let eventType: 'work' | 'travel' | 'family' | 'other' = 'other'

  if (summary.includes('reise') || summary.includes('travel') || summary.includes('flight') || summary.includes('fly')) {
    eventType = 'travel'
  } else if (summary.includes('jobb') || summary.includes('work') || summary.includes('møte') || summary.includes('meeting')) {
    eventType = 'work'
  } else if (summary.includes('familie') || summary.includes('family') || summary.includes('bursdag') || summary.includes('birthday')) {
    eventType = 'family'
  }

  return {
    household_id: householdId,
    member_id: memberId,
    date: dates.start,
    end_date: dates.end,
    title: event.summary || 'Ukjent hendelse',
    event_type: eventType,
    source: 'google_calendar' as const,
    source_email: senderEmail,
    google_event_id: event.id,
  }
}

// ===========================================
// Gmail API functions for reading calendar invites
// ===========================================

// Get Gmail client with credentials
export function getGmailClient(tokens: { access_token?: string | null; refresh_token?: string | null }): gmail_v1.Gmail {
  const client = getOAuth2Client()
  client.setCredentials(tokens)
  return google.gmail({ version: 'v1', auth: client })
}

// Parsed calendar invite from .ics
export interface ParsedCalendarInvite {
  uid: string
  summary: string
  description?: string
  startDate: string
  endDate?: string
  organizerEmail: string
  organizerName?: string
  location?: string
  status?: string
}

// Search Gmail for calendar invite emails
export async function fetchCalendarInvitesFromGmail(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  options: {
    afterDate?: string  // ISO date string
    maxResults?: number
  } = {}
): Promise<ParsedCalendarInvite[]> {
  const gmail = getGmailClient(tokens)

  // Search for emails with calendar invites (text/calendar content type)
  // Filter by date if provided
  let query = 'filename:ics OR has:attachment filename:ics'
  if (options.afterDate) {
    const afterDateFormatted = options.afterDate.replace(/-/g, '/')
    query += ` after:${afterDateFormatted}`
  }

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: options.maxResults || 50,
  })

  const messages = response.data.messages || []
  const invites: ParsedCalendarInvite[] = []

  for (const message of messages) {
    if (!message.id) continue

    try {
      const invite = await extractCalendarInviteFromMessage(gmail, message.id)
      if (invite) {
        invites.push(invite)
      }
    } catch (error) {
      console.error(`Failed to parse invite from message ${message.id}:`, error)
    }
  }

  return invites
}

// Extract calendar invite from a Gmail message
async function extractCalendarInviteFromMessage(
  gmail: gmail_v1.Gmail,
  messageId: string
): Promise<ParsedCalendarInvite | null> {
  const message = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  })

  const payload = message.data.payload
  if (!payload) return null

  // Find .ics attachment or text/calendar part
  const icsContent = findIcsContent(payload)
  if (!icsContent) return null

  // Parse the .ics content
  return parseIcsContent(icsContent, messageId)
}

// Recursively find .ics content in message payload
function findIcsContent(payload: gmail_v1.Schema$MessagePart): string | null {
  // Check if this part is an .ics attachment
  if (payload.mimeType === 'text/calendar' || payload.filename?.endsWith('.ics')) {
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8')
    }
  }

  // Check nested parts
  if (payload.parts) {
    for (const part of payload.parts) {
      const icsContent = findIcsContent(part)
      if (icsContent) return icsContent
    }
  }

  return null
}

// Parse .ics content to extract event details
function parseIcsContent(icsContent: string, messageId: string): ParsedCalendarInvite | null {
  // Simple .ics parser - extract key fields
  const lines = icsContent.split(/\r?\n/)

  let uid = messageId // fallback to message ID
  let summary = ''
  let description = ''
  let startDate = ''
  let endDate = ''
  let organizerEmail = ''
  let organizerName = ''
  let location = ''
  let status = ''
  let inEvent = false

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // Handle line continuations (lines starting with space/tab)
    while (i + 1 < lines.length && (lines[i + 1].startsWith(' ') || lines[i + 1].startsWith('\t'))) {
      i++
      line += lines[i].substring(1)
    }

    if (line.startsWith('BEGIN:VEVENT')) {
      inEvent = true
      continue
    }
    if (line.startsWith('END:VEVENT')) {
      inEvent = false
      continue
    }

    if (!inEvent) continue

    if (line.startsWith('UID:')) {
      uid = line.substring(4).trim()
    } else if (line.startsWith('SUMMARY:') || line.startsWith('SUMMARY;')) {
      summary = extractIcsValue(line)
    } else if (line.startsWith('DESCRIPTION:') || line.startsWith('DESCRIPTION;')) {
      description = extractIcsValue(line)
    } else if (line.startsWith('DTSTART')) {
      startDate = parseIcsDate(line)
    } else if (line.startsWith('DTEND')) {
      endDate = parseIcsDate(line)
    } else if (line.startsWith('ORGANIZER')) {
      const orgMatch = line.match(/mailto:([^"\s]+)/i)
      if (orgMatch) {
        organizerEmail = orgMatch[1]
      }
      const cnMatch = line.match(/CN=([^;:]+)/i)
      if (cnMatch) {
        organizerName = cnMatch[1].replace(/"/g, '')
      }
    } else if (line.startsWith('LOCATION:') || line.startsWith('LOCATION;')) {
      location = extractIcsValue(line)
    } else if (line.startsWith('STATUS:')) {
      status = line.substring(7).trim()
    }
  }

  // Skip cancelled events
  if (status === 'CANCELLED') {
    return null
  }

  // Need at least summary, start date, and organizer
  if (!summary || !startDate || !organizerEmail) {
    return null
  }

  return {
    uid,
    summary,
    description: description || undefined,
    startDate,
    endDate: endDate && endDate !== startDate ? endDate : undefined,
    organizerEmail,
    organizerName: organizerName || undefined,
    location: location || undefined,
    status: status || undefined,
  }
}

// Extract value from ICS line (handles parameters like SUMMARY;LANGUAGE=en:Value)
function extractIcsValue(line: string): string {
  const colonIndex = line.indexOf(':')
  if (colonIndex === -1) return ''
  return line.substring(colonIndex + 1).trim()
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\\\/g, '\\')
}

// Parse ICS date format to ISO date string
function parseIcsDate(line: string): string {
  const colonIndex = line.indexOf(':')
  if (colonIndex === -1) return ''

  const dateStr = line.substring(colonIndex + 1).trim()

  // Handle various formats: 20251217, 20251217T070000, 20251217T070000Z
  const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!match) return ''

  return `${match[1]}-${match[2]}-${match[3]}`
}

// Map Gmail invite to our MemberEvent format
export function mapGmailInviteToMemberEvent(
  invite: ParsedCalendarInvite,
  memberId: string,
  householdId: string
) {
  // Guess event type from summary
  const summary = invite.summary.toLowerCase()
  let eventType: 'work' | 'travel' | 'family' | 'other' = 'other'

  if (summary.includes('reise') || summary.includes('travel') || summary.includes('flight') || summary.includes('fly')) {
    eventType = 'travel'
  } else if (summary.includes('jobb') || summary.includes('work') || summary.includes('møte') || summary.includes('meeting')) {
    eventType = 'work'
  } else if (summary.includes('familie') || summary.includes('family') || summary.includes('bursdag') || summary.includes('birthday')) {
    eventType = 'family'
  }

  return {
    household_id: householdId,
    member_id: memberId,
    date: invite.startDate,
    end_date: invite.endDate || null,
    title: invite.summary,
    event_type: eventType,
    source: 'google_calendar' as const,
    source_email: invite.organizerEmail,
    google_event_id: invite.uid,  // Use UID as unique identifier
  }
}
