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
**Status: PENDING**

- [ ] Create prefetch functions for each page:
  - `prefetchFeedData()` - messages, photos, notifications
  - `prefetchShoppingData()` - lists, items
  - `prefetchRecipesData()` - recipes
- [ ] Extend `TransitionLink` with data prefetching on hover
- [ ] Update hooks to check IndexedDB cache first (stale-while-revalidate)

**Key files to create:**
- `src/lib/prefetch/pages.ts`

**Key files to modify:**
- `src/components/TransitionLink.tsx`
- `src/hooks/data/useFeed.ts`
- `src/hooks/data/useShoppingLists.ts`

---

## Phase 3: "Last Updated" Indicator + Realtime
**Status: PENDING**

- [ ] Add i18n strings for relative time (`justNow`, `minutesAgo`, `hoursAgo`, `lastUpdated`)
- [ ] Create `LastUpdated` component
- [ ] Create `useRealtimeToday` hook (immediate subscription, no 500ms delay)
- [ ] Integrate into home page

**Key files to create:**
- `src/components/LastUpdated.tsx`
- `src/hooks/useRealtimeToday.ts`

**Key files to modify:**
- `src/lib/i18n/translations/nb.ts`
- `src/lib/i18n/translations/sv.ts`
- `src/lib/i18n/translations/en.ts`
- `src/lib/i18n/types.ts`

---

## Phase 4: Enhanced Service Worker for API Caching
**Status: PENDING**

- [ ] Add API response caching to `public/sw.js`
- [ ] Implement stale-while-revalidate for Supabase REST API
- [ ] Add cache headers to API routes
- [ ] Test offline behavior

**Key files to modify:**
- `public/sw.js`

---

## Phase 5: Loading State Improvements
**Status: PENDING**

- [ ] Add `loading.tsx` to all main pages:
  - `src/app/feed/loading.tsx`
  - `src/app/handleliste/loading.tsx`
  - `src/app/uke/loading.tsx`
  - `src/app/oppskrifter/loading.tsx`
- [ ] Create page-specific skeleton components:
  - `FeedSkeleton`
  - `ShoppingSkeleton`
  - `WeekPlannerSkeleton`
  - `RecipesSkeleton`

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
