/**
 * AI Action Routing System
 *
 * Determines whether an AI-parsed action should:
 * 1. Use quick inline action cards (simple, high confidence)
 * 2. Navigate to full UI with prefilled data (complex, many fields to edit)
 *
 * Decision factors:
 * - Action type (some inherently need full UI)
 * - Number of fields extracted
 * - Confidence level
 * - User experience considerations
 */

import type { WishlistOccasion, ChildTaskType, MemberEventType } from '@/lib/types'

// Action types that benefit from quick inline execution
export type QuickActionType = 'pickup' | 'shopping_item' | 'meal' | 'simple_task' | 'complete' | 'delete'

// Action types that benefit from navigation to full UI
export type NavigateActionType = 'recipe' | 'wishlist_item' | 'member_event' | 'child_task_appointment'

// Storage keys for each prefill type
export const PREFILL_STORAGE_KEYS = {
  recipe: 'recipe-prefill',
  wishlist: 'wishlist-prefill',
  memberEvent: 'member-event-prefill',
  childTask: 'child-task-prefill',
} as const

// Routes for each action type that needs navigation
export const PREFILL_ROUTES = {
  recipe: '/oppskrifter',
  wishlist: '/handleliste',
  memberEvent: '/uke',
  childTask: '/uke',
} as const

// Prefill data interfaces for each type
export interface RecipePrefillData {
  name?: string
  ingredients?: Array<{ item: string; amount: string }>
  instructions?: string
  external_link?: string
  is_quick?: boolean
  is_kid_friendly?: boolean
}

export interface WishlistPrefillData {
  name?: string
  description?: string
  price?: number | null
  link?: string
  occasion?: WishlistOccasion
  image?: string | null
  childId?: string | null
  memberId?: string | null
}

export interface MemberEventPrefillData {
  member_id?: string
  title?: string
  event_type?: MemberEventType
  date?: string
  end_date?: string
}

export interface ChildTaskPrefillData {
  child_id?: string
  title?: string
  task_type?: ChildTaskType
  date?: string
  time?: string
  notes?: string
}

export type PrefillData =
  | { type: 'recipe'; data: RecipePrefillData }
  | { type: 'wishlist'; data: WishlistPrefillData }
  | { type: 'memberEvent'; data: MemberEventPrefillData }
  | { type: 'childTask'; data: ChildTaskPrefillData }

/**
 * Routing decision result
 */
export interface RoutingDecision {
  shouldNavigate: boolean
  route?: string
  queryParam?: string
  storageKey?: string
  prefillData?: PrefillData
  reason: string
}

/**
 * Parsed action data from AI (simplified interface)
 */
interface ActionData {
  // Common
  confidence?: number

  // Recipe fields
  name?: string
  item_name?: string
  product_name?: string
  ingredients?: Array<{ item: string; amount: string }> | string[]
  instructions?: string
  external_link?: string
  is_quick?: boolean
  is_kid_friendly?: boolean

  // Wishlist fields
  description?: string
  price?: number | null
  link?: string
  occasion?: WishlistOccasion
  image?: string | null
  child_id?: string | null
  member_id?: string | null

  // Event/Task fields
  title?: string
  date?: string
  end_date?: string
  time?: string
  notes?: string
  task_type?: ChildTaskType
  event_type?: MemberEventType

  // For shopping
  category?: string
  quantity?: string
}

/**
 * Count meaningful fields in action data
 */
function countMeaningfulFields(data: ActionData): number {
  let count = 0
  const meaningfulFields = [
    'name', 'item_name', 'product_name', 'title',
    'description', 'notes', 'instructions',
    'price', 'link', 'external_link',
    'occasion', 'task_type', 'event_type',
    'date', 'end_date', 'time',
    'ingredients', 'image',
    'is_quick', 'is_kid_friendly',
  ]

  for (const field of meaningfulFields) {
    const value = data[field as keyof ActionData]
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value) && value.length > 0) count++
      else if (!Array.isArray(value)) count++
    }
  }

  return count
}

/**
 * Determine routing for a recipe action
 */
function routeRecipe(data: ActionData): RoutingDecision {
  // Recipes always benefit from full UI - too many fields
  const prefillData: RecipePrefillData = {
    name: data.name || data.item_name || '',
    instructions: data.instructions || '',
    external_link: data.external_link || data.link || '',
    is_quick: data.is_quick ?? false,
    is_kid_friendly: data.is_kid_friendly ?? true,
  }

  // Parse ingredients if provided
  if (data.ingredients) {
    if (Array.isArray(data.ingredients)) {
      prefillData.ingredients = data.ingredients.map(ing => {
        if (typeof ing === 'string') {
          return { item: ing, amount: '' }
        }
        return ing
      })
    }
  }

  return {
    shouldNavigate: true,
    route: PREFILL_ROUTES.recipe,
    queryParam: 'addRecipe=true',
    storageKey: PREFILL_STORAGE_KEYS.recipe,
    prefillData: { type: 'recipe', data: prefillData },
    reason: 'Recipes have many fields (ingredients, instructions, settings) - full form provides better editing experience',
  }
}

/**
 * Determine routing for a wishlist item action
 */
function routeWishlistItem(data: ActionData): RoutingDecision {
  // Wishlist items always benefit from full UI - many optional fields
  const prefillData: WishlistPrefillData = {
    name: data.name || data.item_name || data.product_name || '',
    description: data.description || '',
    price: data.price ?? null,
    link: data.link || '',
    occasion: data.occasion || 'general',
    image: data.image || null,
    childId: data.child_id || null,
    memberId: data.member_id || null,
  }

  return {
    shouldNavigate: true,
    route: PREFILL_ROUTES.wishlist,
    queryParam: 'addWishlist=true',
    storageKey: PREFILL_STORAGE_KEYS.wishlist,
    prefillData: { type: 'wishlist', data: prefillData },
    reason: 'Wishlist items have many fields (occasion, priority, image) - full form provides better editing experience',
  }
}

/**
 * Determine routing for a member event action
 */
function routeMemberEvent(data: ActionData): RoutingDecision {
  const fieldCount = countMeaningfulFields(data)
  const hasDateRange = data.end_date && data.end_date !== data.date

  // Navigate if: has date range OR many fields OR low confidence
  const shouldNav = hasDateRange || fieldCount >= 3 || (data.confidence ?? 1) < 0.7

  if (!shouldNav) {
    return {
      shouldNavigate: false,
      reason: 'Simple event with few fields - quick card is sufficient',
    }
  }

  const prefillData: MemberEventPrefillData = {
    member_id: data.member_id || undefined,
    title: data.title || data.name || '',
    event_type: data.event_type || 'other',
    date: data.date || '',
    end_date: data.end_date || '',
  }

  return {
    shouldNavigate: true,
    route: PREFILL_ROUTES.memberEvent,
    queryParam: 'addEvent=true',
    storageKey: PREFILL_STORAGE_KEYS.memberEvent,
    prefillData: { type: 'memberEvent', data: prefillData },
    reason: hasDateRange
      ? 'Multi-day event - full form allows date range editing'
      : 'Event has multiple details - full form provides better editing experience',
  }
}

/**
 * Determine routing for a child task action
 */
function routeChildTask(data: ActionData): RoutingDecision {
  const isAppointment = data.task_type === 'appointment'
  const hasTimeOrNotes = !!(data.time || data.notes)
  const fieldCount = countMeaningfulFields(data)

  // Navigate if: appointment type OR has time/notes OR many fields
  const shouldNav = isAppointment || hasTimeOrNotes || fieldCount >= 4

  if (!shouldNav) {
    return {
      shouldNavigate: false,
      reason: 'Simple task/reminder - quick card is sufficient',
    }
  }

  const prefillData: ChildTaskPrefillData = {
    child_id: data.child_id || undefined,
    title: data.title || data.name || '',
    task_type: data.task_type || 'other',
    date: data.date || '',
    time: data.time || '',
    notes: data.notes || '',
  }

  return {
    shouldNavigate: true,
    route: PREFILL_ROUTES.childTask,
    queryParam: 'addTask=true',
    storageKey: PREFILL_STORAGE_KEYS.childTask,
    prefillData: { type: 'childTask', data: prefillData },
    reason: isAppointment
      ? 'Appointments typically have time/location/notes - full form provides better editing'
      : 'Task has multiple details - full form provides better editing experience',
  }
}

/**
 * Main routing function - determines how to handle an AI-parsed action
 *
 * @param actionType - The type of action (recipe, wishlist_item, etc.)
 * @param operation - The operation (add, modify, delete, complete)
 * @param data - The action data from AI
 * @returns Routing decision with navigation details
 */
export function determineActionRouting(
  actionType: string,
  operation: string,
  data: ActionData
): RoutingDecision {
  // Modify/delete/complete operations are quick by nature
  if (operation !== 'add') {
    return {
      shouldNavigate: false,
      reason: `${operation} operations are quick actions - inline execution is best`,
    }
  }

  // Route based on action type
  switch (actionType) {
    case 'recipe':
      return routeRecipe(data)

    case 'wishlist_item':
      return routeWishlistItem(data)

    case 'member_event':
      return routeMemberEvent(data)

    case 'child_task':
      return routeChildTask(data)

    // Quick action types - never navigate
    case 'pickup':
    case 'shopping_item':
    case 'meal':
      return {
        shouldNavigate: false,
        reason: `${actionType} actions are simple with few fields - quick card is optimal`,
      }

    default:
      return {
        shouldNavigate: false,
        reason: 'Unknown action type - defaulting to quick card',
      }
  }
}

/**
 * Store prefill data and return navigation URL
 */
export function prepareNavigation(
  decision: RoutingDecision,
  isDemo: boolean
): string | null {
  if (!decision.shouldNavigate || !decision.route || !decision.storageKey || !decision.prefillData) {
    return null
  }

  // Store prefill data
  try {
    localStorage.setItem(decision.storageKey, JSON.stringify(decision.prefillData.data))
  } catch (err) {
    console.error('Failed to store prefill data:', err)
  }

  // Build URL
  const baseUrl = decision.route
  const queryParams = new URLSearchParams()

  if (isDemo) {
    queryParams.set('demo', 'true')
  }
  if (decision.queryParam) {
    const [key, value] = decision.queryParam.split('=')
    queryParams.set(key, value)
  }

  const queryString = queryParams.toString()
  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}

/**
 * Read and clear prefill data from localStorage
 */
export function consumePrefillData<T>(storageKey: string): T | null {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return null

    localStorage.removeItem(storageKey)
    return JSON.parse(stored) as T
  } catch (err) {
    console.error('Failed to read prefill data:', err)
    return null
  }
}

/**
 * Check if a query param indicates prefill mode
 */
export function hasPrefillQueryParam(searchParams: URLSearchParams): {
  hasRecipe: boolean
  hasWishlist: boolean
  hasEvent: boolean
  hasTask: boolean
} {
  return {
    hasRecipe: searchParams.get('addRecipe') === 'true',
    hasWishlist: searchParams.get('addWishlist') === 'true',
    hasEvent: searchParams.get('addEvent') === 'true',
    hasTask: searchParams.get('addTask') === 'true',
  }
}
