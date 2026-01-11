import { describe, it, expect, vi } from 'vitest'

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  })),
}))

import {
  createHouseholdFilter,
  createListFilter,
  createInFilter,
} from '@/hooks/useRealtimeSubscription'

describe('createHouseholdFilter', () => {
  it('creates a valid household filter', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(createHouseholdFilter(uuid)).toBe(`household_id=eq.${uuid}`)
  })

  it('returns undefined for invalid UUID', () => {
    expect(createHouseholdFilter('test')).toBeUndefined()
    expect(createHouseholdFilter('')).toBeUndefined()
    expect(createHouseholdFilter('not-a-uuid')).toBeUndefined()
  })
})

describe('createListFilter', () => {
  it('creates a valid list filter', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(createListFilter(uuid)).toBe(`list_id=eq.${uuid}`)
  })

  it('returns undefined for invalid UUID', () => {
    expect(createListFilter('test')).toBeUndefined()
    expect(createListFilter('')).toBeUndefined()
    expect(createListFilter('not-a-uuid')).toBeUndefined()
  })
})

describe('createInFilter', () => {
  const validUuid1 = '550e8400-e29b-41d4-a716-446655440000'
  const validUuid2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
  const validUuid3 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

  it('creates eq filter for single value', () => {
    expect(createInFilter('list_id', [validUuid1])).toBe(`list_id=eq.${validUuid1}`)
  })

  it('creates in filter for multiple values', () => {
    expect(createInFilter('list_id', [validUuid1, validUuid2])).toBe(
      `list_id=in.(${validUuid1},${validUuid2})`
    )
  })

  it('handles three or more values', () => {
    const result = createInFilter('column', [validUuid1, validUuid2, validUuid3])
    expect(result).toBe(`column=in.(${validUuid1},${validUuid2},${validUuid3})`)
  })

  it('returns undefined for empty array', () => {
    expect(createInFilter('list_id', [])).toBeUndefined()
  })

  it('returns undefined for invalid column name', () => {
    // SQL injection attempt
    expect(createInFilter('list_id; DROP TABLE--', [validUuid1])).toBeUndefined()
    expect(createInFilter('column=1', [validUuid1])).toBeUndefined()
    expect(createInFilter('123column', [validUuid1])).toBeUndefined()
  })

  it('accepts valid column names', () => {
    expect(createInFilter('list_id', [validUuid1])).toBeDefined()
    expect(createInFilter('household_id', [validUuid1])).toBeDefined()
    expect(createInFilter('_private', [validUuid1])).toBeDefined()
    expect(createInFilter('column_name_123', [validUuid1])).toBeDefined()
  })

  it('filters out invalid UUIDs (injection prevention)', () => {
    const malicious = "'; DROP TABLE users;--"
    const result = createInFilter('list_id', [malicious])
    expect(result).toBeUndefined() // No valid UUIDs, so undefined
  })

  it('keeps only valid UUIDs from mixed array', () => {
    const mixed = [validUuid1, 'not-a-uuid', validUuid2, 'also-invalid']
    const result = createInFilter('list_id', mixed)
    expect(result).toBe(`list_id=in.(${validUuid1},${validUuid2})`)
  })

  it('handles all invalid UUIDs', () => {
    const allInvalid = ['not-uuid', 'also-not', '12345']
    expect(createInFilter('col', allInvalid)).toBeUndefined()
  })
})
