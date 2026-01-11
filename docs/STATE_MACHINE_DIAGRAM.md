# Familjen State Machine Architecture

This document describes the state machines that power the Familjen family planning app.

## Overview

Familjen uses a **multi-layered state machine architecture** handling:
- Authentication & session management
- Page rendering with caching
- Offline-first data sync
- External integrations
- Navigation transitions

```mermaid
graph TB
    subgraph "User Interaction Layer"
        UI[User Interface]
        NAV[Navigation Context]
        OFFLINE_IND[Offline Indicator]
    end

    subgraph "Auth Layer"
        MW[Middleware]
        SV[Session Validator]
        DEMO[Demo Context]
    end

    subgraph "Data Layer"
        CACHE_LS[localStorage Cache]
        CACHE_IDB[IndexedDB Cache]
        QUEUE[Offline Queue]
        RT[Realtime Subscriptions]
    end

    subgraph "Server Layer"
        SUPABASE[(Supabase)]
        INTEGRATIONS[External Integrations]
    end

    UI --> NAV
    UI --> OFFLINE_IND
    NAV --> MW
    MW --> SV
    MW --> DEMO
    UI --> CACHE_LS
    CACHE_LS --> CACHE_IDB
    UI --> QUEUE
    RT --> CACHE_IDB
    QUEUE --> SUPABASE
    RT --> SUPABASE
    INTEGRATIONS --> SUPABASE
```

---

## 1. Authentication State Machine

The auth system uses a **3-layer validation strategy** for instant page loads.

```mermaid
stateDiagram-v2
    [*] --> CheckCookie: Request arrives

    CheckCookie --> DemoMode: ?demo=true in URL
    CheckCookie --> NoCookie: No auth cookie
    CheckCookie --> HasCookie: Auth cookie exists

    DemoMode --> [*]: Bypass auth

    NoCookie --> Protected: Protected route?
    NoCookie --> Public: Public route?
    Protected --> RedirectLogin: 302 /login
    Public --> [*]: Allow request

    HasCookie --> CacheCheck: Check validation cookie
    CacheCheck --> CacheValid: < 5 min old
    CacheCheck --> CacheExpired: >= 5 min old

    CacheValid --> [*]: Skip Supabase call (instant!)

    CacheExpired --> Validating: Call getUser()
    Validating --> Valid: User returned
    Validating --> Invalid: No user

    Valid --> AdminCheck: /admin route?
    Valid --> [*]: Other routes
    AdminCheck --> IsAdmin: is_admin = true
    AdminCheck --> NotAdmin: is_admin = false
    IsAdmin --> [*]: Allow
    NotAdmin --> RedirectHome: 302 /

    Invalid --> ClearSession: Clear cookies
    ClearSession --> RedirectLogin
```

### Background Session Validator

Runs every 5 minutes to catch stale PWA sessions:

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Validating: 5-min interval
    Idle --> Validating: App becomes visible (if hidden > 1 min)

    Validating --> Valid: User returned
    Validating --> Invalid: No user / error

    Valid --> Idle: Update last validation time

    Invalid --> ClearCache: clearAllCache()
    ClearCache --> ClearQueue: clearAllChanges()
    ClearQueue --> Redirect: Navigate to /login
```

**Files:**
- `src/lib/supabase/middleware.ts`
- `src/hooks/useSessionValidator.ts`

---

## 2. Page Rendering State Machine

Uses **PPR (Partial Pre-Rendering)** with cache fallback for instant loads.

```mermaid
stateDiagram-v2
    [*] --> NavigationStart: Link clicked

    NavigationStart --> LoadingTsx: Next.js shows loading.tsx
    LoadingTsx --> SmartLoading: SmartLoading component

    SmartLoading --> CheckLocalStorage: Read cache (sync)
    CheckLocalStorage --> CacheFresh: Version match + age < 30 min
    CheckLocalStorage --> CacheStale: Version mismatch or age >= 30 min

    CacheFresh --> RenderCached: Show cached content
    CacheStale --> ShowSkeleton: Show skeleton

    RenderCached --> WaitForServer: Meanwhile...
    ShowSkeleton --> WaitForServer: Meanwhile...

    WaitForServer --> ServerFetch: Suspense boundary
    ServerFetch --> DataLoader: Server component
    DataLoader --> RenderFresh: Replace content

    RenderFresh --> SaveCache: DataCacher effect
    SaveCache --> SetupRealtime: Subscribe to changes
    SetupRealtime --> [*]: Page ready
```

### Cache Layers

```mermaid
flowchart TB
    subgraph "Layer 1: Synchronous (0ms)"
        LS[localStorage]
        LS -->|getCachedSync| INSTANT[Instant read]
    end

    subgraph "Layer 2: Async (~5ms)"
        IDB[(IndexedDB)]
        IDB -->|getCached| ASYNC[Async read]
    end

    subgraph "Layer 3: Server (~100-500ms)"
        SERVER[Server cache]
        SERVER -->|unstable_cache| SUPABASE[(Supabase)]
    end

    INSTANT -->|Miss| ASYNC
    ASYNC -->|Miss| SERVER
    SERVER -->|Write back| IDB
    IDB -->|Write back| LS
```

**Files:**
- `src/components/SmartLoading.tsx`
- `src/lib/cache.ts`
- `src/lib/cache-sync.ts`

---

## 3. Navigation State Machine

Delayed loading indicator prevents flash for fast navigations.

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> CheckSamePage: TransitionLink clicked
    CheckSamePage --> Idle: Same page (abort)
    CheckSamePage --> StartTimer: Different page

    StartTimer --> Waiting: Set 150ms timer

    Waiting --> NavigationComplete: pathname changes < 150ms
    Waiting --> ShowLoading: timer fires

    NavigationComplete --> Idle: No loading shown (instant feel!)

    ShowLoading --> Dimmed: Apply opacity 0.7
    Dimmed --> NavigationComplete: pathname changes
    Dimmed --> Timeout: 5s failsafe
    Timeout --> Idle: Clear stuck state
```

**Visual States:**

| State | UI Effect |
|-------|-----------|
| Idle | Normal |
| Waiting | No visual change |
| Dimmed | `opacity: 0.7`, `pointer-events: none` |

**File:** `src/lib/navigation/context.tsx`

---

## 4. Offline Sync State Machine

Queues changes when offline, syncs when online with conflict detection.

```mermaid
stateDiagram-v2
    [*] --> CheckOnline: User makes change

    CheckOnline --> DirectSync: navigator.onLine = true
    CheckOnline --> QueueChange: navigator.onLine = false

    DirectSync --> Success: Supabase responds OK
    DirectSync --> Error: Supabase error
    Success --> [*]
    Error --> ShowError: Toast message

    QueueChange --> GenerateTempId: For inserts
    QueueChange --> AddToQueue: queueChange()
    GenerateTempId --> AddToQueue
    AddToQueue --> OptimisticUpdate: Update UI
    OptimisticUpdate --> [*]: Show pending indicator

    state BackgroundSync {
        [*] --> WaitForOnline

        WaitForOnline --> ProcessQueue: 'online' event
        WaitForOnline --> ProcessQueue: visibility change (if online)

        ProcessQueue --> GetChanges: getQueuedChanges()
        GetChanges --> ProcessNext: For each change

        ProcessNext --> CheckConflict: Update operation
        ProcessNext --> ApplyChange: Insert/Delete

        CheckConflict --> ConflictDetected: server.updated_at > local
        CheckConflict --> ApplyChange: No conflict

        ConflictDetected --> EmitConflict: Emit SYNC_CONFLICT
        EmitConflict --> ApplyChange: Last-write-wins

        ApplyChange --> SyncSuccess: Supabase OK
        ApplyChange --> SyncFailure: Supabase error

        SyncSuccess --> RemoveFromQueue: removeChange()
        RemoveFromQueue --> ProcessNext: Next change
        RemoveFromQueue --> Complete: Queue empty

        SyncFailure --> CheckRetries: retries < 3?
        CheckRetries --> IncrementRetry: Yes
        CheckRetries --> DropChange: No (after 3 failures)

        IncrementRetry --> ProcessNext: Try next
        DropChange --> EmitDropped: Emit SYNC_FAILURE (dropped)
        EmitDropped --> ProcessNext: Continue

        Complete --> [*]: Emit SYNC_COMPLETE
    }
```

### Offline Indicator States

```mermaid
stateDiagram-v2
    [*] --> Hidden: navigator.onLine = true

    Hidden --> Offline: 'offline' event
    Offline --> BackOnline: 'online' event

    BackOnline --> Syncing: Has pending changes
    BackOnline --> Hidden: No pending (after 3s)

    Syncing --> Hidden: SYNC_COMPLETE
    Syncing --> Failure: SYNC_FAILURE

    Failure --> Hidden: Auto-hide (8s normal, 15s if dropped)
    Failure --> Hidden: User clicks X

    Hidden --> Conflict: SYNC_CONFLICT
    Conflict --> Hidden: Auto-hide (6s)
```

**Color Coding:**

| State | Color | Priority |
|-------|-------|----------|
| Failure | Coral red | 1 (highest) |
| Conflict | Honey yellow | 2 |
| Offline | Sky blue | 3 |
| Syncing | Honey yellow | 4 |
| Back Online | Sage green | 5 |

**Files:**
- `src/lib/offline-queue.ts`
- `src/hooks/useBackgroundSync.ts`
- `src/components/OfflineIndicator.tsx`

---

## 5. Integration Sync State Machine

Manages connections to external services (Spond, MyKid, Kidplan, iSkole).

```mermaid
stateDiagram-v2
    [*] --> Initial

    Initial --> Loading: loadIntegrations()
    Loading --> Loaded: Fetch complete

    Loaded --> ShowForm: User clicks "Connect"
    ShowForm --> Testing: User submits credentials

    Testing --> TestFailed: API error
    Testing --> TestSuccess: Credentials valid

    TestFailed --> ShowForm: User can retry

    TestSuccess --> SelectGroups: Show available groups
    SelectGroups --> MappingsReady: User maps children

    MappingsReady --> Saving: User clicks Save
    Saving --> Loaded: Refresh list

    Loaded --> Editing: User clicks Edit
    Editing --> LoadGroups: Fetch groups
    LoadGroups --> EditMappings: Show mapper
    EditMappings --> Saving: Save changes

    Loaded --> Syncing: User clicks Sync Now
    Syncing --> Loaded: Sync complete

    Loaded --> Removing: User clicks Remove
    Removing --> Loaded: Integration deleted
```

### Integration Data Flow

```mermaid
flowchart LR
    subgraph "External Services"
        SPOND[Spond API]
        MYKID[MyKid API]
        KIDPLAN[Kidplan API]
        ISKOLE[iSkole API]
    end

    subgraph "Sync Layer"
        CRON[Cron Job]
        MAPPER[Data Mappers]
        DEDUP[AI Deduplication]
    end

    subgraph "Database"
        EXT_EVENTS[(external_events)]
        EXT_MSG[(external_messages)]
        EXT_PHOTOS[(external_photos)]
    end

    subgraph "Client"
        FEED[Feed Page]
        RT[Realtime Subscription]
    end

    SPOND --> CRON
    MYKID --> CRON
    KIDPLAN --> CRON
    ISKOLE --> CRON

    CRON --> MAPPER
    MAPPER --> DEDUP
    DEDUP --> EXT_EVENTS
    DEDUP --> EXT_MSG
    DEDUP --> EXT_PHOTOS

    EXT_EVENTS --> RT
    EXT_MSG --> RT
    EXT_PHOTOS --> RT

    RT --> FEED
```

**Files:**
- `src/components/integrations/shared/useIntegrationState.ts`
- `src/lib/integrations/` (clients for each service)
- `src/app/api/cron/sync-integrations/route.ts`

---

## 6. Demo Mode State Machine

Provides full UI functionality without real API calls.

```mermaid
stateDiagram-v2
    [*] --> CheckURL: App loads

    CheckURL --> ProductionMode: No ?demo=true
    CheckURL --> DemoMode: ?demo=true present

    ProductionMode --> RealData: Fetch from Supabase
    ProductionMode --> RealMutations: Write to Supabase

    DemoMode --> CheckLocalStorage: Load demo state
    CheckLocalStorage --> ExistingDemo: State found
    CheckLocalStorage --> GenerateDemo: No state

    GenerateDemo --> SaveDemo: generateDemoState()
    SaveDemo --> DemoReady: localStorage

    ExistingDemo --> DemoReady: Use existing

    DemoReady --> MockData: Read from context
    DemoReady --> LocalMutations: Update context only

    LocalMutations --> ShowToast: "View only mode"
```

**Key Behavior:**
- Same components for demo and production
- Mutations show info toast instead of API calls
- State persists in localStorage during session
- E2E tests use demo mode

**File:** `src/lib/demo/context.tsx`

---

## 7. Realtime Update State Machine

Handles WebSocket updates from Supabase.

```mermaid
stateDiagram-v2
    [*] --> Subscribe: Component mounts

    Subscribe --> Defer: Wait 500ms (deferMs)
    Defer --> Active: Create channel

    Active --> Listening: Subscribe to table

    state Listening {
        [*] --> Waiting

        Waiting --> HandleEvent: postgres_changes event

        HandleEvent --> Insert: eventType = INSERT
        HandleEvent --> Update: eventType = UPDATE
        HandleEvent --> Delete: eventType = DELETE

        Insert --> UpdateCache: updateCacheWithRealtimeChange()
        Update --> UpdateCache
        Delete --> UpdateCache

        UpdateCache --> RefreshUI: router.refresh()
        RefreshUI --> Waiting
    }

    Listening --> Cleanup: Component unmounts
    Cleanup --> [*]: removeChannel()
```

### Cache Update Flow

```mermaid
flowchart TB
    EVENT[Realtime Event] --> GET[Get cached data]
    GET --> FIND[Find array field]
    FIND --> MODIFY{Event type?}

    MODIFY -->|INSERT| ADD[Add to array]
    MODIFY -->|UPDATE| REPLACE[Replace in array]
    MODIFY -->|DELETE| REMOVE[Remove from array]

    ADD --> SAVE[setCache to IndexedDB]
    REPLACE --> SAVE
    REMOVE --> SAVE

    SAVE --> REFRESH[router.refresh]
```

**File:** `src/lib/cache.ts` (updateCacheWithRealtimeChange)

---

## 8. Session & Cache Coordination

Shows how auth events affect cache state.

```mermaid
sequenceDiagram
    participant U as User
    participant A as Auth
    participant C as Cache
    participant Q as Offline Queue

    Note over U,Q: Login Flow
    U->>A: Login successful
    A->>A: Set JWT with household_id
    A->>C: Cache ready for use

    Note over U,Q: Normal Operation
    U->>C: Read/Write cache
    C->>Q: Queue offline changes
    Q->>Q: Sync when online

    Note over U,Q: Logout Flow
    U->>A: Logout requested
    A->>C: clearAllCache()
    A->>Q: clearAllChanges()
    A->>A: signOut()
    A->>U: Redirect to /login

    Note over U,Q: Session Invalid (Background Check)
    A->>A: getUser() returns null
    A->>C: clearAllCache()
    A->>Q: clearAllChanges()
    A->>U: Redirect to /login
```

---

## 9. State Persistence Summary

| State Machine | Storage | Scope | TTL | Cleared On |
|---------------|---------|-------|-----|------------|
| Auth Session | HTTP cookie | Cross-tab | Session | Logout |
| Validation Cache | HTTP cookie | Cross-tab | 5 min | Expires |
| Page Cache (LS) | localStorage | Tab | 30 min | Logout, version change |
| Page Cache (IDB) | IndexedDB | Tab | 3 min | Logout, version change |
| Offline Queue | IndexedDB | Tab | Until sync | Logout, sync success |
| Demo State | localStorage | Tab | Session | Exit demo |
| Navigation | Memory | Tab | None | Component unmount |

---

## 10. Error Recovery Paths

### Sync Failure Recovery

```mermaid
flowchart TB
    FAIL[Sync fails] --> CHECK{retries < 3?}

    CHECK -->|Yes| INC[Increment retry count]
    INC --> STORE[Keep in queue]
    STORE --> WAIT[Wait for next online event]
    WAIT --> RETRY[Retry sync]

    CHECK -->|No| DROP[Remove from queue]
    DROP --> NOTIFY[Show coral banner]
    NOTIFY --> MANUAL[User must retry manually]
```

### Cache Error Recovery

```mermaid
flowchart TB
    ERROR[IndexedDB error] --> RECOVERABLE{Recoverable?}

    RECOVERABLE -->|Yes| RESET[resetConnection()]
    RESET --> RETRY[Retry once]
    RETRY --> SUCCESS[Continue]
    RETRY --> FAIL[Log warning]

    RECOVERABLE -->|No| FAIL
    FAIL --> SKELETON[Fall back to skeleton]
```

---

## 11. Performance Critical Paths

### Fastest Path: Cached Navigation

```mermaid
flowchart LR
    CLICK[Link click] --> NAV[TransitionLink]
    NAV --> PATH[pathname changes < 150ms]
    PATH --> LS[localStorage read]
    LS --> FRESH[Cache fresh]
    FRESH --> RENDER[Render cached]
    RENDER --> DONE[0ms perceived load]

    style DONE fill:#90EE90
```

### Slowest Path: Cold Start

```mermaid
flowchart LR
    START[PWA cold start] --> LS[localStorage miss]
    LS --> IDB[IndexedDB miss]
    IDB --> SKELETON[Show skeleton]
    SKELETON --> SERVER[Server fetch]
    SERVER --> RENDER[Render fresh]
    RENDER --> CACHE[Write to cache]
    CACHE --> DONE[1-3s total]

    style DONE fill:#FFB6C1
```

---

## 12. Component Dependencies

```mermaid
graph TD
    subgraph "Providers"
        NP[NavigationProvider]
        LP[LanguageProvider]
        DP[DemoDataProvider]
    end

    subgraph "Hooks"
        USS[useSessionValidator]
        UBS[useBackgroundSync]
        URD[useRealtimeData]
        USD[useDataSource]
    end

    subgraph "Components"
        TL[TransitionLink]
        SL[SmartLoading]
        OI[OfflineIndicator]
        DC[DataCacher]
    end

    NP --> TL
    NP --> SL
    LP --> USS
    DP --> USD

    USS --> OI
    UBS --> OI
    URD --> DC

    USD --> DC
```

---

## Quick Reference

| Action | State Machine | Key State Change |
|--------|---------------|------------------|
| Click link | Navigation | Idle → Waiting → (Loading) → Idle |
| Edit offline | Offline Sync | Online → Queued → Syncing → Done |
| Login | Auth | Unauthenticated → Validating → Valid |
| Sync integration | Integration | Loaded → Syncing → Loaded |
| Realtime update | Cache | Fresh → Update → Fresh |
| App goes offline | Offline | Online → Offline |
| Session expires | Auth | Valid → Invalid → Redirect |
