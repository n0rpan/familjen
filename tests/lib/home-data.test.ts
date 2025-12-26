import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAttentionStatus, getTodaySummary, type HomePageData } from '@/lib/data/home'
import type { Holiday } from '@/lib/utils'

describe('home page data', () => {
  // Helper to create mock home page data
  function createMockData(overrides: Partial<HomePageData> = {}): HomePageData {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]

    return {
      children: [
        { id: 'child-1', household_id: 'hh-1', name: 'Emma', color: 'sky', location_name: 'Barnehage', location_type: null, sort_order: 0, birth_date: null, allergies: null, created_at: '', updated_at: '' },
        { id: 'child-2', household_id: 'hh-1', name: 'Noah', color: 'coral', location_name: 'Skole', location_type: null, sort_order: 1, birth_date: null, allergies: null, created_at: '', updated_at: '' },
      ],
      members: [
        { id: 'member-1', household_id: 'hh-1', name: 'Mamma', short_name: 'M', is_parent: true, is_household_admin: true, user_id: null, email: 'mamma@test.no', birth_date: null, work_email: null, allergies: null, language_preference: null, ics_calendar_url: null, ics_last_sync_at: null, ics_sync_error: null, created_at: '', updated_at: '' },
        { id: 'member-2', household_id: 'hh-1', name: 'Pappa', short_name: 'P', is_parent: true, is_household_admin: false, user_id: null, email: 'pappa@test.no', birth_date: null, work_email: null, allergies: null, language_preference: null, ics_calendar_url: null, ics_last_sync_at: null, ics_sync_error: null, created_at: '', updated_at: '' },
      ],
      pickups: [],
      meals: [],
      memberEvents: [],
      householdEvents: [],
      childTasks: [],
      externalEvents: [],
      holidays: [],
      recentPhotos: [],
      aiHeadsUps: [],
      weekStart: today,
      weekEnd: new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000),
      todayStr,
      weekStartStr: todayStr,
      weekEndStr: new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      ...overrides,
    }
  }

  describe('getAttentionStatus', () => {
    it('flags all children without pickups on working day', () => {
      // Wednesday (not weekend, no holiday)
      const wednesday = new Date('2024-12-18')  // Wednesday
      const data = createMockData({
        todayStr: '2024-12-18',
        pickups: [],
        holidays: [],
      })

      const status = getAttentionStatus(data)

      expect(status.childrenWithoutPickup.length).toBe(2)
      expect(status.childrenWithoutPickup[0].name).toBe('Emma')
      expect(status.childrenWithoutPickup[1].name).toBe('Noah')
      expect(status.attentionCount).toBe(3)  // 2 children + 1 no meal
    })

    it('does NOT flag missing pickups on weekend', () => {
      // Saturday
      const saturday = new Date('2024-12-21')
      const data = createMockData({
        todayStr: '2024-12-21',  // Saturday
        pickups: [],
        holidays: [],
      })

      const status = getAttentionStatus(data)

      // Should NOT flag missing pickups on weekend
      expect(status.childrenWithoutPickup.length).toBe(0)
      expect(status.attentionCount).toBe(1)  // Only no meal
    })

    it('does NOT flag missing pickups on holiday', () => {
      // Christmas Day (holiday)
      const data = createMockData({
        todayStr: '2024-12-25',  // Wednesday, but holiday
        pickups: [],
        holidays: [
          { date: '2024-12-25', name: '1. juledag', type: 'holiday' as const },
        ],
      })

      const status = getAttentionStatus(data)

      // Should NOT flag missing pickups on holiday
      expect(status.childrenWithoutPickup.length).toBe(0)
      expect(status.attentionCount).toBe(1)  // Only no meal
    })

    it('flags specific children without pickups', () => {
      const data = createMockData({
        todayStr: '2024-12-18',  // Wednesday
        pickups: [
          {
            id: 'pickup-1',
            household_id: 'hh-1',
            child_id: 'child-1',
            picker_id: 'member-1',
            date: '2024-12-18',
            synced_to_work_calendar: false,
            work_calendar_event_id: null,
            child: { id: 'child-1', name: 'Emma', color: 'sky', household_id: 'hh-1', location_name: null, location_type: null, sort_order: 0, birth_date: null, allergies: null, created_at: '', updated_at: '' },
            picker: { id: 'member-1', name: 'Mamma', household_id: 'hh-1', short_name: 'M', is_parent: true, is_household_admin: true, user_id: null, email: '', birth_date: null, work_email: null, allergies: null, language_preference: null, ics_calendar_url: null, ics_last_sync_at: null, ics_sync_error: null, created_at: '', updated_at: '' },
            created_at: '',
            updated_at: '',
          },
        ],
        holidays: [],
      })

      const status = getAttentionStatus(data)

      // Only Noah is missing pickup
      expect(status.childrenWithoutPickup.length).toBe(1)
      expect(status.childrenWithoutPickup[0].name).toBe('Noah')
    })

    it('flags no meal when no meal set', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        meals: [],
        pickups: [
          // Both children have pickups
          { id: 'p1', household_id: 'hh-1', child_id: 'child-1', picker_id: 'member-1', date: '2024-12-18', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
          { id: 'p2', household_id: 'hh-1', child_id: 'child-2', picker_id: 'member-2', date: '2024-12-18', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
        ],
      })

      const status = getAttentionStatus(data)

      expect(status.noMeal).toBe(true)
      expect(status.attentionCount).toBe(1)
    })

    it('does NOT flag meal when custom meal is set', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        meals: [
          { id: 'm1', household_id: 'hh-1', date: '2024-12-18', recipe_id: null, custom_meal: 'Pizza', recipe: null, created_at: '', updated_at: '' },
        ],
        pickups: [
          { id: 'p1', household_id: 'hh-1', child_id: 'child-1', picker_id: 'member-1', date: '2024-12-18', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
          { id: 'p2', household_id: 'hh-1', child_id: 'child-2', picker_id: 'member-2', date: '2024-12-18', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
        ],
      })

      const status = getAttentionStatus(data)

      expect(status.noMeal).toBe(false)
      expect(status.attentionCount).toBe(0)
      expect(status.isAllReady).toBe(true)
    })

    it('does NOT flag meal when recipe is linked', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        meals: [
          { id: 'm1', household_id: 'hh-1', date: '2024-12-18', recipe_id: 'recipe-1', custom_meal: null, recipe: { id: 'recipe-1', name: 'Tacos', household_id: 'hh-1', ingredients: null, instructions: null, source_url: null, created_at: '', updated_at: '' }, created_at: '', updated_at: '' },
        ],
        pickups: [
          { id: 'p1', household_id: 'hh-1', child_id: 'child-1', picker_id: 'member-1', date: '2024-12-18', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
          { id: 'p2', household_id: 'hh-1', child_id: 'child-2', picker_id: 'member-2', date: '2024-12-18', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
        ],
      })

      const status = getAttentionStatus(data)

      expect(status.noMeal).toBe(false)
      expect(status.isAllReady).toBe(true)
    })

    it('returns open tasks for today', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        childTasks: [
          { id: 't1', household_id: 'hh-1', child_id: 'child-1', date: '2024-12-18', time: '08:00', task_type: 'bring', title: 'Ta med matboks', notes: null, status: 'open', child: null as any, created_at: '', updated_at: '' },
          { id: 't2', household_id: 'hh-1', child_id: 'child-1', date: '2024-12-18', time: '09:00', task_type: 'appointment', title: 'Tannlege', notes: null, status: 'done', child: null as any, created_at: '', updated_at: '' },
          { id: 't3', household_id: 'hh-1', child_id: 'child-2', date: '2024-12-19', time: null, task_type: 'reminder', title: 'Tomorrow task', notes: null, status: 'open', child: null as any, created_at: '', updated_at: '' },
        ],
        pickups: [
          { id: 'p1', household_id: 'hh-1', child_id: 'child-1', picker_id: 'member-1', date: '2024-12-18', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
          { id: 'p2', household_id: 'hh-1', child_id: 'child-2', picker_id: 'member-2', date: '2024-12-18', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
        ],
        meals: [{ id: 'm1', household_id: 'hh-1', date: '2024-12-18', recipe_id: null, custom_meal: 'Pizza', recipe: null, created_at: '', updated_at: '' }],
      })

      const status = getAttentionStatus(data)

      // Only open tasks for today
      expect(status.openTasks.length).toBe(1)
      expect(status.openTasks[0].title).toBe('Ta med matboks')
    })
  })

  describe('getTodaySummary', () => {
    it('filters pickups for today only', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        pickups: [
          { id: 'p1', household_id: 'hh-1', child_id: 'child-1', picker_id: 'member-1', date: '2024-12-18', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
          { id: 'p2', household_id: 'hh-1', child_id: 'child-2', picker_id: 'member-2', date: '2024-12-19', synced_to_work_calendar: false, work_calendar_event_id: null, child: null as any, picker: null as any, created_at: '', updated_at: '' },
        ],
      })

      const summary = getTodaySummary(data)

      expect(summary.pickups.length).toBe(1)
      expect(summary.pickups[0].id).toBe('p1')
    })

    it('includes meal for today', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        meals: [
          { id: 'm1', household_id: 'hh-1', date: '2024-12-18', recipe_id: null, custom_meal: 'Tacos', recipe: null, created_at: '', updated_at: '' },
          { id: 'm2', household_id: 'hh-1', date: '2024-12-19', recipe_id: null, custom_meal: 'Pizza', recipe: null, created_at: '', updated_at: '' },
        ],
      })

      const summary = getTodaySummary(data)

      expect(summary.meal).not.toBeNull()
      expect(summary.meal?.custom_meal).toBe('Tacos')
    })

    it('handles multi-day member events', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        memberEvents: [
          // Event that spans 3 days, including today
          { id: 'e1', household_id: 'hh-1', member_id: 'member-1', date: '2024-12-17', end_date: '2024-12-19', title: 'Business trip', event_type: 'travel', source: null, source_email: null, google_event_id: null, ics_uid: null, created_at: '', updated_at: '' },
          // Event only tomorrow
          { id: 'e2', household_id: 'hh-1', member_id: 'member-2', date: '2024-12-19', end_date: null, title: 'Meeting', event_type: 'meeting', source: null, source_email: null, google_event_id: null, ics_uid: null, created_at: '', updated_at: '' },
        ],
      })

      const summary = getTodaySummary(data)

      expect(summary.memberEvents.length).toBe(1)
      expect(summary.memberEvents[0].title).toBe('Business trip')
    })

    it('handles household events spanning multiple days', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        householdEvents: [
          // Christmas vacation spanning today
          { id: 'he1', household_id: 'hh-1', event_date: '2024-12-15', end_date: '2024-12-25', event_time: null, title: 'Juleferie', description: null, event_type: null, created_at: '', updated_at: '' },
          // Future event
          { id: 'he2', household_id: 'hh-1', event_date: '2024-12-26', end_date: null, event_time: null, title: 'Romjul', description: null, event_type: null, created_at: '', updated_at: '' },
        ],
      })

      const summary = getTodaySummary(data)

      expect(summary.householdEvents.length).toBe(1)
      expect(summary.householdEvents[0].title).toBe('Juleferie')
    })

    it('includes external events for today', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        externalEvents: [
          { id: 'ex1', integration_id: 'int-1', external_id: 'spond-1', child_id: 'child-1', member_id: null, external_group_id: 'group-1', title: 'Football practice', description: null, event_date: '2024-12-18', end_date: null, event_time: '17:00', end_time: '18:30', location: 'Stadium', event_type: 'training', raw_data: null, is_hidden: false, created_at: '', updated_at: '', integration: { service: 'spond', display_name: 'Spond' } },
          { id: 'ex2', integration_id: 'int-1', external_id: 'spond-2', child_id: 'child-1', member_id: null, external_group_id: 'group-1', title: 'Match', description: null, event_date: '2024-12-20', end_date: null, event_time: '10:00', end_time: null, location: 'Away', event_type: 'match', raw_data: null, is_hidden: false, created_at: '', updated_at: '', integration: { service: 'spond', display_name: 'Spond' } },
        ],
      })

      const summary = getTodaySummary(data)

      expect(summary.externalEvents.length).toBe(1)
      expect(summary.externalEvents[0].title).toBe('Football practice')
    })
  })

  describe('parallel query resilience', () => {
    // These tests document expected behavior when queries fail

    it('should continue when holidays query fails', () => {
      // The actual getHomePageData logs warning but continues
      // We test that getAttentionStatus handles empty holidays gracefully
      const data = createMockData({
        todayStr: '2024-12-25',  // Christmas
        holidays: [],  // Failed to load
        pickups: [],
      })

      // Without holiday data, will incorrectly flag missing pickups
      // This is the documented trade-off - non-critical failures degrade gracefully
      const status = getAttentionStatus(data)

      // Wednesday without holiday data = treats as working day
      expect(status.childrenWithoutPickup.length).toBe(2)
    })

    it('handles empty children array gracefully', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        children: [],
        pickups: [],
      })

      const status = getAttentionStatus(data)

      expect(status.childrenWithoutPickup).toEqual([])
      expect(status.attentionCount).toBe(1)  // Only no meal
    })

    it('handles empty members array gracefully', () => {
      const data = createMockData({
        todayStr: '2024-12-18',
        members: [],
      })

      // Should not crash
      const summary = getTodaySummary(data)
      expect(summary.date).toBe('2024-12-18')
    })
  })
})
