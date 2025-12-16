import { google, calendar_v3, Auth } from 'googleapis'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',  // To get the connected Gmail address
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
