import { describe, it, expect } from 'vitest'
import { parseICSContent } from '@/lib/ics-parser'

describe('parseICSContent', () => {
  const startDate = new Date(2025, 11, 1) // Dec 1, 2025
  const endDate = new Date(2025, 11, 31) // Dec 31, 2025

  it('parses a simple event', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test-event-1
SUMMARY:Team Meeting
DTSTART:20251215T090000
DTEND:20251215T100000
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(1)
    expect(events[0].summary).toBe('Team Meeting')
    expect(events[0].startDate.getDate()).toBe(15)
    expect(events[0].startDate.getHours()).toBe(9)
    expect(events[0].endDate.getHours()).toBe(10)
    expect(events[0].isAllDay).toBe(false)
  })

  it('parses all-day events', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:all-day-1
SUMMARY:Christmas
DTSTART;VALUE=DATE:20251225
DTEND;VALUE=DATE:20251226
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(1)
    expect(events[0].summary).toBe('Christmas')
    expect(events[0].isAllDay).toBe(true)
    expect(events[0].startDate.getDate()).toBe(25)
  })

  it('parses UTC datetimes correctly', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:utc-event
SUMMARY:UTC Meeting
DTSTART:20251210T140000Z
DTEND:20251210T150000Z
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(1)
    expect(events[0].startDate.getUTCHours()).toBe(14)
  })

  it('decodes escaped characters', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:escape-test
SUMMARY:Meeting\\, important
DESCRIPTION:Line 1\\nLine 2
DTSTART:20251215T090000
DTEND:20251215T100000
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(1)
    expect(events[0].summary).toBe('Meeting, important')
    expect(events[0].description).toBe('Line 1\nLine 2')
  })

  it('filters events outside date range', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:outside-range
SUMMARY:November Event
DTSTART:20251115T090000
DTEND:20251115T100000
END:VEVENT
BEGIN:VEVENT
UID:inside-range
SUMMARY:December Event
DTSTART:20251215T090000
DTEND:20251215T100000
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(1)
    expect(events[0].summary).toBe('December Event')
  })

  it('expands weekly recurring events', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:weekly-recurring
SUMMARY:Weekly Standup
DTSTART:20251201T090000
DTEND:20251201T093000
RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=20251231T235959Z
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    // Dec 2025 has 5 Mondays (1, 8, 15, 22, 29)
    expect(events.length).toBeGreaterThanOrEqual(4)
    expect(events.every(e => e.summary === 'Weekly Standup')).toBe(true)
  })

  it('expands daily recurring events', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:daily-recurring
SUMMARY:Daily Check-in
DTSTART:20251210T080000
DTEND:20251210T081500
RRULE:FREQ=DAILY;COUNT=5
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(5)
    expect(events[0].startDate.getDate()).toBe(10)
    expect(events[4].startDate.getDate()).toBe(14)
  })

  it('respects EXDATE exclusions', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:recurring-with-exclusion
SUMMARY:Weekly with Skip
DTSTART:20251201T090000
DTEND:20251201T100000
RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4
EXDATE:20251208T090000
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    // 4 instances minus 1 exclusion = 3
    expect(events).toHaveLength(3)
    // Dec 8 should be excluded
    const dec8Events = events.filter(e => e.startDate.getDate() === 8)
    expect(dec8Events).toHaveLength(0)
  })

  it('parses Microsoft busy status', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:busy-event
SUMMARY:Busy Meeting
DTSTART:20251215T090000
DTEND:20251215T100000
X-MICROSOFT-CDO-BUSYSTATUS:BUSY
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(1)
    expect(events[0].busyStatus).toBe('BUSY')
  })

  it('handles unfolded lines (continuation)', () => {
    // ICS unfolds by removing CRLF+SPACE/TAB, joining directly without additional space
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:folded-line-test
SUMMARY:This is a very long summary that has been
 folded across multiple lines
DTSTART:20251215T090000
DTEND:20251215T100000
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(1)
    // Unfold removes the newline and continuation space, joining directly
    expect(events[0].summary).toBe('This is a very long summary that has beenfolded across multiple lines')
  })

  it('sorts events by start date', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:later
SUMMARY:Later Event
DTSTART:20251220T090000
DTEND:20251220T100000
END:VEVENT
BEGIN:VEVENT
UID:earlier
SUMMARY:Earlier Event
DTSTART:20251210T090000
DTEND:20251210T100000
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(2)
    expect(events[0].summary).toBe('Earlier Event')
    expect(events[1].summary).toBe('Later Event')
  })

  it('parses location field', () => {
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:with-location
SUMMARY:Office Meeting
LOCATION:Conference Room A
DTSTART:20251215T090000
DTEND:20251215T100000
END:VEVENT
END:VCALENDAR`

    const events = parseICSContent(icsContent, startDate, endDate)

    expect(events).toHaveLength(1)
    expect(events[0].location).toBe('Conference Room A')
  })
})
