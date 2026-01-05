import { describe, it, expect } from 'vitest'
import { formatDateISO, getWeekStart, getWeekDates, isWeekend, isSameDay, addDays, normalizePath } from '@/lib/utils'

describe('formatDateISO', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2025, 11, 22) // Dec 22, 2025
    expect(formatDateISO(date)).toBe('2025-12-22')
  })

  it('pads single digit months and days', () => {
    const date = new Date(2025, 0, 5) // Jan 5, 2025
    expect(formatDateISO(date)).toBe('2025-01-05')
  })
})

describe('getWeekStart', () => {
  it('returns Monday for a Wednesday', () => {
    const wednesday = new Date(2025, 11, 24) // Wed Dec 24, 2025
    const monday = getWeekStart(wednesday)
    expect(monday.getDay()).toBe(1) // Monday
    expect(formatDateISO(monday)).toBe('2025-12-22')
  })

  it('returns Monday for a Monday', () => {
    const monday = new Date(2025, 11, 22) // Mon Dec 22, 2025
    const result = getWeekStart(monday)
    expect(result.getDay()).toBe(1)
    expect(formatDateISO(result)).toBe('2025-12-22')
  })

  it('returns previous Monday for a Sunday', () => {
    const sunday = new Date(2025, 11, 28) // Sun Dec 28, 2025
    const monday = getWeekStart(sunday)
    expect(monday.getDay()).toBe(1)
    expect(formatDateISO(monday)).toBe('2025-12-22')
  })
})

describe('getWeekDates', () => {
  it('returns 7 days starting from Monday', () => {
    const monday = new Date(2025, 11, 22)
    const dates = getWeekDates(monday)
    expect(dates).toHaveLength(7)
    expect(formatDateISO(dates[0])).toBe('2025-12-22') // Mon
    expect(formatDateISO(dates[6])).toBe('2025-12-28') // Sun
  })
})

describe('isWeekend', () => {
  it('returns true for Saturday', () => {
    const saturday = new Date(2025, 11, 27)
    expect(isWeekend(saturday)).toBe(true)
  })

  it('returns true for Sunday', () => {
    const sunday = new Date(2025, 11, 28)
    expect(isWeekend(sunday)).toBe(true)
  })

  it('returns false for weekdays', () => {
    const monday = new Date(2025, 11, 22)
    const friday = new Date(2025, 11, 26)
    expect(isWeekend(monday)).toBe(false)
    expect(isWeekend(friday)).toBe(false)
  })
})

describe('isSameDay', () => {
  it('returns true for same day', () => {
    const date1 = new Date(2025, 11, 22, 10, 30)
    const date2 = new Date(2025, 11, 22, 18, 45)
    expect(isSameDay(date1, date2)).toBe(true)
  })

  it('returns false for different days', () => {
    const date1 = new Date(2025, 11, 22)
    const date2 = new Date(2025, 11, 23)
    expect(isSameDay(date1, date2)).toBe(false)
  })
})

describe('addDays', () => {
  it('adds days correctly', () => {
    const date = new Date(2025, 11, 22)
    const result = addDays(date, 5)
    expect(formatDateISO(result)).toBe('2025-12-27')
  })

  it('handles month boundaries', () => {
    const date = new Date(2025, 11, 30)
    const result = addDays(date, 5)
    expect(formatDateISO(result)).toBe('2026-01-04')
  })

  it('handles negative days', () => {
    const date = new Date(2025, 11, 22)
    const result = addDays(date, -5)
    expect(formatDateISO(result)).toBe('2025-12-17')
  })
})

describe('normalizePath', () => {
  it('removes trailing slash from paths', () => {
    expect(normalizePath('/uke/')).toBe('/uke')
    expect(normalizePath('/innstillinger/')).toBe('/innstillinger')
  })

  it('preserves root path', () => {
    expect(normalizePath('/')).toBe('/')
  })

  it('removes query strings', () => {
    expect(normalizePath('/uke?demo=true')).toBe('/uke')
    expect(normalizePath('/uke?week=2&demo=true')).toBe('/uke')
  })

  it('removes both query string and trailing slash', () => {
    expect(normalizePath('/uke/?demo=true')).toBe('/uke')
  })

  it('handles paths without trailing slash (no change)', () => {
    expect(normalizePath('/uke')).toBe('/uke')
    expect(normalizePath('/innstillinger')).toBe('/innstillinger')
  })

  it('handles empty string', () => {
    expect(normalizePath('')).toBe('')
  })

  it('handles nested paths', () => {
    expect(normalizePath('/admin/users/')).toBe('/admin/users')
    expect(normalizePath('/admin/users')).toBe('/admin/users')
  })

  it('handles multiple trailing slashes by removing only one', () => {
    // This matches current behavior - only removes one trailing slash
    expect(normalizePath('/uke//')).toBe('/uke/')
  })
})
