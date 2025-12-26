import { describe, it, expect, vi } from 'vitest'
import {
  decryptCredentials,
  isSpondCredentials,
  isKidplanCredentials,
  isISkoleCredentials,
  isMyKidCredentials,
  type SpondCredentials,
} from '@/lib/credentials'

describe('decryptCredentials', () => {
  const createMockSupabase = (rpcResult: { data: string | null; error: Error | null }) => ({
    rpc: vi.fn().mockResolvedValue(rpcResult),
  })

  it('returns credentials on successful decryption', async () => {
    const mockCredentials = { email: 'test@example.com', password: 'secret' }
    const supabase = createMockSupabase({
      data: JSON.stringify(mockCredentials),
      error: null,
    })

    const result = await decryptCredentials<SpondCredentials>(supabase as any, 'encrypted-string')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.credentials.email).toBe('test@example.com')
      expect(result.credentials.password).toBe('secret')
    }
  })

  it('returns error when RPC fails', async () => {
    const supabase = createMockSupabase({
      data: null,
      error: new Error('Decryption failed'),
    })

    const result = await decryptCredentials<SpondCredentials>(supabase as any, 'encrypted-string')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('Failed to decrypt credentials')
    }
  })

  it('returns error when no data returned', async () => {
    const supabase = createMockSupabase({
      data: null,
      error: null,
    })

    const result = await decryptCredentials<SpondCredentials>(supabase as any, 'encrypted-string')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('No credentials returned')
    }
  })

  it('returns error when JSON parsing fails', async () => {
    const supabase = createMockSupabase({
      data: 'not valid json',
      error: null,
    })

    const result = await decryptCredentials<SpondCredentials>(supabase as any, 'encrypted-string')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('Invalid credentials format')
    }
  })
})

describe('isSpondCredentials', () => {
  it('returns true for valid Spond credentials', () => {
    expect(isSpondCredentials({ email: 'test@example.com', password: 'secret' })).toBe(true)
  })

  it('returns false for missing email', () => {
    expect(isSpondCredentials({ password: 'secret' })).toBe(false)
  })

  it('returns false for missing password', () => {
    expect(isSpondCredentials({ email: 'test@example.com' })).toBe(false)
  })

  it('returns false for non-object', () => {
    expect(isSpondCredentials(null)).toBe(false)
    expect(isSpondCredentials('string')).toBe(false)
    expect(isSpondCredentials(123)).toBe(false)
  })

  it('returns false for wrong types', () => {
    expect(isSpondCredentials({ email: 123, password: 'secret' })).toBe(false)
    expect(isSpondCredentials({ email: 'test', password: 123 })).toBe(false)
  })
})

describe('isKidplanCredentials', () => {
  it('returns true for valid Kidplan credentials', () => {
    expect(isKidplanCredentials({ email: 'test@example.com', password: 'secret' })).toBe(true)
  })

  it('accepts optional kindergartenId', () => {
    expect(
      isKidplanCredentials({ email: 'test@example.com', password: 'secret', kindergartenId: 123 })
    ).toBe(true)
  })

  it('returns false for missing fields', () => {
    expect(isKidplanCredentials({ email: 'test@example.com' })).toBe(false)
    expect(isKidplanCredentials({ password: 'secret' })).toBe(false)
  })
})

describe('isISkoleCredentials', () => {
  it('returns true for valid iSkole credentials', () => {
    expect(isISkoleCredentials({ username: 'user123', password: 'secret' })).toBe(true)
  })

  it('returns false for missing fields', () => {
    expect(isISkoleCredentials({ username: 'user123' })).toBe(false)
    expect(isISkoleCredentials({ password: 'secret' })).toBe(false)
  })

  it('returns false for wrong field names (email instead of username)', () => {
    expect(isISkoleCredentials({ email: 'test@example.com', password: 'secret' })).toBe(false)
  })
})

describe('isMyKidCredentials', () => {
  it('returns true for valid MyKid credentials', () => {
    expect(isMyKidCredentials({ phone: '+4712345678', password: 'secret' })).toBe(true)
  })

  it('returns false for missing fields', () => {
    expect(isMyKidCredentials({ phone: '+4712345678' })).toBe(false)
    expect(isMyKidCredentials({ password: 'secret' })).toBe(false)
  })

  it('returns false for wrong field names (email instead of phone)', () => {
    expect(isMyKidCredentials({ email: 'test@example.com', password: 'secret' })).toBe(false)
  })
})
