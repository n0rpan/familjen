import type { Language } from './i18n/types'
import type {
  ChildColor,
  ChildTaskType,
  ChildTaskStatus,
  TaskSource,
  ReminderCategory,
  ReminderStatus,
  ReminderPriority,
  WishlistOccasion,
  WishlistItemStatus,
  CalendarEventType,
  MemberEventType,
  RecurrenceType,
  ShoppingCategory,
  ShoppingFilter,
  ShoppingViewMode,
} from './constants'

// Re-export shared types from constants (single source of truth)
export type {
  ChildColor,
  ChildTaskType,
  ChildTaskStatus,
  TaskSource,
  ReminderCategory,
  ReminderStatus,
  ReminderPriority,
  WishlistOccasion,
  WishlistItemStatus,
  CalendarEventType,
  MemberEventType,
  RecurrenceType,
  ShoppingCategory,
  ShoppingFilter,
  ShoppingViewMode,
}

// Audit fields shared by most entities
interface AuditFields {
  created_at: string
  updated_at?: string
  updated_by?: string | null
}

export interface Household extends AuditFields {
  id: string
  name: string | null
  ical_calendar_url?: string | null  // Optional: not in all environments (legacy)
  ical_username?: string | null  // Optional: not in all environments (legacy)
  ical_password_encrypted?: string | null  // Optional: not fetched in UI queries (legacy)
  ics_calendar_url?: string | null  // Shared family ICS calendar URL
  ics_last_sync_at?: string | null  // Last successful household ICS sync
  ics_sync_error?: string | null  // Error from last failed sync
  openrouter_api_key_encrypted?: string | null  // Optional: not fetched in UI queries
  ai_meal_context: string | null  // Default AI preferences for meal suggestions
  share_names_with_ai: boolean  // When false, anonymize children names in AI prompts
  external_integrations_enabled: boolean  // Allow household to connect Spond, Kidplan, iSkole
  shopping_settings?: ShoppingSettings | null  // Shopping list preferences
}

export interface HouseholdMember extends AuditFields {
  id: string
  household_id: string
  name: string
  short_name: string | null
  is_parent: boolean
  is_household_admin: boolean  // Can manage household members and settings
  user_id: string | null
  email: string | null  // Login email - gives access to household
  birth_date: string | null  // ISO date string YYYY-MM-DD
  work_email: string | null  // For sending work calendar invites
  allergies: string[]  // List of allergies/dietary restrictions
  language_preference: Language | null  // User's preferred UI language
  ics_calendar_url: string | null  // Published ICS calendar URL for syncing work calendar
  ics_last_sync_at: string | null  // Last successful ICS sync timestamp
  ics_sync_error: string | null  // Error from last failed ICS sync attempt
}

export interface Child extends AuditFields {
  id: string
  household_id: string
  name: string
  color: ChildColor
  location_name: string | null
  location_type: 'school' | 'kindergarten' | null
  sort_order: number | null
  birth_date: string | null  // ISO date string YYYY-MM-DD
  allergies: string[]  // List of allergies/dietary restrictions
}

export interface Pickup extends AuditFields {
  id: string
  household_id: string
  child_id: string
  date: string // ISO date string YYYY-MM-DD
  picker_id: string | null
  notes: string | null
  synced_to_calendar: boolean
  calendar_event_id: string | null
  sync_to_work_calendar: boolean  // Send invite to picker's work email
  work_calendar_event_id: string | null  // Google Calendar event ID
}

export interface Recipe extends AuditFields {
  id: string
  household_id: string
  name: string
  ingredients: RecipeIngredient[] | null
  instructions: string | null
  external_link: string | null
  is_quick: boolean
  is_kid_friendly: boolean
  is_favorite: boolean
}

export interface RecipeIngredient {
  item: string
  amount: string
}

export interface Meal extends AuditFields {
  id: string
  household_id: string
  date: string // ISO date string YYYY-MM-DD
  recipe_id: string | null
  custom_meal: string | null
  notes: string | null
}

// Extended types with relations
export interface PickupWithDetails extends Pickup {
  child: Child
  picker: HouseholdMember | null
}

export interface MealWithRecipe extends Meal {
  recipe: Recipe | null
}

// Weekly plan data structure
export interface WeekPlan {
  weekStart: string // Monday date
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
}

// Day summary for the home page
export interface DaySummary {
  date: string
  pickups: PickupWithDetails[]
  meal: MealWithRecipe | null
  tasks: ChildTaskWithChild[]
  reminders?: HouseholdReminderWithAssignee[]
  householdEvents?: HouseholdEvent[]
}

// Admin types
export interface AllowedEmail {
  id: string
  email: string
  added_by: string | null
  is_admin: boolean
  can_create_household: boolean  // Can create their own household (vs must be invited)
  invited_by_household_id: string | null  // Which household invited this user
  created_at: string
}

export interface AppSetting {
  key: string
  value: string
  updated_at: string
}

// Extended household type for admin view with member and child counts
export interface HouseholdWithCounts extends Household {
  member_count: number
  child_count: number
}

// Extended member type with user email for admin linking
export interface HouseholdMemberWithUser extends HouseholdMember {
  user_email?: string | null
}

// Audit log entry
export interface AuditLogEntry {
  id: string
  created_at: string
  actor_user_id: string | null
  household_id: string | null
  table_name: string
  row_id: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changes: Record<string, { old: unknown; new: unknown }> | null
}

// Shopping list types
export interface ShoppingList {
  id: string
  household_id: string
  name: string
  sort_order: number
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface ShoppingListItem {
  id: string
  list_id: string
  name: string
  quantity: string | null
  is_bought: boolean
  category: ShoppingCategory  // AI-assigned category
  source_recipe_id: string | null
  created_at: string
  updated_at: string
  updated_by?: string | null  // For realtime sync
}

export interface ShoppingListWithItems extends ShoppingList {
  items: ShoppingListItem[]
}

// Shopping settings stored in households.shopping_settings
export interface ShoppingSettings {
  categoryOrder?: ShoppingCategory[]
  defaultView?: ShoppingViewMode
  filters?: Record<string, ShoppingCategory[]>  // Custom filter definitions
}

// Duplicate check result from check_shopping_duplicate function
export interface ShoppingDuplicateMatch {
  id: string
  name: string
  quantity: string | null
  list_id: string
  similarity_score: number
}

export interface CalendarEvent {
  id: string
  household_id: string | null  // NULL for system holidays
  date: string  // ISO date string YYYY-MM-DD
  name: string
  event_type: CalendarEventType
  is_annual: boolean
  source_member_id: string | null
  source_child_id: string | null
  created_at: string
}

// Member events (work trips, dinners, etc.)
export interface MemberEvent {
  id: string
  household_id: string
  member_id: string
  date: string  // ISO date string YYYY-MM-DD
  end_date: string | null  // For multi-day events
  title: string
  event_type: MemberEventType
  event_time: string | null  // HH:MM:SS start time (from ICS DTSTART)
  source: 'manual' | 'google_calendar' | 'ics_calendar'
  source_email: string | null
  google_event_id: string | null
  ics_uid: string | null  // ICS event UID for deduplication
  created_at: string
  updated_at: string | null
}

export interface MemberEventWithMember extends MemberEvent {
  member: HouseholdMember
}

// Household events (shared family calendar events)
export interface HouseholdEvent {
  id: string
  household_id: string
  title: string
  description: string | null
  event_date: string  // ISO date string YYYY-MM-DD
  end_date: string | null  // For multi-day events
  event_time: string | null  // null = all-day
  end_time: string | null
  location: string | null
  source: 'manual' | 'ics_calendar'
  ics_uid: string | null
  is_redistributed: boolean
  created_at: string
  updated_at: string | null
}

// External events (from Spond, Kidplan, iSkole)
export interface ExternalEvent {
  id: string
  integration_id: string
  child_id: string | null
  external_id: string
  external_group_id: string | null
  title: string
  description: string | null
  event_date: string  // YYYY-MM-DD
  event_time: string | null  // HH:MM:SS
  end_date: string | null
  end_time: string | null
  location: string | null
  event_type: string | null
  is_hidden: boolean
  user_notes: string | null
  created_at: string
  updated_at: string | null
  // Joined data
  integration?: {
    service: string
    display_name: string
  }
}

// Recurrence pattern for recurring tasks/reminders
export interface RecurrencePattern {
  type: RecurrenceType
  days?: number[]        // For weekly: 0=Sun, 1=Mon, etc.
  dayOfMonth?: number    // For monthly
  interval?: number      // Every N days/weeks/months
  endDate?: string       // When recurrence stops (ISO date)
}

export interface ChildTask {
  id: string
  household_id: string
  child_id: string
  date: string  // ISO date YYYY-MM-DD
  time: string | null  // HH:MM for appointments
  task_type: ChildTaskType
  title: string
  notes: string | null
  status: ChildTaskStatus
  source: TaskSource
  recurrence_pattern: RecurrencePattern | null
  parent_task_id: string | null
  completed_at: string | null
  completed_by: string | null
  created_at: string
  updated_at: string | null
}

export interface ChildTaskWithChild extends ChildTask {
  child: Child
}

// Household reminders (not tied to a specific child)
export interface HouseholdReminder {
  id: string
  household_id: string
  date: string  // ISO date YYYY-MM-DD
  time: string | null
  title: string
  notes: string | null
  category: ReminderCategory
  status: ReminderStatus
  priority: ReminderPriority
  snoozed_until: string | null
  assigned_to: string | null
  source: TaskSource
  recurrence_pattern: RecurrencePattern | null
  parent_reminder_id: string | null
  completed_at: string | null
  completed_by: string | null
  created_at: string
  updated_at: string | null
}

export interface HouseholdReminderWithAssignee extends HouseholdReminder {
  assignee: HouseholdMember | null
}

// Wishlists
export interface Wishlist {
  id: string
  household_id: string
  member_id: string | null  // For adult wishlists
  child_id: string | null   // For child wishlists
  name: string
  occasion: WishlistOccasion | null
  occasion_date: string | null
  description: string | null
  is_public: boolean
  sort_order: number
  created_at: string
  updated_at: string | null
}

export interface WishlistItem {
  id: string
  wishlist_id: string
  name: string
  description: string | null
  link: string | null
  price: number | null
  currency: string
  image_url: string | null
  priority: number  // 0-5, higher = more wanted
  quantity: number
  status: WishlistItemStatus
  reserved_by: string | null
  reserved_at: string | null
  fulfilled_by: string | null
  fulfilled_at: string | null
  notes: string | null
  buyer_notes: string | null
  created_at: string
  updated_at: string | null
}

export interface WishlistWithItems extends Wishlist {
  items: WishlistItem[]
  owner_name: string  // Resolved from member or child
  owner_color: ChildColor | null  // If child, their color
}

export interface WishlistWithOwner extends Wishlist {
  member: HouseholdMember | null
  child: Child | null
}

export interface WishlistItemWithReservation extends WishlistItem {
  reserver: HouseholdMember | null
  fulfiller: HouseholdMember | null
}

// Week-specific AI context
export interface WeekContext {
  id: string
  household_id: string
  week_start: string  // Monday date
  context: string
  created_at: string
  updated_at: string
}

// AI meal suggestion types
export interface MealSuggestion {
  day: string  // ISO date string
  name: string
  description: string
  ingredients: RecipeIngredient[]
  is_quick: boolean
  is_kid_friendly: boolean
}

export interface AIMealSuggestionsRequest {
  weekStart: string
  existingMeals: { date: string; name: string }[]
  recipes: Pick<Recipe, 'id' | 'name' | 'is_favorite' | 'is_quick' | 'is_kid_friendly'>[]
  childrenAges: number[]
  holidays: { date: string; name: string }[]
  defaultContext: string | null
  weekContext: string | null
  season: string
}

export interface AIMealSuggestionsResponse {
  suggestions: MealSuggestion[]
}

// Unmatched calendar invite (for review tray)
export interface UnmatchedCalendarInvite {
  id: string  // Unique ID (from gmail message ID or UID)
  title: string
  date: string  // ISO date
  endDate?: string
  organizerEmail: string  // Original email (for backend matching)
  maskedEmail: string  // Masked version for display
  receivedAt: string  // When the invite was received
  expiresAt: string  // When this unmatched invite expires (7 days)
}
