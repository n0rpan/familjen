import type { Language } from './i18n/types'

// Audit fields shared by most entities
interface AuditFields {
  created_at: string
  updated_at?: string
  updated_by?: string | null
}

export interface Household extends AuditFields {
  id: string
  name: string | null
  ical_calendar_url: string | null
  ical_username: string | null
  ical_password_encrypted: string | null
  openrouter_api_key_encrypted: string | null
  ai_meal_context: string | null  // Default AI preferences for meal suggestions
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
}

export type ChildColor = 'sky' | 'coral' | 'sage' | 'honey' | 'lavender' | 'mint'

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
  created_at: string
  updated_at: string
}

export interface ShoppingListItem {
  id: string
  list_id: string
  name: string
  quantity: string | null
  is_bought: boolean
  source_recipe_id: string | null
  created_at: string
  updated_at: string
}

export interface ShoppingListWithItems extends ShoppingList {
  items: ShoppingListItem[]
}

// Calendar event types
export type CalendarEventType = 'holiday' | 'birthday' | 'family'

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
export type MemberEventType = 'work' | 'travel' | 'family' | 'other'

export interface MemberEvent {
  id: string
  household_id: string
  member_id: string
  date: string  // ISO date string YYYY-MM-DD
  end_date: string | null  // For multi-day events
  title: string
  event_type: MemberEventType
  source: 'manual' | 'google_calendar'
  source_email: string | null
  google_event_id: string | null
  created_at: string
  updated_at: string | null
}

export interface MemberEventWithMember extends MemberEvent {
  member: HouseholdMember
}

// Child tasks (reminders, appointments, bring items)
export type ChildTaskType = 'bring' | 'appointment' | 'reminder' | 'other'
export type ChildTaskStatus = 'open' | 'done'

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
  completed_at: string | null
  completed_by: string | null
  created_at: string
  updated_at: string | null
}

export interface ChildTaskWithChild extends ChildTask {
  child: Child
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
