/**
 * Demo Mode Types
 *
 * Defines the shape of demo state stored in sessionStorage.
 * Uses actual app types to ensure TypeScript catches schema changes.
 */

import type {
  Household,
  HouseholdMember,
  Child,
  Pickup,
  PickupWithDetails,
  Meal,
  MealWithRecipe,
  Recipe,
  ChildTask,
  ChildTaskWithChild,
  MemberEvent,
  HouseholdEvent,
  ExternalEvent,
  ShoppingList,
  ShoppingListItem,
  WishlistItem,
  AllowedEmail,
} from '@/lib/types'
import type { Holiday } from '@/lib/utils'
import type { FeedMessage } from '@/components/feed/MessageCard'
import type { FeedPhoto } from '@/components/feed/PhotoGallery'

/**
 * Complete demo state stored in sessionStorage
 */
export interface DemoState {
  // Core data (generated once, mutated in session)
  household: Household
  members: HouseholdMember[]
  children: Child[]

  // Week data
  pickups: Pickup[]
  meals: Meal[]
  recipes: Recipe[]
  childTasks: ChildTask[]
  memberEvents: MemberEvent[]
  householdEvents: HouseholdEvent[]
  externalEvents: ExternalEvent[]
  holidays: Holiday[]

  // Feed data
  feedMessages: FeedMessage[]
  feedPhotos: FeedPhoto[]

  // Shopping & Wishlists
  shoppingLists: ShoppingListWithItems[]
  wishlists: WishlistItem[]

  // Admin data (fake households for admin page testing)
  adminHouseholds: AdminHousehold[]
  adminAllowedEmails: AllowedEmail[]

  // Metadata
  generatedAt: string  // ISO timestamp
  version: number      // Schema version for cache invalidation
}

export interface ShoppingListWithItems extends ShoppingList {
  items: ShoppingListItem[]
}

export interface AdminHousehold {
  id: string
  name: string
  members: { name: string }[]
  children: { name: string }[]
  created_at: string
}

/**
 * Demo data source context value
 */
export interface DemoDataContextValue {
  isDemo: boolean
  demoState: DemoState | null

  // Mutations - update local state and persist to sessionStorage
  updatePickup: (childId: string, date: string, pickerId: string | null, time?: string | null) => void
  updateMeal: (date: string, recipeId: string | null, customMeal: string | null) => void
  addTask: (task: Omit<ChildTask, 'id' | 'created_at' | 'updated_at'>) => void
  updateTask: (taskId: string, updates: Partial<ChildTask>) => void
  deleteTask: (taskId: string) => void
  addRecipe: (recipe: Omit<Recipe, 'id' | 'created_at' | 'updated_at'>) => void
  updateRecipe: (recipeId: string, updates: Partial<Recipe>) => void
  deleteRecipe: (recipeId: string) => void
  addShoppingItem: (listId: string, item: Omit<ShoppingListItem, 'id' | 'created_at' | 'updated_at'>) => void
  updateShoppingItem: (itemId: string, updates: Partial<ShoppingListItem>) => void
  deleteShoppingItem: (itemId: string) => void

  // Exit demo mode
  exitDemo: () => void
}

/**
 * Demo rate limit tracking (stored in server-side KV)
 */
export interface DemoRateLimitState {
  tokensUsed: number
  requestCount: number
  costUsd: number
  windowStart: string  // ISO timestamp
}

export const DEMO_STATE_VERSION = 1
export const DEMO_STORAGE_KEY = 'familjen-demo-state'
