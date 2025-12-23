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

  // Search for emails with calendar invites
  // Broad search: any email with attachments, then filter by MIME type during processing
  // This catches Outlook/Teams invites that have inline text/calendar parts
  let query = 'has:attachment'
  if (options.afterDate) {
    const afterDateFormatted = options.afterDate.replace(/-/g, '/')
    query += ` after:${afterDateFormatted}`
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('Gmail search query:', query)
  }

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: options.maxResults || 50,
  })

  const messages = response.data.messages || []
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Gmail Sync] Found ${messages.length} messages with attachments`)
  }

  const invites: ParsedCalendarInvite[] = []

  for (const message of messages) {
    if (!message.id) continue

    try {
      const invite = await extractCalendarInviteFromMessage(gmail, message.id)
      if (invite) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Gmail Sync] Parsed: "${invite.summary}" from ${invite.organizerEmail}`)
        }
        invites.push(invite)
      }
    } catch (error) {
      console.error(`[Gmail Sync] Failed to parse message ${message.id}:`, error)
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Gmail Sync] Total invites found: ${invites.length}`)
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

  if (process.env.NODE_ENV === 'development') {
    console.log(`Processing message ${messageId}...`)
  }

  // Try to find .ics content inline first
  let icsContent = findIcsContent(payload)

  // If not found inline, check for attachments that need separate fetch
  if (!icsContent) {
    const attachmentInfo = findCalendarAttachment(payload)
    if (attachmentInfo) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`Fetching attachment ${attachmentInfo.attachmentId}...`)
      }
      try {
        const attachment = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: attachmentInfo.attachmentId,
        })
        if (attachment.data.data) {
          icsContent = Buffer.from(attachment.data.data, 'base64').toString('utf-8')
          if (process.env.NODE_ENV === 'development') {
            console.log(`Fetched attachment (${icsContent.length} chars)`)
          }
        }
      } catch (err) {
        console.error('Failed to fetch attachment:', err)
      }
    }
  }

  if (!icsContent) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`No calendar content found in message ${messageId}`)
    }
    return null
  }

  // Parse the .ics content
  return parseIcsContent(icsContent, messageId)
}

// Find calendar attachment that needs separate fetch
function findCalendarAttachment(payload: gmail_v1.Schema$MessagePart): { attachmentId: string } | null {
  if (payload.mimeType === 'text/calendar' || payload.filename?.endsWith('.ics')) {
    if (payload.body?.attachmentId) {
      return { attachmentId: payload.body.attachmentId }
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const result = findCalendarAttachment(part)
      if (result) return result
    }
  }

  return null
}

// Recursively find .ics content in message payload
function findIcsContent(payload: gmail_v1.Schema$MessagePart, depth = 0): string | null {
  const isDev = process.env.NODE_ENV === 'development'
  const indent = '  '.repeat(depth)

  if (isDev) {
    console.log(`${indent}Checking part: mimeType=${payload.mimeType}, filename=${payload.filename || 'none'}`)
  }

  // Check if this part is an .ics attachment or calendar data
  if (payload.mimeType === 'text/calendar' || payload.filename?.endsWith('.ics')) {
    if (payload.body?.data) {
      const content = Buffer.from(payload.body.data, 'base64').toString('utf-8')
      if (isDev) {
        console.log(`${indent}Found calendar data (${content.length} chars)`)
      }
      return content
    } else if (payload.body?.attachmentId) {
      // Attachment data needs separate fetch - log this case
      if (isDev) {
        console.log(`${indent}Calendar attachment needs separate fetch: ${payload.body.attachmentId}`)
      }
    }
  }

  // Check nested parts
  if (payload.parts) {
    if (isDev) {
      console.log(`${indent}Checking ${payload.parts.length} nested parts...`)
    }
    for (const part of payload.parts) {
      const icsContent = findIcsContent(part, depth + 1)
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
