/**
 * Shared constants and enum values
 * Single source of truth - used by both types.ts and schemas.ts
 */

// Child colors
export const CHILD_COLORS = ['sky', 'coral', 'sage', 'honey', 'lavender', 'mint'] as const
export type ChildColor = (typeof CHILD_COLORS)[number]

// Child task types
export const CHILD_TASK_TYPES = ['bring', 'appointment', 'reminder', 'activity', 'closure', 'other'] as const
export type ChildTaskType = (typeof CHILD_TASK_TYPES)[number]

// Task status
export const CHILD_TASK_STATUSES = ['open', 'done'] as const
export type ChildTaskStatus = (typeof CHILD_TASK_STATUSES)[number]

// Task sources
export const TASK_SOURCES = ['manual', 'ai_suggested', 'imported', 'recurring'] as const
export type TaskSource = (typeof TASK_SOURCES)[number]

// Reminder categories
export const REMINDER_CATEGORIES = ['bill', 'insurance', 'car', 'home', 'health', 'subscription', 'other'] as const
export type ReminderCategory = (typeof REMINDER_CATEGORIES)[number]

// Reminder statuses
export const REMINDER_STATUSES = ['open', 'done', 'snoozed'] as const
export type ReminderStatus = (typeof REMINDER_STATUSES)[number]

// Reminder priorities
export const REMINDER_PRIORITIES = ['low', 'normal', 'high'] as const
export type ReminderPriority = (typeof REMINDER_PRIORITIES)[number]

// Wishlist occasions
export const WISHLIST_OCCASIONS = ['birthday', 'christmas', 'anniversary', 'general', 'other'] as const
export type WishlistOccasion = (typeof WISHLIST_OCCASIONS)[number]

// Wishlist item statuses
export const WISHLIST_ITEM_STATUSES = ['open', 'reserved', 'fulfilled', 'dismissed'] as const
export type WishlistItemStatus = (typeof WISHLIST_ITEM_STATUSES)[number]

// Calendar event types
export const CALENDAR_EVENT_TYPES = ['holiday', 'birthday', 'family'] as const
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number]

// Member event types
export const MEMBER_EVENT_TYPES = ['work', 'travel', 'family', 'other'] as const
export type MemberEventType = (typeof MEMBER_EVENT_TYPES)[number]

// Recurrence types
export const RECURRENCE_TYPES = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] as const
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number]

// =============================================================================
// Shopping list categories and filters
// =============================================================================

// All available shopping item categories
export const SHOPPING_CATEGORIES = [
  'produce',      // Frukt og grønt
  'dairy',        // Meieri
  'meat',         // Kjøtt og fisk
  'frozen',       // Frysevarer
  'pantry',       // Tørrvarer
  'beverages',    // Drikkevarer
  'household',    // Husholdning
  'home',         // Hjem og møbler
  'electronics',  // Elektronikk
  'other',        // Annet
] as const
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number]

// Default category order (can be customized per household)
export const DEFAULT_CATEGORY_ORDER: ShoppingCategory[] = [
  'produce', 'dairy', 'meat', 'frozen', 'pantry', 'beverages', 'household', 'home', 'electronics', 'other'
]

// Store/category filter types
export const SHOPPING_FILTERS = ['all', 'dagligvarer', 'hjem', 'annet'] as const
export type ShoppingFilter = (typeof SHOPPING_FILTERS)[number]

// Map filter to categories (default configuration)
export const DEFAULT_FILTER_CATEGORIES: Record<ShoppingFilter, ShoppingCategory[]> = {
  all: [...SHOPPING_CATEGORIES],
  dagligvarer: ['produce', 'dairy', 'meat', 'frozen', 'pantry', 'beverages'],
  hjem: ['household', 'home', 'electronics'],
  annet: ['other'],
}

// View modes for shopping list
export const SHOPPING_VIEW_MODES = ['newest', 'category'] as const
export type ShoppingViewMode = (typeof SHOPPING_VIEW_MODES)[number]
