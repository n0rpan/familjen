/**
 * Demo Data Validation Tests
 *
 * These tests ensure demo data is complete and valid.
 * When adding new features, if demo data is missing, these tests will fail.
 *
 * Run with: npm run test -- tests/demo/demo-data.test.ts
 */

import { describe, it, expect } from 'vitest'
import { generateDemoState, DEMO_IDS } from '@/lib/demo/generator'
import { validateDemoData, assertDemoDataValid } from '@/lib/demo/validation'

describe('Demo Data Generator', () => {
  it('generates valid demo state', () => {
    const state = generateDemoState()
    const result = validateDemoData(state)

    // Log any errors for debugging
    if (!result.valid) {
      console.error('Demo data validation errors:')
      result.errors.forEach(e => console.error(`  - ${e.field}: ${e.message}`))
    }

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('generates household with correct structure', () => {
    const state = generateDemoState()

    expect(state.household).toBeDefined()
    expect(state.household.id).toBe(DEMO_IDS.household)
    expect(state.household.name).toBe('Familien Hansen')
    expect(state.household.ai_meal_context).toBeTruthy()
  })

  it('generates members with required fields', () => {
    const state = generateDemoState()

    expect(state.members).toHaveLength(2)

    state.members.forEach(member => {
      expect(member.id).toBeTruthy()
      expect(member.household_id).toBe(DEMO_IDS.household)
      expect(member.name).toBeTruthy()
      expect(member.email).toBeTruthy()
    })

    // At least one household admin
    expect(state.members.some(m => m.is_household_admin)).toBe(true)
  })

  it('generates children with required fields', () => {
    const state = generateDemoState()

    expect(state.children.length).toBeGreaterThanOrEqual(2)

    state.children.forEach(child => {
      expect(child.id).toBeTruthy()
      expect(child.household_id).toBe(DEMO_IDS.household)
      expect(child.name).toBeTruthy()
      expect(child.color).toBeTruthy()
      expect(child.location_name).toBeTruthy()
    })

    // Check color variety
    const colors = new Set(state.children.map(c => c.color))
    expect(colors.size).toBeGreaterThanOrEqual(2)
  })

  it('generates pickups for current week', () => {
    const state = generateDemoState()

    expect(state.pickups.length).toBeGreaterThanOrEqual(5)

    const childIds = new Set(state.children.map(c => c.id))
    const memberIds = new Set(state.members.map(m => m.id))

    state.pickups.forEach(pickup => {
      expect(pickup.household_id).toBe(DEMO_IDS.household)
      expect(childIds.has(pickup.child_id)).toBe(true)
      expect(pickup.picker_id === null || memberIds.has(pickup.picker_id)).toBe(true)
      expect(pickup.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  it('generates meals for current week', () => {
    const state = generateDemoState()

    expect(state.meals.length).toBeGreaterThanOrEqual(3)

    state.meals.forEach(meal => {
      expect(meal.household_id).toBe(DEMO_IDS.household)
      expect(meal.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(meal.custom_meal || meal.recipe_id).toBeTruthy()
    })
  })

  it('generates recipes with ingredients', () => {
    const state = generateDemoState()

    expect(state.recipes.length).toBeGreaterThanOrEqual(3)

    state.recipes.forEach(recipe => {
      expect(recipe.household_id).toBe(DEMO_IDS.household)
      expect(recipe.name).toBeTruthy()
      expect(Array.isArray(recipe.ingredients)).toBe(true)
      expect(recipe.ingredients.length).toBeGreaterThan(0)
    })

    // At least one favorite recipe
    expect(state.recipes.some(r => r.is_favorite)).toBe(true)
  })

  it('generates child tasks', () => {
    const state = generateDemoState()

    expect(state.childTasks.length).toBeGreaterThanOrEqual(3)

    const childIds = new Set(state.children.map(c => c.id))

    state.childTasks.forEach(task => {
      expect(task.household_id).toBe(DEMO_IDS.household)
      expect(childIds.has(task.child_id)).toBe(true)
      expect(task.title).toBeTruthy()
      expect(['bring', 'appointment', 'reminder', 'other']).toContain(task.task_type)
    })
  })

  it('generates member events', () => {
    const state = generateDemoState()

    expect(state.memberEvents.length).toBeGreaterThanOrEqual(1)

    const memberIds = new Set(state.members.map(m => m.id))

    state.memberEvents.forEach(event => {
      expect(event.household_id).toBe(DEMO_IDS.household)
      expect(memberIds.has(event.member_id)).toBe(true)
      expect(event.title).toBeTruthy()
    })
  })

  it('generates household events', () => {
    const state = generateDemoState()

    expect(state.householdEvents.length).toBeGreaterThanOrEqual(1)

    state.householdEvents.forEach(event => {
      expect(event.household_id).toBe(DEMO_IDS.household)
      expect(event.title).toBeTruthy()
    })
  })

  it('generates external events (Spond, etc.)', () => {
    const state = generateDemoState()

    expect(state.externalEvents.length).toBeGreaterThanOrEqual(1)

    state.externalEvents.forEach(event => {
      expect(event.title).toBeTruthy()
      expect(event.integration).toBeDefined()
      expect(event.integration?.service).toBeTruthy()
    })
  })

  it('generates feed messages', () => {
    const state = generateDemoState()

    expect(state.feedMessages.length).toBeGreaterThanOrEqual(2)

    state.feedMessages.forEach(message => {
      expect(message.title).toBeTruthy()
      expect(message.body).toBeTruthy()
      expect(['spond', 'mykid', 'iskole', 'kidplan']).toContain(message.service)
    })
  })

  it('generates shopping lists with items', () => {
    const state = generateDemoState()

    expect(state.shoppingLists.length).toBeGreaterThanOrEqual(1)

    const totalItems = state.shoppingLists.reduce((sum, list) => sum + list.items.length, 0)
    expect(totalItems).toBeGreaterThanOrEqual(3)

    state.shoppingLists.forEach(list => {
      expect(list.household_id).toBe(DEMO_IDS.household)
      expect(list.name).toBeTruthy()
    })
  })

  it('generates wishlists for children and parents', () => {
    const state = generateDemoState()

    expect(state.wishlists.length).toBeGreaterThanOrEqual(3)

    // Check for child wishlists
    const childWishlists = state.wishlists.filter(w => w.child_id)
    expect(childWishlists.length).toBeGreaterThanOrEqual(2)

    // Check for parent wishlists
    const parentWishlists = state.wishlists.filter(w => w.member_id)
    expect(parentWishlists.length).toBeGreaterThanOrEqual(1)

    state.wishlists.forEach(item => {
      expect(item.household_id).toBe(DEMO_IDS.household)
      expect(item.name).toBeTruthy()
      expect(['birthday', 'christmas', 'general']).toContain(item.occasion)
    })
  })

  it('generates admin page data', () => {
    const state = generateDemoState()

    // Admin households
    expect(state.adminHouseholds.length).toBeGreaterThanOrEqual(2)
    state.adminHouseholds.forEach(h => {
      expect(h.name).toBeTruthy()
      expect(h.members.length).toBeGreaterThan(0)
    })

    // Allowed emails
    expect(state.adminAllowedEmails.length).toBeGreaterThanOrEqual(3)
    expect(state.adminAllowedEmails.some(e => e.is_admin)).toBe(true)
  })

  it('includes metadata', () => {
    const state = generateDemoState()

    expect(state.generatedAt).toBeTruthy()
    expect(new Date(state.generatedAt).getTime()).not.toBeNaN()
    expect(state.version).toBeGreaterThanOrEqual(1)
  })

  it('demonstrates allergen feature', () => {
    const state = generateDemoState()

    // Check that at least one child has allergies to demo the feature
    const hasChildAllergies = state.children.some(c => c.allergies && c.allergies.length > 0)
    expect(hasChildAllergies).toBe(true)

    // AI meal context should mention allergies
    expect(state.household.ai_meal_context).toMatch(/allergi|skalldyr/i)
  })
})

describe('Demo Data Validation', () => {
  it('passes for valid data', () => {
    const state = generateDemoState()
    const result = validateDemoData(state)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails for missing children', () => {
    const state = generateDemoState()
    state.children = []

    const result = validateDemoData(state)

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.field === 'children')).toBe(true)
  })

  it('fails for invalid pickup references', () => {
    const state = generateDemoState()
    state.pickups[0].child_id = 'invalid-id'

    const result = validateDemoData(state)

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.field.includes('child_id'))).toBe(true)
  })

  it('warns about missing photos', () => {
    const state = generateDemoState()
    state.feedPhotos = []

    const result = validateDemoData(state)

    // Should still be valid (photos are optional)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.field === 'feedPhotos')).toBe(true)
  })

  it('assertDemoDataValid throws for null state', () => {
    expect(() => assertDemoDataValid(null)).toThrow('Demo state is null')
  })

  it('assertDemoDataValid throws for invalid state', () => {
    const state = generateDemoState()
    state.children = []

    expect(() => assertDemoDataValid(state)).toThrow('Demo data validation failed')
  })
})
