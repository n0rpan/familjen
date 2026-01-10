# Implementation Plan: Fixing Critical and High Severity Issues

This document provides detailed implementation plans for fixing the bugs identified in the bug report.

---

## Phase 1: Critical - Offline Queue Error Handling (Issues #1, #2, #3)

**Estimated complexity:** Medium
**Files to modify:**
- `src/hooks/data/useTasks.ts`
- `src/hooks/data/useWishlists.ts`
- `src/hooks/useBackgroundSync.ts`
- `src/lib/offline-queue.ts` (optional enhancement)

### Problem Summary
1. Offline queue operations (`queueChange`, `updateQueuedInsert`, `removeQueuedInsert`) are not wrapped in try-catch
2. Sync loop exits early if `removeChange()` or `incrementRetry()` fails
3. Return values from queue operations are not checked

### Implementation Steps

#### Step 1.1: Create error handling utility
```typescript
// src/lib/offline-queue.ts - Add at the end

/**
 * Safe wrapper for queue operations with error notification
 * Returns { success: boolean, error?: string }
 */
export interface QueueOperationResult {
  success: boolean
  error?: string
}

export async function safeQueueChange(change: QueueChangeOptions): Promise<QueueOperationResult> {
  try {
    await queueChange(change)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue change'
    console.error('[OfflineQueue] Failed to queue change:', error)
    return { success: false, error: message }
  }
}

export async function safeUpdateQueuedInsert(
  table: string,
  matchField: string,
  matchValue: unknown,
  updates: Record<string, unknown>
): Promise<QueueOperationResult> {
  try {
    const updated = await updateQueuedInsert(table, matchField, matchValue, updates)
    if (!updated) {
      return { success: false, error: 'Item not found in queue' }
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update queued item'
    console.error('[OfflineQueue] Failed to update queued insert:', error)
    return { success: false, error: message }
  }
}

export async function safeRemoveQueuedInsert(
  table: string,
  matchField: string,
  matchValue: unknown
): Promise<QueueOperationResult> {
  try {
    const removed = await removeQueuedInsert(table, matchField, matchValue)
    if (!removed) {
      return { success: false, error: 'Item not found in queue' }
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove queued item'
    console.error('[OfflineQueue] Failed to remove queued insert:', error)
    return { success: false, error: message }
  }
}
```

#### Step 1.2: Update useTasks.ts with error handling
```typescript
// src/hooks/data/useTasks.ts - Update addTask function (around line 213)

import { safeQueueChange, safeUpdateQueuedInsert, safeRemoveQueuedInsert } from '@/lib/offline-queue'

// In addTask:
if (typeof navigator !== 'undefined' && !navigator.onLine) {
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const result = await safeQueueChange({
    table: 'child_tasks',
    operation: 'insert',
    data: { ...task, _tempId: tempId } as Record<string, unknown>,
  })

  if (!result.success) {
    // Don't update UI - the change wasn't saved
    throw new Error(`Kunne ikke lagre oppgaven offline: ${result.error}`)
  }

  // Only update UI after successful queue
  const tempTask: ChildTask = {
    ...task,
    id: tempId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as ChildTask
  setTasks(prev => [...prev, tempTask])
  return
}

// In updateTask (around line 275):
if (taskId.startsWith('temp-')) {
  const result = await safeUpdateQueuedInsert('child_tasks', '_tempId', taskId, updates)
  if (!result.success) {
    throw new Error(`Kunne ikke oppdatere oppgaven offline: ${result.error}`)
  }
} else {
  const existingTask = tasksRef.current.find(t => t.id === taskId)
  const result = await safeQueueChange({
    table: 'child_tasks',
    operation: 'update',
    data: { id: taskId, ...updates } as Record<string, unknown>,
    originalUpdatedAt: existingTask?.updated_at ?? undefined,
  })
  if (!result.success) {
    throw new Error(`Kunne ikke oppdatere oppgaven offline: ${result.error}`)
  }
}
// Only update UI after successful queue
setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))

// In deleteTask (around line 319):
if (taskId.startsWith('temp-')) {
  const result = await safeRemoveQueuedInsert('child_tasks', '_tempId', taskId)
  if (!result.success) {
    throw new Error(`Kunne ikke slette oppgaven offline: ${result.error}`)
  }
} else {
  const result = await safeQueueChange({
    table: 'child_tasks',
    operation: 'delete',
    data: { id: taskId },
  })
  if (!result.success) {
    throw new Error(`Kunne ikke slette oppgaven offline: ${result.error}`)
  }
}
// Only update UI after successful queue
setTasks(prev => prev.filter(t => t.id !== taskId))
```

#### Step 1.3: Fix sync loop to not exit early
```typescript
// src/hooks/useBackgroundSync.ts - Update the for loop (around line 94)

for (const change of changes) {
  try {
    await processChange(supabase, change)

    // Nested try-catch for queue cleanup
    try {
      await removeChange(change.id)
    } catch (cleanupError) {
      console.error('[BackgroundSync] Failed to remove synced change:', cleanupError)
      // Continue to next change - the change was synced successfully
    }

    console.log(`[BackgroundSync] Synced: ${change.table} ${change.operation}`)
    dispatchSyncEvent(SYNC_EVENTS.SYNC_SUCCESS, { table: change.table, operation: change.operation })
  } catch (error) {
    console.warn(`[BackgroundSync] Failed to sync change:`, error)

    const droppedAfterRetries = change.retries >= MAX_RETRIES

    // Nested try-catch for error handling cleanup
    try {
      if (droppedAfterRetries) {
        console.error(`[BackgroundSync] Removing failed change after ${MAX_RETRIES} retries:`, change)
        await removeChange(change.id)
      } else {
        await incrementRetry(change.id)
      }
    } catch (cleanupError) {
      console.error('[BackgroundSync] Failed to update change state:', cleanupError)
      // Continue to next change - don't exit the loop
    }

    dispatchSyncEvent(SYNC_EVENTS.SYNC_FAILURE, {
      table: change.table,
      operation: change.operation,
      error: error instanceof Error ? error.message : 'Unknown error',
      droppedAfterRetries,
    } as SyncFailureDetail)
  }
}
```

---

## Phase 2: Critical - Fix Temp ID Collision (Issue #4)

**Estimated complexity:** Low
**Files to modify:**
- `src/hooks/data/useTasks.ts`
- `src/hooks/data/useWishlists.ts`

### Implementation

Create a utility function and use it everywhere:

```typescript
// src/lib/utils.ts - Add this function

/**
 * Generate a unique temporary ID for offline items
 * Uses timestamp + random suffix to avoid collisions
 */
export function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
```

Then update all usages:

```typescript
// useTasks.ts, useWishlists.ts - Replace:
const tempId = `temp-${Date.now()}`

// With:
import { generateTempId } from '@/lib/utils'
const tempId = generateTempId()
```

---

## Phase 3: Critical - Add Timeout to Middleware Auth (Issue #5)

**Estimated complexity:** Low
**Files to modify:**
- `src/lib/supabase/middleware.ts`

### Implementation

```typescript
// src/lib/supabase/middleware.ts - Around line 102

// Add timeout constant at top
const AUTH_TIMEOUT_MS = 5000 // 5 seconds

// Replace the auth call with timeout
// OLD:
// const { data: { user } } = await supabase.auth.getUser()

// NEW:
const authPromise = supabase.auth.getUser()
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error('Auth timeout')), AUTH_TIMEOUT_MS)
})

let user = null
try {
  const result = await Promise.race([authPromise, timeoutPromise])
  user = result.data.user
} catch (error) {
  console.warn('[Middleware] Auth validation failed or timed out:', error)
  // On timeout/error, allow request through but don't set validation cookie
  // Background validator will catch invalid sessions
  if (!isProtectedPath) {
    return NextResponse.next({ request })
  }
  // For protected paths, redirect to login on timeout
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}
```

---

## Phase 4: Critical - Fix SmartLoading Week Cache Key (Issue #7)

**Estimated complexity:** Medium
**Files to modify:**
- `src/components/SmartLoading.tsx`
- `src/app/uke/loading.tsx`

### Problem
SmartLoading can't access URL params because it's in `loading.tsx` which renders before the page.

### Solution
Pass week offset as a prop from a wrapper, or use a different approach:

```typescript
// src/components/SmartLoading.tsx - Update getCacheKey function

function getCacheKey(page: string, householdId: string, weekOffset?: number): string {
  switch (page) {
    case 'home':
      return CACHE_KEYS.home(householdId)
    case 'week': {
      // Use weekOffset if provided, otherwise default to current week
      const baseDate = new Date()
      if (weekOffset) {
        baseDate.setDate(baseDate.getDate() + weekOffset * 7)
      }
      const weekStart = getWeekStart(baseDate)
      return CACHE_KEYS.week(householdId, formatDateISO(weekStart))
    }
    // ... rest unchanged
  }
}

// Update props interface
interface SmartLoadingProps {
  page: 'home' | 'week' | 'feed' | 'shopping' | 'recipes' | 'settings' | 'styring'
  skeleton: React.ReactNode
  children: (data: unknown) => React.ReactNode
  /** Week offset for week page (0 = current week) */
  weekOffset?: number
}

export function SmartLoading({ page, skeleton, children, weekOffset }: SmartLoadingProps) {
  // ...
  const cacheKey = getCacheKey(page, householdId, weekOffset)
  // ...
}
```

**Alternative approach:** For the week page, accept that navigation to other weeks will show skeleton. Only the current week (most common case) gets instant cache.

---

## Phase 5: High - Add Missing Realtime Subscriptions (Issues #9, #20)

**Estimated complexity:** High
**Files to modify:**
- `src/hooks/data/useRecipes.ts`
- `src/hooks/data/useWishlists.ts`
- `src/hooks/data/useShoppingLists.ts`
- `src/hooks/data/useFeed.ts` (if exists)
- `src/hooks/data/useMemberEvents.ts` (if exists)
- `src/components/shopping/ShoppingPageContent.tsx`

### Pattern to Follow
Use the existing pattern from `useTasks.ts`:

```typescript
// Add to each hook that fetches household data

import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'

// Inside the hook:
useRealtimeSubscription<YourType>({
  table: 'your_table_name',
  filter: household?.id ? createHouseholdFilter(household.id) : undefined,
  enabled: !isDemo && !!household?.id,
  onAny: debouncedRefetch,  // Or just refetch if no debounce needed
})
```

### Tables needing subscriptions:
1. `member_events` - Add to useMemberEvents or create hook
2. `household_events` - Add to useHouseholdEvents or create hook
3. `external_events` - Add to useFeed
4. `external_messages` - Add to useFeed
5. `external_photos` - Add to useFeed
6. `event_change_notifications` - Add to useFeed
7. `shopping_lists` - Add to useShoppingLists (container, not just items)
8. `wishlist_items` - Add to useWishlists
9. `recipes` - Add to useRecipes

---

## Phase 6: High - Fix Cache Update Error Handling (Issues #10, #11, #15, #19)

**Estimated complexity:** Medium
**Files to modify:**
- `src/lib/cache.ts`
- `src/components/home/HomeClientInteractions.tsx`
- Similar files for other pages

### Step 6.1: Expand table mapping in cache.ts
```typescript
// src/lib/cache.ts - Update tableToField (around line 293)

const tableToField: Record<string, string> = {
  // Existing
  pickups: 'pickups',
  meals: 'meals',
  child_tasks: 'tasks',
  member_events: 'memberEvents',
  household_events: 'householdEvents',
  external_events: 'externalEvents',
  // Add missing
  external_messages: 'messages',
  external_photos: 'photos',
  shopping_lists: 'shoppingLists',
  shopping_list_items: 'items',  // For shopping page
  wishlist_items: 'wishlistItems',
  recipes: 'recipes',
  children: 'children',
  household_members: 'members',
}

// Add warning for unknown tables
const arrayField = tableToField[table]
if (!arrayField) {
  console.warn(`[Cache] Unknown table "${table}" - cache not updated`)
  return
}
```

### Step 6.2: Fix timestamp preservation
```typescript
// src/lib/cache.ts - Update updateCacheWithRealtimeChange (around line 330)

// OLD:
await setCache(key, cacheData)

// NEW: Preserve original timestamp
await setCacheWithTimestamp(key, cacheData, cached.timestamp)

// Add new function:
export async function setCacheWithTimestamp<T>(
  key: string,
  data: T,
  timestamp: number,
  retryCount = 0
): Promise<void> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      const entry: CacheEntry<T> = {
        key,
        data,
        timestamp,  // Use provided timestamp instead of Date.now()
      }

      tx.onabort = () => reject(tx.error)
      const request = store.put(entry)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    if (isRecoverableError(error) && retryCount < 1) {
      resetConnection()
      return setCacheWithTimestamp<T>(key, data, timestamp, retryCount + 1)
    }
    console.warn('[Cache] Failed to set cache with timestamp:', error)
  }
}
```

### Step 6.3: Add error handling to realtime cache updates
```typescript
// src/components/home/HomeClientInteractions.tsx - Around line 75

// OLD:
if (data && typeof data === 'object') {
  updateCacheWithRealtimeChange(homeCacheKey, table, eventType, data as Record<string, unknown>)
}

// NEW:
if (data && typeof data === 'object') {
  updateCacheWithRealtimeChange(homeCacheKey, table, eventType, data as Record<string, unknown>)
    .catch(error => {
      console.error(`[HomeRealtime] Failed to update cache for ${table}:`, error)
      // Cache update failed but UI will still refresh via router.refresh()
      // Next cold start may have stale data
    })
}
```

---

## Phase 7: High - Fix Inconsistent Household ID Retrieval (Issues #12, #13)

**Estimated complexity:** Low
**Files to modify:**
- `src/app/uke/page.tsx`
- `src/app/feed/page.tsx` (verify)
- `src/app/oppskrifter/page.tsx` (verify)
- Other page.tsx files

### Implementation
Use `getHouseholdIdFromSession()` consistently across all pages:

```typescript
// src/app/uke/page.tsx - Replace lines 84-88

// OLD:
const householdId = user.app_metadata?.household_id
if (!householdId) {
  redirect('/login')
}

// NEW:
import { getHouseholdIdFromSession } from '@/lib/data/server'

const householdId = await getHouseholdIdFromSession()
if (!householdId) {
  redirect('/login')
}
```

---

## Phase 8: High - Fix Auth Cookie Detection and Callback Error (Issues #14, #18)

**Estimated complexity:** Low
**Files to modify:**
- `src/lib/supabase/middleware.ts`
- `src/app/auth/callback/route.ts`

### Step 8.1: Fix cookie detection
```typescript
// src/lib/supabase/middleware.ts - Line 19-23

// OLD:
function hasAuthCookie(request: NextRequest): boolean {
  const cookies = request.cookies.getAll()
  return cookies.some(cookie => cookie.name.includes('-auth-token'))
}

// NEW: More specific pattern
function hasAuthCookie(request: NextRequest): boolean {
  const cookies = request.cookies.getAll()
  // Supabase auth cookies match pattern: sb-<project-ref>-auth-token
  return cookies.some(cookie => /^sb-[a-z]+-auth-token/.test(cookie.name))
}
```

### Step 8.2: Add error handling to auth callback
```typescript
// src/app/auth/callback/route.ts - Around line 43

// OLD:
const { data: member } = await adminClient
  .from('household_members')
  .select('household_id, language_preference')
  .eq('user_id', user.id)
  .single()

// NEW:
const { data: member, error: memberError } = await adminClient
  .from('household_members')
  .select('household_id, language_preference')
  .eq('user_id', user.id)
  .single()

if (memberError && memberError.code !== 'PGRST116') {
  // Log error but don't fail - user can still access app (just no household)
  console.error('[AuthCallback] Failed to fetch member data:', memberError)
}
```

---

## Phase 9: High - Fix DataCacher Dependency Array (Issue #16)

**Estimated complexity:** Low
**Files to modify:**
- `src/components/home/HomeDataCache.tsx`
- `src/components/shopping/ShoppingDataCache.tsx`
- `src/components/feed/FeedDataCache.tsx`
- `src/components/recipes/RecipesDataCache.tsx`
- Other DataCache files

### Implementation
Use a stable reference for the data dependency:

```typescript
// Example for HomeDataCache.tsx

// Option 1: Use JSON.stringify (simple but may have performance impact for large data)
const dataHash = useMemo(() => JSON.stringify(data), [data])

useEffect(() => {
  async function cacheData() { /* ... */ }
  cacheData()
}, [householdId, dataHash])

// Option 2: Use a version/timestamp from the data itself
useEffect(() => {
  async function cacheData() { /* ... */ }
  cacheData()
}, [householdId, data.timestamp])  // Assuming data has a timestamp field
```

---

## Phase 10: High - Fix Session Validator Network Error Handling (Issue #17)

**Estimated complexity:** Low
**Files to modify:**
- `src/hooks/useSessionValidator.ts`

### Implementation
Add retry logic for transient network errors:

```typescript
// src/hooks/useSessionValidator.ts

const MAX_VALIDATION_RETRIES = 2
const RETRY_DELAY_MS = 2000

const validateSession = useCallback(async (retryCount = 0): Promise<boolean> => {
  try {
    const { data: { user }, error } = await supabaseRef.current.auth.getUser()

    if (error || !user) {
      // Check if it's a network error
      if (error?.message?.includes('fetch') || error?.message?.includes('network')) {
        if (retryCount < MAX_VALIDATION_RETRIES) {
          console.log(`[SessionValidator] Network error, retrying in ${RETRY_DELAY_MS}ms...`)
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
          return validateSession(retryCount + 1)
        }
        console.warn('[SessionValidator] Network error after retries, staying logged in')
        return false  // Don't invalidate on network error
      }

      // Auth error (not network) - session is truly invalid
      await handleInvalidSession()
      return false
    }

    lastValidationRef.current = Date.now()
    return true
  } catch (err) {
    console.error('[SessionValidator] Validation error:', err)

    // Retry on unexpected errors that might be transient
    if (retryCount < MAX_VALIDATION_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
      return validateSession(retryCount + 1)
    }

    return false
  }
}, [handleInvalidSession])
```

---

## Implementation Order

### Week 1: Critical Data Loss Prevention
1. ✅ Phase 1: Offline queue error handling
2. ✅ Phase 2: Temp ID collision fix
3. ✅ Phase 3: Middleware auth timeout

### Week 2: Stale Data Prevention
4. Phase 5: Missing realtime subscriptions (largest effort)
5. Phase 6: Cache update error handling

### Week 3: Consistency & Reliability
6. Phase 4: SmartLoading week cache key
7. Phase 7: Household ID retrieval consistency
8. Phase 8: Auth error handling
9. Phase 9: DataCacher dependencies
10. Phase 10: Session validator retry

---

## Testing Checklist

### Offline Queue (Phase 1-2)
- [ ] Create task offline → app doesn't crash on IndexedDB error
- [ ] Edit temp task offline → update is queued correctly
- [ ] Delete temp task offline → insert is removed from queue
- [ ] Create 2 tasks in same millisecond → both get unique IDs
- [ ] Sync fails 3 times → other items still sync

### Middleware (Phase 3)
- [ ] Slow Supabase response → page loads within 5 seconds
- [ ] Supabase down → protected routes redirect to login

### Realtime (Phase 5-6)
- [ ] Spouse creates recipe → appears without refresh
- [ ] Spouse adds shopping list → appears without refresh
- [ ] Cache updated correctly after realtime event

### Auth (Phase 7-10)
- [ ] New user can access /uke immediately after invite
- [ ] Session validator retries on network error
- [ ] Auth callback handles DB errors gracefully
