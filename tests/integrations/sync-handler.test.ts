import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getMappingsForIntegrations,
  getSyncStartDate,
  HISTORICAL_SYNC_DAYS,
  type IntegrationMapping,
} from '@/lib/integrations/shared/sync-handler'

describe('sync-handler', () => {
  describe('getSyncStartDate', () => {
    it('returns historical date for first sync (null lastSyncAt)', () => {
      const startDate = getSyncStartDate(null, false)
      const now = new Date()

      // Should be ~365 days ago
      const diffDays = Math.round((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      expect(diffDays).toBe(HISTORICAL_SYNC_DAYS)
    })

    it('returns historical date when fullSync is true', () => {
      const lastSync = new Date('2024-12-01').toISOString()
      const startDate = getSyncStartDate(lastSync, true)
      const now = new Date()

      // Should ignore lastSync and go back HISTORICAL_SYNC_DAYS
      const diffDays = Math.round((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      expect(diffDays).toBe(HISTORICAL_SYNC_DAYS)
    })

    it('returns lastSyncAt for incremental sync', () => {
      const lastSync = new Date('2024-12-20T10:00:00Z')
      const startDate = getSyncStartDate(lastSync.toISOString(), false)

      expect(startDate.toISOString()).toBe(lastSync.toISOString())
    })
  })

  describe('getMappingsForIntegrations', () => {
    // Mock Supabase client
    const createMockSupabase = (mappingsData: Array<{
      integration_id: string
      child_id: string | null
      member_id: string | null
      external_group_id: string | null
    }>) => {
      return {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: mappingsData }),
          })),
        })),
      } as any
    }

    it('returns empty map for no integrations', async () => {
      const supabase = createMockSupabase([])
      const result = await getMappingsForIntegrations(supabase, [])

      expect(result.size).toBe(0)
    })

    it('groups mappings by integration ID', async () => {
      const mappingsData = [
        { integration_id: 'int-1', child_id: 'child-a', member_id: null, external_group_id: 'group-x' },
        { integration_id: 'int-1', child_id: 'child-b', member_id: null, external_group_id: 'group-y' },
        { integration_id: 'int-2', child_id: 'child-c', member_id: null, external_group_id: 'group-z' },
      ]

      const supabase = createMockSupabase(mappingsData)
      const result = await getMappingsForIntegrations(supabase, ['int-1', 'int-2'])

      expect(result.size).toBe(2)
      expect(result.get('int-1')?.length).toBe(2)
      expect(result.get('int-2')?.length).toBe(1)
    })

    it('returns correct mapping structure', async () => {
      const mappingsData = [
        { integration_id: 'int-1', child_id: 'child-a', member_id: null, external_group_id: 'spond-group-123' },
      ]

      const supabase = createMockSupabase(mappingsData)
      const result = await getMappingsForIntegrations(supabase, ['int-1'])

      const mappings = result.get('int-1')
      expect(mappings).toBeDefined()
      expect(mappings![0]).toEqual({
        childId: 'child-a',
        memberId: null,
        groupId: 'spond-group-123',
      })
    })

    it('handles member mappings (not just children)', async () => {
      const mappingsData = [
        { integration_id: 'int-1', child_id: null, member_id: 'member-dad', external_group_id: 'group-football' },
      ]

      const supabase = createMockSupabase(mappingsData)
      const result = await getMappingsForIntegrations(supabase, ['int-1'])

      const mappings = result.get('int-1')
      expect(mappings![0]).toEqual({
        childId: null,
        memberId: 'member-dad',
        groupId: 'group-football',
      })
    })

    it('handles null external_group_id', async () => {
      const mappingsData = [
        { integration_id: 'int-1', child_id: 'child-a', member_id: null, external_group_id: null },
      ]

      const supabase = createMockSupabase(mappingsData)
      const result = await getMappingsForIntegrations(supabase, ['int-1'])

      const mappings = result.get('int-1')
      expect(mappings![0].groupId).toBeNull()
    })
  })

  describe('child mapping edge cases', () => {
    it('should identify when a groupId has no mapping', () => {
      // This simulates the matching logic in sync routes
      const mappings: Array<{ childId: string | null; memberId: string | null; groupId: string }> = [
        { childId: 'child-1', memberId: null, groupId: 'mapped-group' },
      ]

      const mappedGroupIds = new Set(mappings.map(m => m.groupId))

      // Event from unmapped group
      const eventGroupId = 'unmapped-group'
      const matched = mappings.find(m => m.groupId === eventGroupId)

      // This is the critical check - should we skip or include?
      expect(matched).toBeUndefined()
      expect(mappedGroupIds.size).toBe(1) // We have mappings
      expect(mappedGroupIds.has(eventGroupId)).toBe(false) // But not for this group

      // Current behavior: skip if we have mappings but none match
      // This could cause events to be silently dropped!
      const shouldSkip = !matched && mappedGroupIds.size > 0
      expect(shouldSkip).toBe(true)
    })

    it('should include events when no mappings exist (unmapped mode)', () => {
      const mappings: Array<{ childId: string | null; memberId: string | null; groupId: string }> = []
      const mappedGroupIds = new Set(mappings.map(m => m.groupId))

      const eventGroupId = 'any-group'
      const matched = mappings.find(m => m.groupId === eventGroupId)

      // No mappings = include all events (child_id will be null)
      const shouldSkip = !matched && mappedGroupIds.size > 0
      expect(shouldSkip).toBe(false)
    })

    it('should find correct child for subgroup match', () => {
      // Spond has parent groups and subgroups
      const mappings: Array<{ childId: string | null; memberId: string | null; groupId: string }> = [
        { childId: 'emma', memberId: null, groupId: 'team-a-subgroup-u10' },
        { childId: 'noah', memberId: null, groupId: 'team-b-subgroup-u8' },
      ]

      // Event is sent to parent group AND subgroups
      const parentGroupId = 'main-club-group'
      const subGroupIds = ['team-a-subgroup-u10', 'team-b-subgroup-u12']

      // First check parent (no match)
      let matched = mappings.find(m => m.groupId === parentGroupId)
      expect(matched).toBeUndefined()

      // Then check subgroups (should match Emma's group)
      if (!matched) {
        for (const subGroupId of subGroupIds) {
          matched = mappings.find(m => m.groupId === subGroupId)
          if (matched) break
        }
      }

      expect(matched).toBeDefined()
      expect(matched!.childId).toBe('emma')
    })

    it('should handle duplicate child mappings to same group', () => {
      // Edge case: two children mapped to same external group
      // This shouldn't happen in practice, but we should handle it
      const mappings: Array<{ childId: string | null; memberId: string | null; groupId: string }> = [
        { childId: 'emma', memberId: null, groupId: 'same-group' },
        { childId: 'noah', memberId: null, groupId: 'same-group' },
      ]

      // find() returns first match - event would go to Emma only
      const matched = mappings.find(m => m.groupId === 'same-group')
      expect(matched!.childId).toBe('emma')

      // Noah's events would be "lost" - this is a data integrity issue
      const allMatches = mappings.filter(m => m.groupId === 'same-group')
      expect(allMatches.length).toBe(2)

      // We should probably warn about this case in real code
    })
  })
})
