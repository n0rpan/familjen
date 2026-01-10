# Familjen Bug Report - Stale Data, Silent Failures & Missing Updates

Generated: 2026-01-10
**Last Updated: 2026-01-10** (fixes applied)

This report documents potential bugs, data integrity issues, and silent failures found during code review.

---

## Fix Status

| Issue | Status | Commit |
|-------|--------|--------|
| #1 Unhandled queue rejections | ✅ FIXED | Added `safeQueueChange` wrappers |
| #2 Sync loop exits early | ✅ FIXED | Added nested try-catch |
| #3 Silent queue failures | ✅ FIXED | Return values now checked |
| #4 Temp ID collision | ✅ FIXED | Added `generateTempId()` with random suffix |
| #5 Middleware auth timeout | ✅ FIXED | Added 5s timeout with Promise.race |
| #6 5-min stale session | ⏭️ SKIPPED | Per user request |
| #7 SmartLoading wrong week | ⏳ TODO | Needs architecture change |
| #8 Race condition UI update | ⏳ TODO | Complex to fix safely |
| #9 Missing realtime (11 tables) | ✅ PARTIAL | Added to wishlists, recipes, shopping |
| #10 Cache update errors | ✅ FIXED | Added error logging |
| #11 Missing table mapping | ✅ FIXED | Expanded to 17 tables |
| #12 JWT sync fire-and-forget | ⏳ TODO | Low priority |
| #13 Inconsistent household ID | ⏳ TODO | Needs page audits |
| #14 Fragile auth cookie | ✅ FIXED | Added specific regex pattern |
| #15 Cache timestamp | ✅ FIXED | Added `setCacheWithTimestamp()` |
| #16 DataCacher re-caching | ⏳ TODO | Needs component updates |
| #17 Network error handling | ✅ FIXED | Added retry logic to session validator |
| #18 Silent auth callback | ✅ FIXED | Added error logging |
| #19 useRecipes demo state | ✅ FIXED | Added demo initializing fallback |
| #20 useWishlists demo state | ✅ FIXED | Added demo initializing fallback |
| #21 Session validator re-attempts | ✅ FIXED | Update timestamp after network errors |

---

## Executive Summary

| Severity | Count | Category |
|----------|-------|----------|
| 🔴 Critical | 8 | Data loss, silent failures, app hangs |
| 🟠 High | 12 | Stale data, missing realtime, race conditions |
| 🟡 Medium | 15 | Performance, inconsistency, poor UX |
| 🟢 Low | 5 | Code quality, maintenance |

---

## 🔴 CRITICAL ISSUES

### 1. Unhandled Promise Rejections Crash Components

**Files:**
- `src/hooks/data/useTasks.ts` (lines 216-220, 277, 321)
- `src/hooks/data/useWishlists.ts` (lines 134, 194, 238)

**Problem:** Offline queue operations (`queueChange`, `updateQueuedInsert`, `removeQueuedInsert`) are NOT wrapped in try-catch:

```typescript
// useTasks.ts:216-220
if (typeof navigator !== 'undefined' && !navigator.onLine) {
  const tempId = `temp-${Date.now()}`
  await queueChange({  // ❌ NOT in try-catch
    table: 'child_tasks',
    operation: 'insert',
    data: { ...task, _tempId: tempId },
  })
  // UI updates optimistically...
}
```

**Impact:** If IndexedDB fails (quota exceeded, private browsing, connection closed):
- Component crashes with unhandled rejection
- User thinks change was saved (optimistic update shown)
- Data is **permanently lost**

**Fix:** Wrap all offline queue calls in try-catch with user notification.

---

### 2. Sync Loop Exits Early on Error - Remaining Changes Lost

**File:** `src/hooks/useBackgroundSync.ts` (lines 94-120)

**Problem:** Error in `removeChange()` or `incrementRetry()` exits the loop:

```typescript
for (const change of changes) {
  try {
    await processChange(supabase, change)
    await removeChange(change.id)
  } catch (error) {
    if (droppedAfterRetries) {
      await removeChange(change.id)  // ❌ NOT in nested try-catch
    } else {
      await incrementRetry(change.id)  // ❌ NOT in nested try-catch
    }
  }
}
```

**Impact:**
- Queue has [A, B, C]
- A fails, triggers `removeChange(A)`
- `removeChange` throws IndexedDB error
- Loop exits, B and C **never sync**
- User loses data without notification

**Fix:** Add nested try-catch around `removeChange` and `incrementRetry`.

---

### 3. Silent updateQueuedInsert/removeQueuedInsert Failures

**Files:**
- `src/hooks/data/useTasks.ts` (lines 275-277)
- `src/hooks/data/useWishlists.ts` (lines 194, 238)

**Problem:** Return value of queue operations is never checked:

```typescript
// useTasks.ts:275-277
if (taskId.startsWith('temp-')) {
  await updateQueuedInsert('child_tasks', '_tempId', taskId, updates)
  // ❌ Return value (true/false) not checked!
}
setTasks(prev => prev.map(...))  // UI shows update as saved
```

**Impact:**
- `updateQueuedInsert` returns `false` if no matching temp item found
- Update is **silently dropped**
- UI shows saved, but nothing queued
- When online, update never syncs

**Fix:** Check return value and show error if `false`.

---

### 4. Temp ID Collision Corrupts Wrong Items

**File:** `src/lib/offline-queue.ts` (lines 220-230, 259-268)

**Problem:** Temp IDs use `Date.now()` which can collide:

```typescript
const tempId1 = `temp-${Date.now()}`  // "temp-1702500000000"
const tempId2 = `temp-${Date.now()}`  // Same millisecond = same ID!
```

The queue operations find first match only:
```typescript
if (change.data[matchField] === matchValue) {
  // Found first match - returns immediately
  cursor.update(change)
  return  // ❌ Only first match processed
}
```

**Impact:** If two items created same millisecond:
- Updating item 2 → updates item 1 instead
- Deleting item 2 → deletes item 1 instead
- **Data corruption**

**Fix:** Add random suffix: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

---

### 5. Missing Timeout on Middleware Auth - App Can Hang

**File:** `src/lib/supabase/middleware.ts` (lines 102-103)

**Problem:** No timeout on Supabase auth call:

```typescript
// SLOW PATH: Need to validate/refresh the session with Supabase
const { data: { user } } = await supabase.auth.getUser()  // ❌ No timeout!
```

**Impact:** If Supabase is slow/unavailable:
- ALL requests blocked
- App appears frozen
- No error shown to user

**Fix:** Add timeout with AbortController or Promise.race.

---

### 6. 5-Minute Stale Session Window Allows Unauthorized Access

**File:** `src/lib/supabase/middleware.ts` (lines 66-74)

**Problem:** Validation skipped for 5 minutes if cookie exists:

```typescript
if (recentlyValidated && !isAdminPath && !isLoginPage) {
  return NextResponse.next({ request })  // ❌ No re-validation for 5 min!
}
```

**Impact:** If user loses access (removed from household, disabled):
- Can still access protected routes for up to 5 minutes
- Potential data breach

**Fix:** Reduce window or add permission check for sensitive operations.

---

### 7. SmartLoading Shows Wrong Week's Cached Data

**File:** `src/components/SmartLoading.tsx` (lines 55-59)

**Problem:** Week page cache key always uses current week:

```typescript
case 'week': {
  const weekStart = getWeekStart(new Date())  // ❌ Always current week!
  return CACHE_KEYS.week(householdId, formatDateISO(weekStart))
}
```

**Impact:**
- User navigates to `/uke?uke=2` (next week)
- SmartLoading shows **current week's** cached data
- Flash/switch when correct data loads
- Offline: shows completely wrong week

**Fix:** SmartLoading needs access to URL params (requires architecture change).

---

### 8. Race Condition: UI Updates Before Queue Confirms Write

**File:** `src/hooks/data/useTasks.ts` (lines 214-229)

**Problem:** Optimistic update happens after `await` but IndexedDB transaction may not have committed:

```typescript
await queueChange({...})  // IndexedDB transaction started
setTasks(prev => [...prev, tempTask])  // UI shows saved
return  // ← App could crash/close here!
// IndexedDB transaction might not be committed yet
```

**Impact:** If app closes immediately after return:
- IndexedDB write may not be durable
- User saw "saved" but data lost on reload

**Fix:** Use IndexedDB transaction `oncomplete` callback before updating UI.

---

## 🟠 HIGH SEVERITY ISSUES

### 9. Missing Realtime Subscriptions (11 Tables!)

**Files:** Various hooks in `src/hooks/data/`

| Table | Hook | Has Subscription? |
|-------|------|-------------------|
| member_events | useMemberEvents.ts | ❌ **MISSING** |
| household_events | useHouseholdEvents.ts | ❌ **MISSING** |
| external_events | useExternalEvents.ts | ❌ **MISSING** |
| external_messages | useFeed.ts | ❌ **MISSING** |
| external_photos | useFeed.ts | ❌ **MISSING** |
| event_change_notifications | useFeed.ts | ❌ **MISSING** |
| shopping_lists | useShoppingLists.ts | ❌ **MISSING** |
| wishlist_items | useWishlists.ts | ❌ **MISSING** |
| recipes | useRecipes.ts | ❌ **MISSING** |

**Impact:** When spouse makes changes to these tables, other family members won't see updates until manual refresh.

**Fix:** Add `useRealtimeSubscription` to each hook.

---

### 10. Realtime Cache Update Errors Silently Ignored

**File:** `src/components/home/HomeClientInteractions.tsx` (lines 75-78)

**Problem:** Fire-and-forget cache update:

```typescript
if (data && typeof data === 'object') {
  updateCacheWithRealtimeChange(homeCacheKey, table, eventType, data)
  // ❌ No await, no error handling
}
```

**Impact:**
- IndexedDB full? Cache update fails silently
- Server refreshes, UI looks correct
- Next PWA cold start: **days-old cached data**

**Fix:** Add error handling with fallback (at minimum log the error).

---

### 11. updateCacheWithRealtimeChange Missing Table Support

**File:** `src/lib/cache.ts` (lines 293-303)

**Problem:** Only 6 tables mapped, many missing:

```typescript
const tableToField: Record<string, string> = {
  pickups: 'pickups',
  meals: 'meals',
  child_tasks: 'tasks',
  member_events: 'memberEvents',
  household_events: 'householdEvents',
  external_events: 'externalEvents',
  // ❌ Missing: shopping_list_items, wishlist_items, recipes, etc.
}

const arrayField = tableToField[table]
if (!arrayField) return  // ❌ SILENT failure - no logging!
```

**Impact:** Realtime updates for unmapped tables silently ignored.

**Fix:** Add all tables to mapping, add warning log for unknown tables.

---

### 12. Race Condition: JWT Sync Fire-and-Forget

**File:** `src/lib/data/server.ts` (lines 457-460)

**Problem:** JWT sync not awaited:

```typescript
syncUserMetadata(user.id, user.email!, memberData.household_id).catch((err) => {
  console.error('[getHouseholdIdFromSession] Failed to sync user metadata:', err)
})
return memberData.household_id  // Returns before sync completes
```

**Impact:**
- User visits 3 pages rapidly
- `syncUserMetadata` called 3 times redundantly
- Database load, potential race conditions

**Fix:** Use deduplication or await the sync.

---

### 13. Inconsistent Household ID Fallback Across Pages

**Files:**
- `src/app/page.tsx` (lines 80-103) - Has manual fallback ✅
- `src/app/uke/page.tsx` (lines 84-88) - **No fallback** ❌
- `src/app/feed/page.tsx` - Uses `getHouseholdIdFromSession()` ✅

**Problem:** Week page doesn't check database:

```typescript
// uke/page.tsx
const householdId = user.app_metadata?.household_id
if (!householdId) {
  redirect('/login')  // ❌ No database fallback!
}
```

**Impact:** Newly invited users can't access `/uke` until JWT refreshes (requires logout/login).

**Fix:** Use `getHouseholdIdFromSession()` consistently.

---

### 14. Fragile Auth Cookie Detection

**File:** `src/lib/supabase/middleware.ts` (lines 19-23)

**Problem:** Cookie name check is too loose:

```typescript
return cookies.some(cookie => cookie.name.includes('-auth-token'))
```

**Impact:** Could match unintended cookies from other services.

**Fix:** Use exact Supabase cookie name pattern.

---

### 15. Cache Timestamp Misleading After Realtime Update

**File:** `src/lib/cache.ts` (line 330 comment vs line 165 behavior)

**Problem:** Comment says "preserves original timestamp" but `setCache()` creates new timestamp:

```typescript
// Comment: "preserves original timestamp"
await setCache(key, cacheData)  // Actually sets timestamp to Date.now()!
```

**Impact:**
- Realtime update arrives 10 min late
- Cache timestamp shows "just now"
- FreshnessIndicator misleads user

**Fix:** Preserve original timestamp or add `dataTimestamp` separate from `cacheTimestamp`.

---

### 16. DataCacher Dependency Causes Excessive Re-caching

**Files:**
- `src/components/home/HomeDataCache.tsx` (line 307)
- `src/components/shopping/ShoppingDataCache.tsx` (line 168)
- `src/components/feed/FeedDataCache.tsx` (line 211)
- `src/components/recipes/RecipesDataCache.tsx` (line 168)

**Problem:** `data` object in dependency array:

```typescript
useEffect(() => {
  async function cacheData() { /* ... */ }
  cacheData()
}, [householdId, data])  // ❌ If data is new object each render
```

**Impact:** Effect runs on every parent re-render, excessive IndexedDB writes, battery drain on mobile.

**Fix:** Use `JSON.stringify(data)` or memoize data in parent.

---

### 17. Network Errors Not Distinguished from Invalid Session

**File:** `src/hooks/useSessionValidator.ts` (lines 58-62)

**Problem:** Network errors return `false` without retry:

```typescript
} catch (err) {
  console.error('[SessionValidator] Validation error:', err)
  return false  // ❌ No retry, stale session indefinitely
}
```

**Impact:** Temporary network issue leaves user with stale auth state.

**Fix:** Add retry logic for network errors.

---

### 18. Silent Auth Callback Failure

**File:** `src/app/auth/callback/route.ts` (lines 43-47)

**Problem:** Database query error not checked:

```typescript
const { data: member } = await adminClient
  .from('household_members')
  .select('household_id, language_preference')
  .eq('user_id', user.id)
  .single()
  // ❌ No error check!
```

**Impact:** Query failure silently treats user as having no household.

**Fix:** Check for error and handle appropriately.

---

### 19. Race: Realtime Cache vs Server Revalidation

**File:** `src/components/home/HomeClientInteractions.tsx` (lines 75-82)

**Problem:** Cache update not awaited before server revalidation:

```typescript
updateCacheWithRealtimeChange(...)  // ❌ Not awaited (T0)
await revalidateWeek(...)           // Server cache refreshed (T1)
router.refresh()                     // UI updates (T2)
// IndexedDB might complete at T3, overwriting with stale data
```

**Impact:** Brief window where IndexedDB has incomplete data.

**Fix:** Await cache update or use proper sequencing.

---

### 20. Shopping Lists Table Subscription Missing

**File:** `src/components/shopping/ShoppingPageContent.tsx`

**Problem:** Subscribes to `shopping_list_items` but NOT `shopping_lists`:

**Impact:** When spouse creates/renames/deletes a list, won't appear until refresh.

**Fix:** Add subscription for `shopping_lists` table.

---

## 🟡 MEDIUM SEVERITY ISSUES

### 21. Silent IndexedDB Errors in OfflineIndicator

**File:** `src/components/OfflineIndicator.tsx` (lines 27-35)

```typescript
} catch {
  // IndexedDB might not be available
  // ❌ Silently ignored
}
```

**Impact:** Pending count shows "0" when IndexedDB unavailable.

---

### 22. Fire-and-Forget Revalidation with Only Console Warning

**File:** `src/lib/revalidate.ts` (lines 92-176)

All revalidation functions use:
```typescript
fetch('/api/revalidate', {...}).catch(err => {
  console.warn('[revalidate] Failed...', err)  // ❌ User not notified
})
```

**Impact:** Failed revalidation → stale data on next page load.

---

### 23. Empty Catch Blocks on Logout Cache Clear

**Files:**
- `src/hooks/useSessionValidator.ts` (line 35-38)
- `src/components/Header.tsx` (line 222-225)

```typescript
Promise.all([clearAllCache(), clearAllChanges()]).catch(() => {})
```

**Impact:** User not notified if logout cleanup fails.

---

### 24. AI Extraction Errors Silently Swallowed

**File:** `src/app/api/calendar/household-ics-sync/route.ts` (lines 83-92)

```typescript
try {
  await processHouseholdEventsWithAI(...)
} catch (aiError) {
  console.error(...)  // ❌ User not notified
}
```

**Impact:** Events sync but AI suggestions not created, user unaware.

---

### 25. useAuthState Race Condition

**File:** `src/hooks/useAuthState.ts` (lines 78-96)

**Problem:** Async `getSession()` not awaited, no error handling.

**Impact:** Components may render with loading state, then update after unmount.

---

### 26. Redundant Version Validation in SmartLoading

**File:** `src/components/SmartLoading.tsx` (lines 86-95)

Version checked twice (once in `getCachedSync`, once in component).

**Impact:** Maintenance burden, could diverge.

---

### 27-35. Various Minor Issues

- Service worker update errors only logged to console
- Missing error handling in invite claim RPC
- Inconsistent household ID retrieval patterns
- Cache operations catch blocks intentionally empty
- Integration AI extraction fire-and-forget
- Double realtime subscriptions in WeekPageContent
- etc.

---

## Recommended Fix Priority

### Immediate (Data Loss Risk)
1. ✅ Wrap offline queue operations in try-catch
2. ✅ Add nested try-catch in sync loop
3. ✅ Check return values of queue operations
4. ✅ Fix temp ID collision with random suffix
5. ✅ Add timeout to middleware auth call

### This Week (Stale Data)
6. Add missing realtime subscriptions (11 tables)
7. Add error handling to cache updates
8. Expand updateCacheWithRealtimeChange table mapping
9. Use consistent `getHouseholdIdFromSession()` across pages
10. Fix cache timestamp preservation

### This Sprint (UX/Reliability)
11. Add user feedback for revalidation failures
12. Distinguish network errors from session invalidity
13. Fix SmartLoading week page cache key
14. Reduce 5-minute stale session window
15. Add retry logic for transient failures

---

## Testing Recommendations

### Unit Tests Needed
- [ ] Offline queue error handling
- [ ] Temp ID uniqueness
- [ ] Cache version validation
- [ ] Return value handling for queue operations

### E2E Tests Needed
- [ ] Offline mode data persistence
- [ ] Multi-device realtime sync
- [ ] Session expiry handling
- [ ] PWA cold start with stale cache

### Manual QA Scenarios
- [ ] Create items rapidly offline (temp ID collision)
- [ ] Logout while offline with pending changes
- [ ] Remove user from household, verify access revoked within 5 min
- [ ] Slow/unstable network during auth
