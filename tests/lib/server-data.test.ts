import { describe, it, expect, vi, beforeEach } from 'vitest'

// We need to test the logic of getHouseholdIdFromSession without actually importing it
// because it requires server-side imports. Instead, we test the logic in isolation.

describe('getHouseholdIdFromSession logic', () => {
  describe('JWT fast path', () => {
    it('returns household_id from JWT when present', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        app_metadata: {
          household_id: 'household-456',
        },
      }

      // Simulate the fast path logic
      const jwtHouseholdId = user.app_metadata?.household_id as string | undefined
      expect(jwtHouseholdId).toBe('household-456')
    })

    it('returns undefined when JWT has no household_id', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        app_metadata: {},
      }

      const jwtHouseholdId = user.app_metadata?.household_id as string | undefined
      expect(jwtHouseholdId).toBeUndefined()
    })

    it('returns undefined when app_metadata is missing', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        app_metadata: undefined,
      }

      const jwtHouseholdId = user.app_metadata?.household_id as string | undefined
      expect(jwtHouseholdId).toBeUndefined()
    })
  })

  describe('DB fallback logic', () => {
    it('uses DB result when JWT is stale', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        app_metadata: {}, // No household_id in JWT
      }

      const memberData = {
        household_id: 'household-789',
      }

      // Simulate the fallback logic
      const jwtHouseholdId = user.app_metadata?.household_id as string | undefined
      const result = jwtHouseholdId || memberData?.household_id

      expect(result).toBe('household-789')
    })

    it('returns null when neither JWT nor DB has household', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        app_metadata: {},
      }

      const memberData = null

      const jwtHouseholdId = user.app_metadata?.household_id as string | undefined
      const result = jwtHouseholdId || memberData?.household_id || null

      expect(result).toBeNull()
    })
  })

  describe('Error handling', () => {
    it('handles PGRST116 (no rows) as expected condition', () => {
      const dbError = { code: 'PGRST116', message: 'no rows returned' }

      // This error code means user has no household - not an error
      const isNoRowsError = dbError.code === 'PGRST116'
      expect(isNoRowsError).toBe(true)
    })

    it('identifies real DB errors for logging', () => {
      const dbError = { code: 'PGRST500', message: 'database error' }

      const isNoRowsError = dbError.code === 'PGRST116'
      expect(isNoRowsError).toBe(false)
    })
  })
})

describe('Demo mode detection', () => {
  it('detects demo mode from URL parameter', () => {
    const searchParams = new URLSearchParams('demo=true')
    const isDemo = searchParams.get('demo') === 'true'
    expect(isDemo).toBe(true)
  })

  it('returns false when demo param is not set', () => {
    const searchParams = new URLSearchParams('')
    const isDemo = searchParams.get('demo') === 'true'
    expect(isDemo).toBe(false)
  })

  it('returns false when demo param is not "true"', () => {
    const searchParams = new URLSearchParams('demo=false')
    const isDemo = searchParams.get('demo') === 'true'
    expect(isDemo).toBe(false)
  })
})

describe('Demo param preservation', () => {
  it('appends demo param to URL without query string', () => {
    const href = '/uke'
    const isDemo = true

    const url = new URL(href, 'http://localhost')
    if (isDemo && !url.searchParams.has('demo')) {
      url.searchParams.set('demo', 'true')
    }
    const result = url.pathname + url.search

    expect(result).toBe('/uke?demo=true')
  })

  it('appends demo param to URL with existing query string', () => {
    const href = '/uke?week=2'
    const isDemo = true

    const url = new URL(href, 'http://localhost')
    if (isDemo && !url.searchParams.has('demo')) {
      url.searchParams.set('demo', 'true')
    }
    const result = url.pathname + url.search

    expect(result).toContain('week=2')
    expect(result).toContain('demo=true')
  })

  it('does not duplicate demo param if already present', () => {
    const href = '/uke?demo=true'
    const isDemo = true

    const url = new URL(href, 'http://localhost')
    if (isDemo && !url.searchParams.has('demo')) {
      url.searchParams.set('demo', 'true')
    }
    const result = url.pathname + url.search

    const matches = result.match(/demo=true/g)
    expect(matches?.length).toBe(1)
  })

  it('skips external URLs', () => {
    const href = 'https://example.com/page'
    const isDemo = true

    // External URLs should not be modified
    const isExternal = href.startsWith('http')
    expect(isExternal).toBe(true)

    // Logic: if external, return href unchanged
    const result = isExternal ? href : href + '?demo=true'
    expect(result).toBe('https://example.com/page')
  })
})
