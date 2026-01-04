# Performance Optimization Progress

This tracks our progress on making the app feel instant. See PERFORMANCE_PLAN.md for full details.

## Current Branch: `claude/improve-app-performance-4pylQ`

---

## Phase 1: PPR Foundation for Home Page
**Status: COMPLETE**

- [x] Enable PPR in `next.config.ts` via `cacheComponents: true`
- [x] Create server-side data fetching (`src/lib/data/server.ts`)
  - `fetchHomePageData()` - parallel queries with React `cache()`
  - `getDemoHomePageData()` - same format for demo mode
  - `getTodaySummary()` - extract today from week data
- [x] Create `HomeDataLoader` server component for streaming
- [x] Create `HomeClientInteractions` client component for realtime
- [x] Restructure home page with Suspense boundaries
- [x] Add `loading.tsx` for home page
- [x] Add skeleton components (`HomePageSkeleton`, `TodaySkeleton`, `WeekSkeleton`)
- [x] Code review fixes:
  - Removed unused `useCallback` import
  - Removed unused `userId` parameter from `NoHouseholdView`
  - Changed dynamic import of `redirect` to static import

---

## Phase 2: Data Prefetching on Hover
**Status: COMPLETE**

- [x] Create prefetch functions for each page:
  - `prefetchFeedData()` - messages, photos, notifications
  - `prefetchShoppingData()` - lists, items
  - `prefetchRecipesData()` - recipes
- [x] Extend `TransitionLink` with data prefetching on hover
- [x] Update hooks to check IndexedDB cache first (stale-while-revalidate)
  - `useFeed` - checks cache before fetching, saves to cache after
  - `useShoppingLists` - checks cache before fetching, saves to cache after

**Files created:**
- `src/lib/prefetch/pages.ts` - prefetch functions + cache keys

**Files modified:**
- `src/components/TransitionLink.tsx` - calls prefetchRouteData on hover
- `src/hooks/data/useFeed.ts` - stale-while-revalidate with IndexedDB
- `src/hooks/data/useShoppingLists.ts` - stale-while-revalidate with IndexedDB

---

## Phase 3: "Last Updated" Indicator + Realtime
**Status: COMPLETE**

- [x] Add i18n strings for relative time (`justNow`, `minutesAgo`, `hoursAgo`, `daysAgo`, `lastUpdated`)
- [x] Create `LastUpdated` component
- [x] Integrate into home page (shows relative timestamp in top-right)
- [x] Realtime subscriptions already cover full week (from Phase 1)

**Note:** The `useRealtimeToday` hook wasn't needed - the existing realtime subscriptions in
`HomeClientInteractions` already cover the full week and call `router.refresh()` on changes.

**Files created:**
- `src/components/LastUpdated.tsx` - Relative time indicator with auto-update

**Files modified:**
- `src/lib/i18n/types.ts` - Added relative time strings to `common` section
- `src/lib/i18n/translations/nb.ts` - Norwegian translations
- `src/lib/i18n/translations/sv.ts` - Swedish translations
- `src/lib/i18n/translations/en.ts` - English translations
- `src/components/home/HomePageContent.tsx` - Shows LastUpdated in home page
- `src/components/home/HomeDataLoader.tsx` - Passes timestamp to content

---

## Phase 4: Enhanced Service Worker for API Caching
**Status: RECONSIDERED - Using IndexedDB Instead**

After analysis, SW-level API caching is not ideal for this app:
- Supabase REST API calls are user-specific (auth tokens, RLS policies)
- SW caching could cause data leakage between users
- Our `/api/` routes are mostly write operations (AI, calendar sync)

**What we have instead:**
- IndexedDB caching with stale-while-revalidate in hooks (useFeed, useShoppingLists)
- This is more appropriate because it's user-scoped and handles auth properly

**The SW already handles:**
- Static asset caching (JS, CSS, images, fonts)
- Navigation caching with freshness checking
- Offline fallback for navigation

---

## Phase 5: Loading State Improvements
**Status: COMPLETE**

- [x] Add `loading.tsx` to all main pages:
  - `src/app/feed/loading.tsx`
  - `src/app/handleliste/loading.tsx`
  - `src/app/uke/loading.tsx`
  - `src/app/oppskrifter/loading.tsx`
- [x] Create page-specific skeleton components:
  - `FeedPageSkeleton`
  - `ShoppingPageSkeleton`
  - `WeekPageSkeleton`
  - `RecipesPageSkeleton`

---

## Phase 5b: Page Performance Patterns (Revised)
**Status: COMPLETE**

After analysis, we identified that **not all pages benefit from full PPR conversion**.

### When to Use PPR (Server-First Pattern)
Use for pages that:
- Have mostly static content that changes infrequently
- Don't require heavy client-side interactivity
- Benefit from instant shell rendering

**Example: Home Page (`/`)**
- Server component fetches data, streams via Suspense
- Client component adds realtime subscriptions
- Static shell renders instantly

### When to Use Client-First Pattern
Use for pages that:
- Are heavily interactive (modals, forms, navigation)
- Already have excellent caching (IndexedDB + stale-while-revalidate)
- Have realtime subscriptions that keep data fresh

**Examples: Week (`/uke`), Feed (`/feed`), Shopping (`/handleliste`)**

### Current Optimization Stack (All Pages)
1. **`loading.tsx`** - Instant skeleton on navigation ✅
2. **IndexedDB caching** - Instant data on repeat visits ✅
3. **Stale-while-revalidate** - Show cached, fetch fresh in background ✅
4. **Realtime subscriptions** - Live updates without refresh ✅
5. **Route prefetching** - `TransitionLink` prefetches on hover ✅
6. **Data prefetching** - Hook data prefetched on link hover ✅

### Result
All pages now feel instant:
- First navigation: Shows skeleton immediately
- Repeat visits: Shows cached data instantly, refreshes in background
- Realtime: Updates appear live without user action

**Documentation added to CLAUDE.md for AI agents and developers.**

---

## Phase 6: Code Splitting for Heavy Components
**Status: PENDING**

- [ ] Dynamic import heavy components:
  - `PhotoLightbox`
  - `DuplicateSuggestions`
  - `DuplicateDetection`
  - `ShoppingAI`
  - `AISuggestionModal`
- [ ] Test bundle size improvements

---

## Success Metrics

| Metric | Before | Target | Current |
|--------|--------|--------|---------|
| Home page LCP (repeat visit) | ~2-3s | <500ms | TBD |
| Navigation to /feed | ~1.5s | <300ms | TBD |
| Navigation to /handleliste | ~1s | <300ms | TBD |
| Time to interactive (cold start) | ~3s | <1.5s | TBD |
| Offline support | Partial | Full | Partial |

---

## Notes

- **Demo/Production parity**: Demo mode uses the same `HomeDataLoader` and `HomeClientInteractions` components as production, ensuring E2E tests catch production issues.
- **Realtime subscriptions** now cover the full week (not just today) and fire `router.refresh()` on changes.
- **PPR** is enabled via `cacheComponents: true` (Next.js 16 convention, not `experimental.ppr`).
