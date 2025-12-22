import { extractJSON } from '@/lib/json-extract'
import { formatDateISO } from '@/lib/utils'

export interface ExtractedEvent {
  title: string
  date: string          // YYYY-MM-DD
  endDate?: string      // YYYY-MM-DD
  time?: string         // HH:MM
  eventType: 'holiday' | 'event' | 'deadline' | 'closure' | 'other'
  confidence: number    // 0.0-1.0
  description?: string
}

interface VisionContent {
  type: 'image_url'
  image_url: {
    url: string
  }
}

interface TextContent {
  type: 'text'
  text: string
}

type MessageContent = VisionContent | TextContent

/**
 * Extract events from HTML content using AI.
 */
export async function extractEventsFromHtml(
  html: string,
  context: { childName?: string; schoolName?: string; model: string }
): Promise<ExtractedEvent[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set')
    return []
  }

  const today = formatDateISO(new Date())

  // Clean HTML to reduce tokens
  const cleanedHtml = cleanHtml(html)

  const prompt = `Analyze this school calendar or event page and extract all events, holidays, and important dates.

Page content:
"""
${cleanedHtml}
"""

Context:
- Child's name: ${context.childName || 'Unknown'}
- School/organization: ${context.schoolName || 'Unknown'}
- Today's date: ${today}

Extract all events you find, including:
- School holidays and closures
- Important dates and deadlines
- Events and activities
- Parent meetings
- Exams and tests

Return a JSON array. Each item should have:
- "title": Clear Norwegian title (max 60 chars)
- "date": Date in YYYY-MM-DD format
- "endDate": End date in YYYY-MM-DD if it's a period (optional)
- "time": Time in HH:MM format if mentioned (optional)
- "eventType": "holiday" | "event" | "deadline" | "closure" | "other"
- "confidence": 0.0-1.0 how confident you are this is correct
- "description": Additional context (optional)

Return only the JSON array, no other text. If no events found, return [].`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'https://familjen.eu',
        'X-Title': 'Familjen',
      },
      body: JSON.stringify({
        model: context.model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenRouter API error:', response.status, errorText)
      return []
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return []
    }

    return parseExtractedEvents(content)
  } catch (error) {
    console.error('Error extracting events from HTML:', error)
    return []
  }
}

/**
 * Extract events from a PDF document using AI vision.
 */
export async function extractEventsFromPdf(
  pdfBase64: string,
  context: { source?: string; model: string }
): Promise<{ events: ExtractedEvent[] }> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set')
    return { events: [] }
  }

  const today = formatDateISO(new Date())

  const prompt = `Analyze this document image and extract all events, dates, and important information.

Context:
- Document source: ${context.source || 'Unknown'}
- Today's date: ${today}

Extract all events you find, including:
- Meetings and appointments
- Deadlines and due dates
- Events and activities
- Holidays and closures
- Important dates

Return a JSON array. Each item should have:
- "title": Clear Norwegian title (max 60 chars)
- "date": Date in YYYY-MM-DD format
- "endDate": End date in YYYY-MM-DD if it's a period (optional)
- "time": Time in HH:MM format if mentioned (optional)
- "eventType": "holiday" | "event" | "deadline" | "closure" | "other"
- "confidence": 0.0-1.0 how confident you are this is correct
- "description": Additional context (optional)

Return only the JSON array, no other text. If no events found, return [].`

  try {
    const messageContent: MessageContent[] = [
      {
        type: 'image_url',
        image_url: {
          url: `data:application/pdf;base64,${pdfBase64}`,
        },
      },
      {
        type: 'text',
        text: prompt,
      },
    ]

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'https://familjen.eu',
        'X-Title': 'Familjen',
      },
      body: JSON.stringify({
        model: context.model,
        messages: [
          {
            role: 'user',
            content: messageContent,
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenRouter API error:', response.status, errorText)
      return { events: [] }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return { events: [] }
    }

    return { events: parseExtractedEvents(content) }
  } catch (error) {
    console.error('Error extracting events from PDF:', error)
    return { events: [] }
  }
}

/**
 * Extract events from an image (screenshot, photo of calendar, etc.) using AI vision.
 */
export async function extractEventsFromImage(
  imageBase64: string,
  mimeType: string,
  context: { source?: string; model: string }
): Promise<ExtractedEvent[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set')
    return []
  }

  const today = formatDateISO(new Date())

  const prompt = `Analyze this image and extract all events, dates, and important information you can see.

Context:
- Image source: ${context.source || 'Unknown'}
- Today's date: ${today}

Extract all events you find, including:
- Calendar entries
- Event announcements
- Deadlines and due dates
- Holidays and closures

Return a JSON array. Each item should have:
- "title": Clear Norwegian title (max 60 chars)
- "date": Date in YYYY-MM-DD format
- "endDate": End date in YYYY-MM-DD if it's a period (optional)
- "time": Time in HH:MM format if mentioned (optional)
- "eventType": "holiday" | "event" | "deadline" | "closure" | "other"
- "confidence": 0.0-1.0 how confident you are this is correct
- "description": Additional context (optional)

Return only the JSON array, no other text. If no events found, return [].`

  try {
    const messageContent: MessageContent[] = [
      {
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${imageBase64}`,
        },
      },
      {
        type: 'text',
        text: prompt,
      },
    ]

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'https://familjen.eu',
        'X-Title': 'Familjen',
      },
      body: JSON.stringify({
        model: context.model,
        messages: [
          {
            role: 'user',
            content: messageContent,
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenRouter API error:', response.status, errorText)
      return []
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return []
    }

    return parseExtractedEvents(content)
  } catch (error) {
    console.error('Error extracting events from image:', error)
    return []
  }
}

/**
 * Parse extracted events from AI response.
 */
function parseExtractedEvents(content: string): ExtractedEvent[] {
  const events = extractJSON<ExtractedEvent[]>(content)

  if (!Array.isArray(events)) {
    return []
  }

  return events
    .filter(
      (event) =>
        event &&
        typeof event.title === 'string' &&
        event.title.length > 0 &&
        isValidDate(event.date)
    )
    .map((event) => ({
      title: event.title.slice(0, 100),
      date: event.date,
      endDate: isValidDate(event.endDate) ? event.endDate : undefined,
      time: isValidTime(event.time) ? event.time : undefined,
      eventType: isValidEventType(event.eventType) ? event.eventType : 'other',
      confidence: typeof event.confidence === 'number' ? Math.min(1, Math.max(0, event.confidence)) : 0.5,
      description: event.description || undefined,
    }))
}

/**
 * Clean HTML to reduce tokens while preserving meaningful content.
 */
function cleanHtml(html: string): string {
  // Remove scripts, styles, comments
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')

  // Convert tags to readable format
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')

  // Clean up whitespace
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Limit length
  return cleaned.slice(0, 15000)
}

/**
 * Validate date string format (YYYY-MM-DD).
 */
function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string') return false
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
}

/**
 * Validate time string format (HH:MM or HH:MM:SS).
 */
function isValidTime(time: unknown): time is string {
  if (typeof time !== 'string') return false
  return /^\d{2}:\d{2}(:\d{2})?$/.test(time)
}

/**
 * Validate event type.
 */
function isValidEventType(type: unknown): type is ExtractedEvent['eventType'] {
  return typeof type === 'string' && ['holiday', 'event', 'deadline', 'closure', 'other'].includes(type)
}
