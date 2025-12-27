/**
 * Demo Data Validation
 *
 * Validates that demo data is complete and consistent.
 * This catches missing data early and forces developers to add demo data
 * for new features.
 *
 * Run via: npm run test:demo-data
 */

import type { DemoState } from './types'

export interface ValidationError {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
  summary: string
}

/**
 * Required minimum counts for demo data.
 * Update these when adding new features that need demo data.
 */
const REQUIRED_MINIMUMS = {
  // Core data
  members: 2,           // At least 2 parents
  children: 2,          // At least 2 children to show variety

  // Week data
  pickups: 5,           // Workweek pickups
  meals: 3,             // At least 3 meals planned
  recipes: 3,           // At least 3 recipes
  childTasks: 3,        // At least 3 tasks to show variety
  memberEvents: 1,      // At least 1 parent event
  householdEvents: 1,   // At least 1 family event
  externalEvents: 1,    // At least 1 external event (Spond, etc.)

  // Feed data
  feedMessages: 2,      // At least 2 messages from integrations
  // feedPhotos: 0,     // Optional - requires actual images

  // Shopping & Wishlists
  shoppingLists: 1,     // At least 1 shopping list
  shoppingItems: 3,     // At least 3 items in lists
  wishlists: 3,         // At least 3 wishlist items
  childWishlists: 2,    // At least 2 child wishlist items
  memberWishlists: 1,   // At least 1 parent wishlist item

  // Admin data
  adminHouseholds: 2,   // At least 2 households for admin view
  adminAllowedEmails: 3, // At least 3 allowed emails
} as const

/**
 * Validate demo data completeness and consistency
 */
export function validateDemoData(state: DemoState): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationError[] = []

  // ============================================================================
  // Required data checks
  // ============================================================================

  // Core data
  if (!state.household) {
    errors.push({ field: 'household', message: 'Missing household data', severity: 'error' })
  }

  if (!state.members || state.members.length < REQUIRED_MINIMUMS.members) {
    errors.push({
      field: 'members',
      message: `Need at least ${REQUIRED_MINIMUMS.members} members, got ${state.members?.length ?? 0}`,
      severity: 'error',
    })
  }

  if (!state.children || state.children.length < REQUIRED_MINIMUMS.children) {
    errors.push({
      field: 'children',
      message: `Need at least ${REQUIRED_MINIMUMS.children} children, got ${state.children?.length ?? 0}`,
      severity: 'error',
    })
  }

  // Week data
  if (!state.pickups || state.pickups.length < REQUIRED_MINIMUMS.pickups) {
    errors.push({
      field: 'pickups',
      message: `Need at least ${REQUIRED_MINIMUMS.pickups} pickups, got ${state.pickups?.length ?? 0}`,
      severity: 'error',
    })
  }

  if (!state.meals || state.meals.length < REQUIRED_MINIMUMS.meals) {
    errors.push({
      field: 'meals',
      message: `Need at least ${REQUIRED_MINIMUMS.meals} meals, got ${state.meals?.length ?? 0}`,
      severity: 'error',
    })
  }

  if (!state.recipes || state.recipes.length < REQUIRED_MINIMUMS.recipes) {
    errors.push({
      field: 'recipes',
      message: `Need at least ${REQUIRED_MINIMUMS.recipes} recipes, got ${state.recipes?.length ?? 0}`,
      severity: 'error',
    })
  }

  if (!state.childTasks || state.childTasks.length < REQUIRED_MINIMUMS.childTasks) {
    errors.push({
      field: 'childTasks',
      message: `Need at least ${REQUIRED_MINIMUMS.childTasks} child tasks, got ${state.childTasks?.length ?? 0}`,
      severity: 'error',
    })
  }

  if (!state.memberEvents || state.memberEvents.length < REQUIRED_MINIMUMS.memberEvents) {
    errors.push({
      field: 'memberEvents',
      message: `Need at least ${REQUIRED_MINIMUMS.memberEvents} member event, got ${state.memberEvents?.length ?? 0}`,
      severity: 'error',
    })
  }

  if (!state.householdEvents || state.householdEvents.length < REQUIRED_MINIMUMS.householdEvents) {
    errors.push({
      field: 'householdEvents',
      message: `Need at least ${REQUIRED_MINIMUMS.householdEvents} household event, got ${state.householdEvents?.length ?? 0}`,
      severity: 'error',
    })
  }

  if (!state.externalEvents || state.externalEvents.length < REQUIRED_MINIMUMS.externalEvents) {
    errors.push({
      field: 'externalEvents',
      message: `Need at least ${REQUIRED_MINIMUMS.externalEvents} external event (Spond, MyKid), got ${state.externalEvents?.length ?? 0}`,
      severity: 'error',
    })
  }

  // Feed data
  if (!state.feedMessages || state.feedMessages.length < REQUIRED_MINIMUMS.feedMessages) {
    errors.push({
      field: 'feedMessages',
      message: `Need at least ${REQUIRED_MINIMUMS.feedMessages} feed messages, got ${state.feedMessages?.length ?? 0}`,
      severity: 'error',
    })
  }

  // Shopping & Wishlists
  if (!state.shoppingLists || state.shoppingLists.length < REQUIRED_MINIMUMS.shoppingLists) {
    errors.push({
      field: 'shoppingLists',
      message: `Need at least ${REQUIRED_MINIMUMS.shoppingLists} shopping list, got ${state.shoppingLists?.length ?? 0}`,
      severity: 'error',
    })
  }

  const totalItems = state.shoppingLists?.reduce((sum, list) => sum + (list.items?.length ?? 0), 0) ?? 0
  if (totalItems < REQUIRED_MINIMUMS.shoppingItems) {
    errors.push({
      field: 'shoppingItems',
      message: `Need at least ${REQUIRED_MINIMUMS.shoppingItems} shopping items, got ${totalItems}`,
      severity: 'error',
    })
  }

  if (!state.wishlists || state.wishlists.length < REQUIRED_MINIMUMS.wishlists) {
    errors.push({
      field: 'wishlists',
      message: `Need at least ${REQUIRED_MINIMUMS.wishlists} wishlist items, got ${state.wishlists?.length ?? 0}`,
      severity: 'error',
    })
  }

  const childWishlists = state.wishlists?.filter(w => w.child_id)?.length ?? 0
  if (childWishlists < REQUIRED_MINIMUMS.childWishlists) {
    errors.push({
      field: 'childWishlists',
      message: `Need at least ${REQUIRED_MINIMUMS.childWishlists} child wishlist items, got ${childWishlists}`,
      severity: 'error',
    })
  }

  const memberWishlists = state.wishlists?.filter(w => w.member_id)?.length ?? 0
  if (memberWishlists < REQUIRED_MINIMUMS.memberWishlists) {
    errors.push({
      field: 'memberWishlists',
      message: `Need at least ${REQUIRED_MINIMUMS.memberWishlists} parent wishlist item, got ${memberWishlists}`,
      severity: 'error',
    })
  }

  // Admin data
  if (!state.adminHouseholds || state.adminHouseholds.length < REQUIRED_MINIMUMS.adminHouseholds) {
    errors.push({
      field: 'adminHouseholds',
      message: `Need at least ${REQUIRED_MINIMUMS.adminHouseholds} admin households, got ${state.adminHouseholds?.length ?? 0}`,
      severity: 'error',
    })
  }

  if (!state.adminAllowedEmails || state.adminAllowedEmails.length < REQUIRED_MINIMUMS.adminAllowedEmails) {
    errors.push({
      field: 'adminAllowedEmails',
      message: `Need at least ${REQUIRED_MINIMUMS.adminAllowedEmails} allowed emails, got ${state.adminAllowedEmails?.length ?? 0}`,
      severity: 'error',
    })
  }

  // ============================================================================
  // Data consistency checks
  // ============================================================================

  // Validate pickups reference valid children and members
  const childIds = new Set(state.children?.map(c => c.id) ?? [])
  const memberIds = new Set(state.members?.map(m => m.id) ?? [])

  state.pickups?.forEach((pickup, i) => {
    if (!childIds.has(pickup.child_id)) {
      errors.push({
        field: `pickups[${i}].child_id`,
        message: `Pickup references unknown child: ${pickup.child_id}`,
        severity: 'error',
      })
    }
    if (pickup.picker_id && !memberIds.has(pickup.picker_id)) {
      errors.push({
        field: `pickups[${i}].picker_id`,
        message: `Pickup references unknown member: ${pickup.picker_id}`,
        severity: 'error',
      })
    }
  })

  // Validate tasks reference valid children
  state.childTasks?.forEach((task, i) => {
    if (!childIds.has(task.child_id)) {
      errors.push({
        field: `childTasks[${i}].child_id`,
        message: `Task references unknown child: ${task.child_id}`,
        severity: 'error',
      })
    }
  })

  // Validate member events reference valid members
  state.memberEvents?.forEach((event, i) => {
    if (!memberIds.has(event.member_id)) {
      errors.push({
        field: `memberEvents[${i}].member_id`,
        message: `Event references unknown member: ${event.member_id}`,
        severity: 'error',
      })
    }
  })

  // Validate wishlists reference valid children or members
  state.wishlists?.forEach((item, i) => {
    if (item.child_id && !childIds.has(item.child_id)) {
      errors.push({
        field: `wishlists[${i}].child_id`,
        message: `Wishlist item references unknown child: ${item.child_id}`,
        severity: 'error',
      })
    }
    if (item.member_id && !memberIds.has(item.member_id)) {
      errors.push({
        field: `wishlists[${i}].member_id`,
        message: `Wishlist item references unknown member: ${item.member_id}`,
        severity: 'error',
      })
    }
  })

  // ============================================================================
  // Warnings (non-critical but nice to have)
  // ============================================================================

  // Check for demo photos (optional but enhances visual experience)
  if (!state.feedPhotos || state.feedPhotos.length === 0) {
    warnings.push({
      field: 'feedPhotos',
      message: 'No demo photos - feed will be text-only',
      severity: 'warning',
    })
  }

  // Check for holidays (optional)
  if (!state.holidays || state.holidays.length === 0) {
    warnings.push({
      field: 'holidays',
      message: 'No demo holidays - week view will show no holidays',
      severity: 'warning',
    })
  }

  // Check for variety in child colors
  const colors = new Set(state.children?.map(c => c.color) ?? [])
  if (colors.size < (state.children?.length ?? 0)) {
    warnings.push({
      field: 'children.color',
      message: 'Some children share the same color - use different colors for visual variety',
      severity: 'warning',
    })
  }

  // Check for allergens to demo that feature
  const hasAllergies = [
    ...(state.children?.flatMap(c => c.allergies ?? []) ?? []),
    ...(state.members?.flatMap(m => m.allergies ?? []) ?? []),
  ].length > 0
  if (!hasAllergies) {
    warnings.push({
      field: 'allergies',
      message: 'No demo allergies - allergen feature won\'t be shown',
      severity: 'warning',
    })
  }

  // Check metadata
  if (!state.version) {
    warnings.push({
      field: 'version',
      message: 'Missing demo state version',
      severity: 'warning',
    })
  }

  // ============================================================================
  // Build result
  // ============================================================================

  const valid = errors.length === 0

  let summary: string
  if (valid && warnings.length === 0) {
    summary = '✅ Demo data is complete and valid'
  } else if (valid) {
    summary = `⚠️ Demo data valid but has ${warnings.length} warning(s)`
  } else {
    summary = `❌ Demo data invalid: ${errors.length} error(s), ${warnings.length} warning(s)`
  }

  return { valid, errors, warnings, summary }
}

/**
 * Validate demo data and throw if invalid.
 * Use this in demo page components to fail early.
 */
export function assertDemoDataValid(state: DemoState | null): asserts state is DemoState {
  if (!state) {
    throw new DemoDataError('Demo state is null - data not generated')
  }

  const result = validateDemoData(state)

  if (!result.valid) {
    const errorMessages = result.errors.map(e => `  - ${e.field}: ${e.message}`).join('\n')
    throw new DemoDataError(
      `Demo data validation failed:\n${errorMessages}\n\n` +
      `Fix by updating src/lib/demo/generator.ts`
    )
  }
}

/**
 * Custom error for demo data issues
 */
export class DemoDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoDataError'
  }
}

/**
 * Get validation summary for display in UI
 */
export function getValidationSummary(state: DemoState | null): {
  status: 'valid' | 'warning' | 'error'
  message: string
  details?: string[]
} {
  if (!state) {
    return {
      status: 'error',
      message: 'Demo data not generated',
      details: ['Initialize demo mode to generate data'],
    }
  }

  const result = validateDemoData(state)

  if (!result.valid) {
    return {
      status: 'error',
      message: `Missing demo data (${result.errors.length} issues)`,
      details: result.errors.map(e => e.message),
    }
  }

  if (result.warnings.length > 0) {
    return {
      status: 'warning',
      message: `Demo data valid (${result.warnings.length} warnings)`,
      details: result.warnings.map(w => w.message),
    }
  }

  return {
    status: 'valid',
    message: 'Demo data complete',
  }
}
