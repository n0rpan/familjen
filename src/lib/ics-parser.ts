/**
 * ICS Calendar Parser
 *
 * Parses ICS (iCalendar) format files and expands recurring events.
 * Designed for Microsoft Exchange/O365 published calendars.
 */

export interface ICSEvent {
  uid: string
  summary: string
  description?: string
  location?: string
  startDate: Date
  endDate: Date
  isAllDay: boolean
  busyStatus?: 'BUSY' | 'FREE' | 'TENTATIVE'
}

interface RawICSEvent {
  uid: string
  summary: string
  description?: string
  location?: string
  dtstart: string
  dtend: string
  tzid?: string
  isAllDay: boolean
  busyStatus?: string
  rrule?: string
  exdates?: string[]
}

interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  until?: Date
  count?: number
  interval: number
  byDay?: string[]
}

/**
 * Parse ICS content and return events within the specified date range.
 * Automatically expands recurring events.
 */
export function parseICSContent(
  icsContent: string,
  startDate: Date,
  endDate: Date
): ICSEvent[] {
  // Unfold lines (ICS continuation lines start with space or tab)
  const unfoldedContent = icsContent.replace(/\r?\n[ \t]/g, '')
  const lines = unfoldedContent.split(/\r?\n/)

  const rawEvents: RawICSEvent[] = []
  let currentEvent: Partial<RawICSEvent> | null = null
  let exdates: string[] = []

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      currentEvent = {}
      exdates = []
    } else if (line === 'END:VEVENT' && currentEvent) {
      if (currentEvent.uid && currentEvent.summary && currentEvent.dtstart) {
        rawEvents.push({
          uid: currentEvent.uid,
          summary: currentEvent.summary,
          description: currentEvent.description,
          location: currentEvent.location,
          dtstart: currentEvent.dtstart,
          dtend: currentEvent.dtend || currentEvent.dtstart,
          tzid: currentEvent.tzid,
          isAllDay: currentEvent.isAllDay || false,
          busyStatus: currentEvent.busyStatus,
          rrule: currentEvent.rrule,
          exdates: exdates.length > 0 ? exdates : undefined,
        })
      }
      currentEvent = null
    } else if (currentEvent) {
      // Parse line
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const keyPart = line.substring(0, colonIndex)
      const value = line.substring(colonIndex + 1)

      // Extract base key and parameters
      const semicolonIndex = keyPart.indexOf(';')
      const baseKey = semicolonIndex === -1 ? keyPart : keyPart.substring(0, semicolonIndex)
      const params = semicolonIndex === -1 ? '' : keyPart.substring(semicolonIndex + 1)

      switch (baseKey) {
        case 'UID':
          currentEvent.uid = value
          break
        case 'SUMMARY':
          currentEvent.summary = decodeICSValue(value)
          break
        case 'DESCRIPTION':
          currentEvent.description = decodeICSValue(value)
          break
        case 'LOCATION':
          currentEvent.location = decodeICSValue(value)
          break
        case 'DTSTART':
          currentEvent.dtstart = value
          if (params.includes('VALUE=DATE')) {
            currentEvent.isAllDay = true
          }
          // Extract TZID if present
          const tzMatch = params.match(/TZID=([^;:]+)/)
          if (tzMatch) {
            currentEvent.tzid = tzMatch[1]
          }
          break
        case 'DTEND':
          currentEvent.dtend = value
          break
        case 'RRULE':
          currentEvent.rrule = value
          break
        case 'EXDATE':
          // Can have multiple values comma-separated
          exdates.push(...value.split(','))
          break
        case 'X-MICROSOFT-CDO-BUSYSTATUS':
          currentEvent.busyStatus = value
          break
        case 'X-MICROSOFT-CDO-ALLDAYEVENT':
          if (value === 'TRUE') {
            currentEvent.isAllDay = true
          }
          break
      }
    }
  }

  // Expand recurring events and filter by date range
  const expandedEvents: ICSEvent[] = []

  for (const rawEvent of rawEvents) {
    const baseStart = parseICSDateTime(rawEvent.dtstart, rawEvent.tzid)
    const baseEnd = parseICSDateTime(rawEvent.dtend, rawEvent.tzid)

    if (!baseStart || !baseEnd) continue

    if (rawEvent.rrule) {
      // Expand recurring event
      const rrule = parseRRule(rawEvent.rrule)
      if (rrule) {
        const instances = expandRecurringEvent(
          rawEvent,
          baseStart,
          baseEnd,
          rrule,
          startDate,
          endDate
        )
        expandedEvents.push(...instances)
      }
    } else {
      // Single event - check if in range
      if (baseStart <= endDate && baseEnd >= startDate) {
        expandedEvents.push({
          uid: rawEvent.uid,
          summary: rawEvent.summary,
          description: rawEvent.description,
          location: rawEvent.location,
          startDate: baseStart,
          endDate: baseEnd,
          isAllDay: rawEvent.isAllDay,
          busyStatus: rawEvent.busyStatus as ICSEvent['busyStatus'],
        })
      }
    }
  }

  // Sort by start date
  expandedEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())

  return expandedEvents
}

/**
 * Parse ICS datetime string to JavaScript Date.
 * Handles formats: 20241219T090000, 20241219T090000Z, 20241219
 */
function parseICSDateTime(value: string, tzid?: string): Date | null {
  if (!value) return null

  // Remove any timezone suffix for parsing
  const cleanValue = value.replace('Z', '')

  // All-day event format: YYYYMMDD
  if (cleanValue.length === 8) {
    const year = parseInt(cleanValue.substring(0, 4))
    const month = parseInt(cleanValue.substring(4, 6)) - 1
    const day = parseInt(cleanValue.substring(6, 8))
    return new Date(year, month, day)
  }

  // DateTime format: YYYYMMDDTHHMMSS
  if (cleanValue.length >= 15 && cleanValue.includes('T')) {
    const year = parseInt(cleanValue.substring(0, 4))
    const month = parseInt(cleanValue.substring(4, 6)) - 1
    const day = parseInt(cleanValue.substring(6, 8))
    const hour = parseInt(cleanValue.substring(9, 11))
    const minute = parseInt(cleanValue.substring(11, 13))
    const second = parseInt(cleanValue.substring(13, 15)) || 0

    // If original value ends with Z, it's UTC
    if (value.endsWith('Z')) {
      return new Date(Date.UTC(year, month, day, hour, minute, second))
    }

    // Otherwise, treat as local time (Norway timezone assumption)
    // Note: For proper timezone handling, we'd need a timezone library
    // For now, we assume the ICS times are in the user's local timezone
    return new Date(year, month, day, hour, minute, second)
  }

  return null
}

/**
 * Parse RRULE string into structured object.
 * Example: FREQ=WEEKLY;UNTIL=20250102T080000Z;INTERVAL=1;BYDAY=MO,TU,WE,TH
 */
function parseRRule(rrule: string): RRule | null {
  const parts = rrule.split(';')
  const result: Partial<RRule> = { interval: 1 }

  for (const part of parts) {
    const [key, value] = part.split('=')
    switch (key) {
      case 'FREQ':
        if (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(value)) {
          result.freq = value as RRule['freq']
        }
        break
      case 'UNTIL':
        result.until = parseICSDateTime(value) || undefined
        break
      case 'COUNT':
        result.count = parseInt(value)
        break
      case 'INTERVAL':
        result.interval = parseInt(value) || 1
        break
      case 'BYDAY':
        result.byDay = value.split(',')
        break
    }
  }

  if (!result.freq) return null
  return result as RRule
}

/**
 * Expand a recurring event into individual instances within the date range.
 */
function expandRecurringEvent(
  rawEvent: RawICSEvent,
  baseStart: Date,
  baseEnd: Date,
  rrule: RRule,
  rangeStart: Date,
  rangeEnd: Date
): ICSEvent[] {
  const events: ICSEvent[] = []
  const duration = baseEnd.getTime() - baseStart.getTime()

  // Parse exclusion dates
  const exdateSet = new Set<string>()
  if (rawEvent.exdates) {
    for (const exdate of rawEvent.exdates) {
      const parsed = parseICSDateTime(exdate, rawEvent.tzid)
      if (parsed) {
        exdateSet.add(formatDateKey(parsed))
      }
    }
  }

  // Determine end condition
  const maxDate = rrule.until && rrule.until < rangeEnd ? rrule.until : rangeEnd
  const maxCount = rrule.count || 1000 // Safety limit

  let currentStart = new Date(baseStart)
  let count = 0

  // Day of week mapping for BYDAY
  const dayMap: Record<string, number> = {
    SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
  }

  while (currentStart <= maxDate && count < maxCount) {
    // Check if this date should be included
    let include = true

    // Check BYDAY constraint for weekly recurrence
    if (rrule.freq === 'WEEKLY' && rrule.byDay) {
      const dayOfWeek = currentStart.getDay()
      const dayMatches = rrule.byDay.some((d) => {
        // Handle formats like "MO" or "1MO" (first Monday)
        const dayCode = d.replace(/^-?\d+/, '')
        return dayMap[dayCode] === dayOfWeek
      })
      include = dayMatches
    }

    // Check exclusion dates
    if (include && exdateSet.has(formatDateKey(currentStart))) {
      include = false
    }

    // Check if in range and add event
    if (include && currentStart >= rangeStart && currentStart <= rangeEnd) {
      const eventEnd = new Date(currentStart.getTime() + duration)
      events.push({
        uid: `${rawEvent.uid}_${formatDateKey(currentStart)}`,
        summary: rawEvent.summary,
        description: rawEvent.description,
        location: rawEvent.location,
        startDate: new Date(currentStart),
        endDate: eventEnd,
        isAllDay: rawEvent.isAllDay,
        busyStatus: rawEvent.busyStatus as ICSEvent['busyStatus'],
      })
    }

    // Advance to next occurrence
    switch (rrule.freq) {
      case 'DAILY':
        currentStart.setDate(currentStart.getDate() + rrule.interval)
        count++
        break
      case 'WEEKLY':
        if (rrule.byDay) {
          // Move to next day, count increments when we complete a week
          currentStart.setDate(currentStart.getDate() + 1)
          if (currentStart.getDay() === (baseStart.getDay() + 1) % 7) {
            // We've completed checking all days in this week
            currentStart.setDate(currentStart.getDate() + (rrule.interval - 1) * 7)
          }
        } else {
          currentStart.setDate(currentStart.getDate() + 7 * rrule.interval)
        }
        count++
        break
      case 'MONTHLY':
        currentStart.setMonth(currentStart.getMonth() + rrule.interval)
        count++
        break
      case 'YEARLY':
        currentStart.setFullYear(currentStart.getFullYear() + rrule.interval)
        count++
        break
    }
  }

  return events
}

/**
 * Format date as YYYYMMDD for comparison.
 */
function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

/**
 * Decode ICS escaped values.
 * ICS escapes: \n -> newline, \, -> comma, \; -> semicolon, \\ -> backslash
 */
function decodeICSValue(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/**
 * Fetch and parse an ICS calendar from a URL.
 */
export async function fetchAndParseICS(
  url: string,
  startDate: Date,
  endDate: Date
): Promise<ICSEvent[]> {
  const response = await fetch(url, {
    headers: {
      'Accept': 'text/calendar',
      'User-Agent': 'Familjen/1.0',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ICS: ${response.status} ${response.statusText}`)
  }

  const content = await response.text()
  return parseICSContent(content, startDate, endDate)
}
