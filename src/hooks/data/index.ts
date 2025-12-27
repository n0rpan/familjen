/**
 * Data Hooks Layer
 *
 * This module provides React hooks that abstract data fetching and mutations.
 * Hooks automatically use demo data when ?demo=true is in the URL,
 * otherwise they fetch from Supabase.
 *
 * Usage:
 * ```typescript
 * import { useChildren, usePickups, useMeals } from '@/hooks/data'
 *
 * function MyComponent() {
 *   const { children } = useChildren()
 *   const { pickups, updatePickup } = usePickups({ children })
 *   const { meals, updateMeal } = useMeals()
 *   // ... component logic
 * }
 * ```
 *
 * All hooks return:
 * - Data (e.g., `children`, `pickups`)
 * - Loading state (`loading: boolean`)
 * - Error state (`error: string | null`)
 * - Refetch function (`refetch: () => void`)
 * - Mutation functions where applicable
 */

// Foundation
export { useDataSource, type DataSourceValue } from './useDataSource'

// Core data
export { useHousehold, useHouseholdId, type UseHouseholdReturn } from './useHousehold'
export { useChildren, type UseChildrenReturn } from './useChildren'
export { useMembers, type UseMembersReturn } from './useMembers'

// Week planner data
export { usePickups, type UsePickupsOptions, type UsePickupsReturn } from './usePickups'
export { useMeals, type UseMealsOptions, type UseMealsReturn } from './useMeals'
export { useRecipes, type UseRecipesReturn } from './useRecipes'
export { useTasks, type UseTasksOptions, type UseTasksReturn } from './useTasks'

// Events
export { useMemberEvents, type UseMemberEventsOptions, type UseMemberEventsReturn } from './useMemberEvents'
export { useHouseholdEvents, type UseHouseholdEventsOptions, type UseHouseholdEventsReturn } from './useHouseholdEvents'
export { useExternalEvents, type UseExternalEventsOptions, type UseExternalEventsReturn } from './useExternalEvents'
export { useHolidays, type UseHolidaysOptions, type UseHolidaysReturn } from './useHolidays'

// Feed
export { useFeed, type UseFeedReturn } from './useFeed'

// Shopping
export { useShoppingLists, type ShoppingListWithItems, type UseShoppingListsReturn } from './useShoppingLists'

// Wishlists
export { useWishlists, type UseWishlistsReturn } from './useWishlists'

// Admin
export { useAdmin, type AdminHouseholdWithStats, type UseAdminReturn } from './useAdmin'

// Combined
export { useWeekData, getTodaySummaryFromWeekData, type UseWeekDataOptions, type UseWeekDataReturn } from './useWeekData'
