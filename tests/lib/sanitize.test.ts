import { describe, it, expect } from 'vitest'
import {
  truncate,
  sanitizeString,
  sanitizeDate,
  sanitizeTime,
  isUrlAllowed,
  sanitizePromptInput,
  sanitizePromptArray,
} from '@/lib/sanitize'

describe('truncate', () => {
  it('returns null for null/undefined', () => {
    expect(truncate(null, 10)).toBeNull()
    expect(truncate(undefined, 10)).toBeNull()
  })

  it('returns null for empty strings', () => {
    expect(truncate('', 10)).toBeNull()
    expect(truncate('   ', 10)).toBeNull()
  })

  it('returns string unchanged if under limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates with ellipsis if over limit', () => {
    expect(truncate('hello world', 8)).toBe('hello...')
  })

  it('converts non-strings to strings', () => {
    expect(truncate(123, 10)).toBe('123')
    expect(truncate({ foo: 'bar' }, 20)).toBe('[object Object]')
  })
})

describe('sanitizeString', () => {
  it('returns null for null/undefined', () => {
    expect(sanitizeString(null)).toBeNull()
    expect(sanitizeString(undefined)).toBeNull()
  })

  it('removes null characters', () => {
    expect(sanitizeString('hello\0world')).toBe('helloworld')
  })

  it('removes control characters', () => {
    expect(sanitizeString('hello\x00\x01\x02world')).toBe('helloworld')
  })

  it('preserves newlines and tabs', () => {
    expect(sanitizeString('hello\nworld')).toBe('hello\nworld')
    expect(sanitizeString('hello\tworld')).toBe('hello\tworld')
  })

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello')
  })
})

describe('sanitizeDate', () => {
  it('returns null for invalid formats', () => {
    expect(sanitizeDate('2024-1-1')).toBeNull() // Wrong format
    expect(sanitizeDate('01-01-2024')).toBeNull() // Wrong order
    expect(sanitizeDate('not a date')).toBeNull()
  })

  it('returns null for invalid dates', () => {
    expect(sanitizeDate('2024-13-01')).toBeNull() // Invalid month
    expect(sanitizeDate('2024-02-30')).toBeNull() // Invalid day
  })

  it('accepts valid dates', () => {
    expect(sanitizeDate('2024-12-25')).toBe('2024-12-25')
    expect(sanitizeDate('2024-02-29')).toBe('2024-02-29') // Leap year
  })
})

describe('sanitizeTime', () => {
  it('returns null for invalid formats', () => {
    expect(sanitizeTime('9:30')).toBeNull() // Wrong format
    expect(sanitizeTime('09:5')).toBeNull()
    expect(sanitizeTime('not a time')).toBeNull()
  })

  it('returns null for out of range values', () => {
    expect(sanitizeTime('25:00')).toBeNull()
    expect(sanitizeTime('12:60')).toBeNull()
  })

  it('accepts valid times', () => {
    expect(sanitizeTime('09:30')).toBe('09:30')
    expect(sanitizeTime('23:59')).toBe('23:59')
    expect(sanitizeTime('00:00:00')).toBe('00:00:00')
  })
})

describe('isUrlAllowed (SSRF prevention)', () => {
  it('blocks localhost', () => {
    expect(isUrlAllowed('http://localhost')).toBe(false)
    expect(isUrlAllowed('http://127.0.0.1')).toBe(false)
    expect(isUrlAllowed('http://127.0.0.1:8080')).toBe(false)
  })

  it('blocks private IP ranges', () => {
    expect(isUrlAllowed('http://10.0.0.1')).toBe(false)
    expect(isUrlAllowed('http://172.16.0.1')).toBe(false)
    expect(isUrlAllowed('http://192.168.1.1')).toBe(false)
  })

  it('blocks cloud metadata endpoints', () => {
    expect(isUrlAllowed('http://169.254.169.254')).toBe(false)
  })

  it('blocks non-http protocols', () => {
    expect(isUrlAllowed('file:///etc/passwd')).toBe(false)
    expect(isUrlAllowed('javascript:alert(1)')).toBe(false)
  })

  it('allows public URLs', () => {
    expect(isUrlAllowed('https://example.com')).toBe(true)
    expect(isUrlAllowed('https://api.github.com')).toBe(true)
  })
})

describe('sanitizePromptInput (prompt injection prevention)', () => {
  it('removes newlines and tabs', () => {
    expect(sanitizePromptInput('hello\nworld\ttab')).toBe('hello world tab')
  })

  it('collapses multiple spaces', () => {
    expect(sanitizePromptInput('hello    world')).toBe('hello world')
  })

  it('removes injection markers', () => {
    expect(sanitizePromptInput('<script>alert(1)</script>')).toBe('scriptalert(1)/script')
    expect(sanitizePromptInput('{{system}}')).toBe('system')
    expect(sanitizePromptInput('```code```')).toBe('code')
    expect(sanitizePromptInput('[INST]')).toBe('INST')
  })

  it('limits length', () => {
    const longInput = 'a'.repeat(200)
    expect(sanitizePromptInput(longInput, 100)).toHaveLength(100)
  })

  it('handles empty input', () => {
    expect(sanitizePromptInput('')).toBe('')
    expect(sanitizePromptInput(null as unknown as string)).toBe('')
  })
})

describe('sanitizePromptArray', () => {
  it('sanitizes each item', () => {
    expect(sanitizePromptArray(['<peanuts>', 'milk'])).toEqual(['peanuts', 'milk'])
  })

  it('filters out empty items after sanitization', () => {
    expect(sanitizePromptArray(['valid', '', '  ', '[]'])).toEqual(['valid'])
  })

  it('limits item length', () => {
    const items = ['a'.repeat(100)]
    expect(sanitizePromptArray(items, 10)[0]).toHaveLength(10)
  })
})
