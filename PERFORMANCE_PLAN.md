# Performance Optimization Plan: Instant App Experience

## Goal
Make the app feel instant for recurring users:
1. **Home page loads instantly** - static shell + streaming dynamic content
2. **Navigation feels native** - data prefetched before click
3. **Always fresh** - realtime subscriptions + "last updated" indicator
4. **Works offline** - Service Worker caches API responses

---

## Phase 1: PPR Foundation for Home Page

### 1.1 Enable PPR in Next.js Config

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  experimental: {
    ppr: true,  // Enable Partial Prerendering
  },
  // ... existing config
}
```

### 1.2 Create Server-Side Data Fetching

Create new server-side data fetchers that bypass the client hooks:

```
src/lib/data/
├── server.ts              # Server-only data fetching utilities
├── fetchTodayData.ts      # Fetch today's pickups, meals, tasks
├── fetchWeekData.ts       # Fetch full week data
└── types.ts               # Shared types for server/client
```

**Key Pattern:**
```typescript
// src/lib/data/fetchTodayData.ts
import { createClient } from '@/lib/supabase/server'
import { formatDateISO, getWeekStart, addDays } from '@/lib/utils'
import type { TodayData } from './types'

export async function fetchTodayData(householdId: string): Promise<TodayData> {
  const supabase = await createClient()
  const today = formatDateISO(new Date())
  const weekStart = getWeekStart(new Date())
  const weekEnd = addDays(weekStart, 6)

  // Parallel fetch - all queries run simultaneously
  const [
    { data: children },
    { data: members },
    { data: pickups },
    { data: meals },
    { data: tasks },
    { data: memberEvents },
    { data: householdEvents },
    { data: externalEvents },
  ] = await Promise.all([
    supabase.from('children').select('*').eq('household_id', householdId),
    supabase.from('household_members').select('*').eq('household_id', householdId),
    supabase.from('pickups').select('*, picker:household_members(*), child:children(*)').eq('date', today),
    supabase.from('meals').select('*, recipe:recipes(*)').eq('date', today),
    supabase.from('child_tasks').select('*, child:children(*)').eq('date', today),
    supabase.from('member_events').select('*').gte('date', today).lte('date', formatDateISO(weekEnd)),
    supabase.from('household_events').select('*').gte('event_date', today).lte('event_date', formatDateISO(weekEnd)),
    supabase.from('external_events').select('*').gte('event_date', today).lte('event_date', formatDateISO(weekEnd)),
  ])

  return { children, members, pickups, meals, tasks, memberEvents, householdEvents, externalEvents }
}
```

### 1.3 Restructure Home Page with PPR

**Current structure (client-only):**
```
page.tsx (client) → useWeekData() → 11 queries → render
```

**New structure (PPR):**
```
page.tsx (server - static shell)
├── <HomeShell />              ← Static, prerendered at build time
├── <Suspense fallback={<TodaySkeleton />}>
│   └── <TodayData />          ← Dynamic, streams in
├── <Suspense fallback={<WeekSkeleton />}>
│   └── <WeekPreview />        ← Dynamic, streams in
└── <HomeClientInteractions /> ← Client component for mutations
```

**Implementation:**

```typescript
// src/app/page.tsx (Server Component)
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { HomeShell } from '@/components/home/HomeShell'
import { TodayData } from '@/components/home/TodayData'
import { WeekPreview } from '@/components/home/WeekPreview'
import { HomeClientInteractions } from '@/components/home/HomeClientInteractions'
import { TodaySkeleton, WeekSkeleton } from '@/components/Skeleton'
import { getLanguageFromCookieOrBrowser } from '@/lib/i18n/cookie.server'
import { getTranslations } from '@/lib/i18n/translations'

export default async function HomePage() {
  const language = await getLanguageFromCookieOrBrowser()
  const t = getTranslations(language)
  const supabase = await createClient()

  // Get user and household ID (fast - from JWT)
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return <HomeShell.NotLoggedIn t={t} />
  }

  // Get household ID from user's app_metadata (synced at login)
  const householdId = user.app_metadata?.household_id

  if (!householdId) {
    return <HomeShell.NoHousehold t={t} />
  }

  // Static shell renders immediately, dynamic content streams in
  return (
    <HomeShell t={t}>
      {/* Today's data streams in first (most important) */}
      <Suspense fallback={<TodaySkeleton />}>
        <TodayData householdId={householdId} />
      </Suspense>

      {/* Week preview streams in after */}
      <Suspense fallback={<WeekSkeleton />}>
        <WeekPreview householdId={householdId} />
      </Suspense>

      {/* Client component for realtime + mutations */}
      <HomeClientInteractions householdId={householdId} />
    </HomeShell>
  )
}
```

```typescript
// src/components/home/TodayData.tsx (Server Component)
import { fetchTodayData } from '@/lib/data/fetchTodayData'
import { TodaySection } from '@/components/TodaySection'

interface Props {
  householdId: string
}

export async function TodayData({ householdId }: Props) {
  const data = await fetchTodayData(householdId)

  return (
    <TodaySection
      summary={data.todaySummary}
      holidays={data.holidays}
      members={data.members}
      children={data.children}
      householdId={householdId}
    />
  )
}
```

### 1.4 Create loading.tsx for Home

```typescript
// src/app/loading.tsx
import { HomePageSkeleton } from '@/components/Skeleton'

export default function HomeLoading() {
  return <HomePageSkeleton />
}
```

### 1.5 Keep Demo Mode Working

Demo mode continues to work via the existing client components:

```typescript
// src/app/page.tsx
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>
}) {
  const params = await searchParams
  const isDemo = params.demo === 'true'

  if (isDemo) {
    // Demo mode uses client components with mock data
    return <HomePageDemo />
  }

  // Production uses server components with PPR
  return <HomePageProduction />
}
```

---

## Phase 2: Data Prefetching on Hover

### 2.1 Create Prefetch Functions for Each Page

```typescript
// src/lib/prefetch/pages.ts
import { prefetchWeekData } from './fetchers'

export async function prefetchFeedData(householdId: string): Promise<void> {
  const cacheKey = `feed-${householdId}`
  // Check if already cached
  const cached = await getCached(cacheKey)
  if (cached && !isStale(cached, 3 * 60 * 1000)) return

  // Prefetch in parallel
  const [messages, photos, notifications] = await Promise.all([
    supabase.from('external_messages').select('*').limit(50),
    supabase.from('external_photos').select('*').limit(20),
    supabase.from('event_change_notifications').select('*').limit(10),
  ])

  await setCache(cacheKey, { messages, photos, notifications })
}

export async function prefetchShoppingData(householdId: string): Promise<void> {
  const cacheKey = `shopping-${householdId}`
  const cached = await getCached(cacheKey)
  if (cached && !isStale(cached, 3 * 60 * 1000)) return

  const [lists, items] = await Promise.all([
    supabase.from('shopping_lists').select('*').eq('household_id', householdId),
    supabase.from('shopping_list_items').select('*'),
  ])

  await setCache(cacheKey, { lists, items })
}
```

### 2.2 Extend TransitionLink with Data Prefetching

```typescript
// src/components/TransitionLink.tsx
import { prefetchFeedData, prefetchShoppingData } from '@/lib/prefetch/pages'
import { useHouseholdId } from '@/hooks/data/useHousehold'

const PREFETCH_MAP: Record<string, (householdId: string) => Promise<void>> = {
  '/feed': prefetchFeedData,
  '/handleliste': prefetchShoppingData,
  '/oppskrifter': prefetchRecipesData,
}

export function TransitionLink({ href, children, ...props }: TransitionLinkProps) {
  const householdId = useHouseholdId()
  const [prefetched, setPrefetched] = useState(false)

  const handleMouseEnter = useCallback(() => {
    if (prefetched || !householdId) return

    // Prefetch route (existing)
    router.prefetch(href)

    // Prefetch data (new)
    const path = href.split('?')[0]
    const prefetchFn = PREFETCH_MAP[path]
    if (prefetchFn) {
      prefetchFn(householdId)
    }

    setPrefetched(true)
  }, [router, href, householdId, prefetched])

  // ... rest unchanged
}
```

### 2.3 Use Prefetched Data in Pages

```typescript
// src/hooks/data/useFeed.ts
export function useFeed() {
  const [data, setData] = useState<FeedData | null>(null)
  const householdId = useHouseholdId()

  useEffect(() => {
    async function load() {
      // Try cache first (may have been prefetched on hover)
      const cached = await getCached(`feed-${householdId}`)
      if (cached) {
        setData(cached.data)
        setLoading(false)
        // Still fetch fresh in background
      }

      // Fetch fresh data
      const fresh = await fetchFeedData(householdId)
      setData(fresh)
      await setCache(`feed-${householdId}`, fresh)
    }

    load()
  }, [householdId])

  return { data, loading }
}
```

---

## Phase 3: "Last Updated" Indicator + Realtime

### 3.1 Create LastUpdated Component

```typescript
// src/components/LastUpdated.tsx
'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/context'

interface Props {
  timestamp: Date | null
  className?: string
}

export function LastUpdated({ timestamp, className }: Props) {
  const { t } = useLanguage()
  const [relativeTime, setRelativeTime] = useState('')

  useEffect(() => {
    if (!timestamp) return

    const update = () => {
      const diff = Date.now() - timestamp.getTime()
      const minutes = Math.floor(diff / 60000)

      if (minutes < 1) {
        setRelativeTime(t.common.justNow)
      } else if (minutes < 60) {
        setRelativeTime(t.common.minutesAgo.replace('{n}', String(minutes)))
      } else {
        const hours = Math.floor(minutes / 60)
        setRelativeTime(t.common.hoursAgo.replace('{n}', String(hours)))
      }
    }

    update()
    const interval = setInterval(update, 60000) // Update every minute
    return () => clearInterval(interval)
  }, [timestamp, t])

  if (!timestamp) return null

  return (
    <span className={className} style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
      {t.common.lastUpdated}: {relativeTime}
    </span>
  )
}
```

### 3.2 Add to Home Page

```typescript
// In HomeShell or TodaySection
<div className="flex items-center justify-between">
  <h2>{t.home.today}</h2>
  <LastUpdated timestamp={lastFetchTime} />
</div>
```

### 3.3 Immediate Realtime Subscriptions for Critical Data

```typescript
// src/hooks/useRealtimeToday.ts
'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useRealtimeToday(householdId: string, onUpdate: () => void) {
  useEffect(() => {
    const supabase = createClient()
    const today = formatDateISO(new Date())

    // Subscribe immediately (no deferral) for today's data
    const channel = supabase
      .channel(`today-${householdId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pickups',
        filter: `date=eq.${today}`,
      }, onUpdate)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'meals',
        filter: `date=eq.${today}`,
      }, onUpdate)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'child_tasks',
        filter: `date=eq.${today}`,
      }, onUpdate)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [householdId, onUpdate])
}
```

---

## Phase 4: Enhanced Service Worker for API Caching

### 4.1 Add API Response Caching

Extend `public/sw.js` to cache Supabase API responses:

```javascript
// Add new cache name
const API_CACHE = 'familjen-api-v1'
const API_CACHE_MAX_AGE = 3 * 60 * 1000 // 3 minutes

// In fetch handler, add API caching
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // ... existing static asset handling ...

  // Cache Supabase REST API responses (stale-while-revalidate)
  if (
    url.hostname.includes('supabase.co') &&
    url.pathname.startsWith('/rest/v1/') &&
    request.method === 'GET'
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE)
        const cachedResponse = await cache.match(request)

        // Start network fetch
        const networkPromise = fetch(request).then(async (response) => {
          if (response.ok) {
            const responseToCache = response.clone()
            const headers = new Headers(responseToCache.headers)
            headers.set('sw-cache-time', Date.now().toString())

            const body = await responseToCache.blob()
            await cache.put(request, new Response(body, {
              status: response.status,
              headers: headers
            }))
          }
          return response
        }).catch(() => null)

        // If cached and fresh, return immediately
        if (cachedResponse) {
          const cacheTime = cachedResponse.headers.get('sw-cache-time')
          const age = cacheTime ? Date.now() - parseInt(cacheTime, 10) : Infinity

          if (age < API_CACHE_MAX_AGE) {
            networkPromise // Update in background
            return cachedResponse
          }
        }

        // Wait for network, fallback to stale cache
        const networkResponse = await networkPromise
        return networkResponse || cachedResponse || new Response('Offline', { status: 503 })
      })()
    )
    return
  }

  // ... existing navigation handling ...
})
```

### 4.2 Add Cache Headers to API Routes

```typescript
// In API routes that return cacheable data
return NextResponse.json(data, {
  headers: {
    'Cache-Control': 'private, max-age=180, stale-while-revalidate=300',
  },
})
```

---

## Phase 5: Loading State Improvements

### 5.1 Add loading.tsx to All Main Pages

```
src/app/
├── loading.tsx           # Home page skeleton
├── feed/
│   └── loading.tsx       # Feed skeleton
├── handleliste/
│   └── loading.tsx       # Shopping skeleton
├── uke/
│   └── loading.tsx       # Week planner skeleton
└── oppskrifter/
    └── loading.tsx       # Recipes skeleton
```

### 5.2 Create Page-Specific Skeletons

```typescript
// src/components/Skeleton.tsx - add new skeletons
export function FeedSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Filter tabs skeleton */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-8 w-20 bg-gray-200 rounded-full" />
        ))}
      </div>

      {/* Message cards skeleton */}
      {[1, 2, 3].map(i => (
        <div key={i} className="p-4 rounded-xl bg-gray-100">
          <div className="h-4 w-3/4 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-1/2 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  )
}

export function ShoppingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* List header skeleton */}
      <div className="h-8 w-48 bg-gray-200 rounded" />

      {/* Items skeleton */}
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center gap-3 p-3">
          <div className="h-5 w-5 bg-gray-200 rounded" />
          <div className="h-4 flex-1 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  )
}
```

---

## Phase 6: Code Splitting for Heavy Components

### 6.1 Dynamic Import Heavy Components

```typescript
// src/app/feed/page.tsx
import dynamic from 'next/dynamic'

const PhotoLightbox = dynamic(
  () => import('@/components/PhotoLightbox').then(mod => mod.PhotoLightbox),
  { ssr: false }
)

const DuplicateSuggestions = dynamic(
  () => import('@/components/feed/DuplicateSuggestions'),
  { ssr: false, loading: () => null }
)
```

```typescript
// src/app/handleliste/page.tsx
const DuplicateDetection = dynamic(
  () => import('@/components/shopping/DuplicateDetection'),
  { ssr: false }
)

const ShoppingAI = dynamic(
  () => import('@/components/shopping/ShoppingAI'),
  { ssr: false }
)
```

---

## Implementation Order

### Sprint 1: PPR Foundation (Most Impact)
1. Enable PPR in next.config.ts
2. Create server-side data fetchers
3. Restructure home page with Suspense boundaries
4. Add loading.tsx for home page
5. Test and verify demo mode still works

### Sprint 2: Enhanced Prefetching
1. Create prefetch functions for feed, shopping, recipes
2. Extend TransitionLink with data prefetching
3. Update hooks to check cache first
4. Add usePrefetchRoutes to home page

### Sprint 3: Freshness Indicators
1. Add LastUpdated component
2. Create useRealtimeToday hook (immediate subscription)
3. Add i18n strings for relative time
4. Integrate into home page

### Sprint 4: Service Worker Enhancement
1. Add API response caching to sw.js
2. Add cache headers to relevant API routes
3. Test offline behavior
4. Add cache status indicator (optional)

### Sprint 5: Loading States + Code Splitting
1. Add loading.tsx to all main pages
2. Create page-specific skeleton components
3. Dynamic import heavy components
4. Test bundle size improvements

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Home page LCP (repeat visit) | ~2-3s | <500ms |
| Navigation to /feed | ~1.5s | <300ms |
| Navigation to /handleliste | ~1s | <300ms |
| Time to interactive (cold start) | ~3s | <1.5s |
| Offline support | Partial | Full (cached data) |

---

## Risks & Mitigations

1. **PPR complexity**: Start with home page only, expand after validation
2. **Demo mode regression**: Keep separate client component for demo
3. **Realtime subscription cost**: Only subscribe to today's data immediately
4. **Cache staleness**: Show "last updated" indicator to set expectations
5. **Service worker debugging**: Thorough testing in incognito mode

---

## Files to Create/Modify

### New Files
- `src/lib/data/server.ts`
- `src/lib/data/fetchTodayData.ts`
- `src/lib/data/fetchWeekData.ts`
- `src/lib/prefetch/pages.ts`
- `src/components/home/HomeShell.tsx`
- `src/components/home/TodayData.tsx`
- `src/components/home/WeekPreview.tsx`
- `src/components/home/HomeClientInteractions.tsx`
- `src/components/LastUpdated.tsx`
- `src/hooks/useRealtimeToday.ts`
- `src/app/loading.tsx`
- `src/app/feed/loading.tsx`
- `src/app/handleliste/loading.tsx`
- `src/app/uke/loading.tsx`
- `src/app/oppskrifter/loading.tsx`

### Modified Files
- `next.config.ts` (enable PPR)
- `src/app/page.tsx` (restructure for PPR)
- `src/components/TransitionLink.tsx` (add data prefetching)
- `src/components/Skeleton.tsx` (add new skeletons)
- `public/sw.js` (add API caching)
- `src/lib/i18n/translations/*.ts` (add relative time strings)
