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

  const now = new Date()
  const today = formatDateISO(now)

  // Derive school year dynamically (Aug-Jul cycle)
  // August-December = currentYear-nextYear, January-July = prevYear-currentYear
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() // 0-indexed (0=Jan, 7=Aug)
  const schoolYearStart = currentMonth >= 7 ? currentYear : currentYear - 1
  const schoolYearEnd = schoolYearStart + 1
  const schoolYear = `${schoolYearStart}-${schoolYearEnd}`

  // Clean HTML to reduce tokens
  const cleanedHtml = cleanHtml(html)

  const prompt = `Du er en ekspert på å lese norske skolekalendere og barnehagerutiner.

Analyser dette innholdet og trekk ut ALLE hendelser, ferier, fridager og viktige datoer.

Innhold (kan inneholde markdown-tabeller):
"""
${cleanedHtml}
"""

Kontekst:
- Barnets navn: ${context.childName || 'Ukjent'}
- Skole/barnehage: ${context.schoolName || 'Ukjent'}
- Dagens dato: ${today}
- Skoleår: ${schoolYear}

VIKTIG for tabeller:
- Tabeller viser ofte måned i første kolonne, så datoer som "14. august" tilhører den måneden
- "Skolestart" betyr første skoledag
- "Elevene slutter kl. 11.00" betyr tidlig slutt
- "Planleggingsdag" eller "Planl.dag" = ingen undervisning
- "Stengt" = helt stengt
- "Ferie" = skolefri periode (ofte med start- og sluttdato)
- "Dugnad" = foreldreaktivitet
- "Foreldremøte" = møte for foreldre

Trekk ut disse hendelsestypene:
- Skolestart og skoleslutt
- Høstferie, vinterferie, påskeferie, sommerferie
- Planleggingsdager (elevene fri)
- Stengt (SFO/barnehage)
- Foreldremøter og dugnader
- Arrangement og aktiviteter
- Tidlig slutt-dager
- Fridager og helligdager

Returner en JSON-array. Hvert element skal ha:
- "title": Tydelig norsk tittel (maks 60 tegn)
- "date": Dato i YYYY-MM-DD format (bruk år ${schoolYearStart} for aug-des, ${schoolYearEnd} for jan-juli)
- "endDate": Sluttdato i YYYY-MM-DD hvis det er en periode (valgfri)
- "time": Klokkeslett i HH:MM format hvis nevnt (valgfri)
- "eventType": "holiday" | "event" | "deadline" | "closure" | "other"
- "confidence": 0.0-1.0 hvor sikker du er
- "description": Ekstra informasjon (valgfri)

Returner KUN JSON-arrayen, ingen annen tekst. Hvis ingen hendelser funnet, returner [].`

  // Log cleaned HTML size for debugging
  console.log(`[EventExtraction] Cleaned HTML size: ${cleanedHtml.length} chars, tables preserved: ${cleanedHtml.includes('| --- |')}`)

  // Log first 500 chars of cleaned content to help debug
  if (cleanedHtml.length < 100) {
    console.log(`[EventExtraction] WARNING: Very short content after cleaning. Raw HTML size: ${html.length} chars`)
  }
  console.log(`[EventExtraction] Content preview: ${cleanedHtml.slice(0, 500)}...`)

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
      console.error('[EventExtraction] OpenRouter API error:', response.status, errorText)
      return []
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      console.log('[EventExtraction] No content in AI response. Full response:', JSON.stringify(data).slice(0, 500))
      return []
    }

    console.log(`[EventExtraction] AI response (first 500 chars): ${content.slice(0, 500)}...`)

    const events = parseExtractedEvents(content)
    console.log(`[EventExtraction] AI extracted ${events.length} events from ${context.schoolName || 'unknown source'}`)

    if (events.length === 0 && content.length > 10) {
      console.log(`[EventExtraction] WARNING: AI returned content but 0 events parsed. Check JSON parsing.`)
    }

    return events
  } catch (error) {
    console.error('[EventExtraction] Error extracting events from HTML:', error)
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
 * Convert HTML tables to markdown table format.
 * This preserves the column relationships which is crucial for understanding calendar data.
 */
function convertTablesToMarkdown(html: string): string {
  // Find all tables and convert them
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi

  return html.replace(tableRegex, (_, tableContent: string) => {
    const rows: string[][] = []

    // Extract rows (handle both thead/tbody and direct tr)
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch: RegExpExecArray | null

    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const rowContent = rowMatch[1]
      const cells: string[] = []

      // Extract cells (th or td)
      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi
      let cellMatch: RegExpExecArray | null

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        // Clean cell content: remove tags, normalize whitespace
        let cellText = cellMatch[1]
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim()

        // Truncate very long cells
        if (cellText.length > 200) {
          cellText = cellText.slice(0, 200) + '...'
        }

        cells.push(cellText)
      }

      if (cells.length > 0) {
        rows.push(cells)
      }
    }

    if (rows.length === 0) {
      return ''
    }

    // Convert to markdown table format
    const markdown: string[] = []

    // Header row
    if (rows.length > 0) {
      markdown.push('| ' + rows[0].join(' | ') + ' |')
      markdown.push('| ' + rows[0].map(() => '---').join(' | ') + ' |')
    }

    // Data rows
    for (let i = 1; i < rows.length; i++) {
      markdown.push('| ' + rows[i].join(' | ') + ' |')
    }

    return '\n\n' + markdown.join('\n') + '\n\n'
  })
}

/**
 * Clean HTML to reduce tokens while preserving meaningful content.
 * Especially preserves table structure for calendar pages.
 */
function cleanHtml(html: string): string {
  // Remove scripts, styles, comments first
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')

  // Convert tables to markdown format BEFORE stripping other tags
  // This preserves the column structure which is crucial for calendars
  cleaned = convertTablesToMarkdown(cleaned)

  // Convert other tags to readable format
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
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
    .replace(/[ \t]+/g, ' ')  // Collapse horizontal whitespace only
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Limit length (gemini-2.5-flash-lite has 1M token context, so 50K chars is safe)
  return cleaned.slice(0, 50000)
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
