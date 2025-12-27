# Demo Mode Implementation Plan

## Overview

Demo mode enables two critical capabilities:
1. **User Onboarding**: Let potential users explore the full app before signing up
2. **AI Visual Validation**: Ensure every push to main delivers great UX through Playwright + AI testing

### Design Principles

- **Same components, different data source** - No duplicate pages
- **Full interactivity** - Users can drag pickups, add meals, etc. (changes persist in session)
- **Real AI features** - Uses production AI with demo-specific rate limits
- **TypeScript safety** - Schema changes break demo compilation → forces updates

---

## Architecture

### URL-Based Detection

```
Production:  https://familjen.eu/uke
Demo:        https://familjen.eu/uke?demo=true

Entry:       https://familjen.eu/demo → redirects to /?demo=true
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         URL: /?demo=true                            │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DemoDataProvider (context)                        │
│  - Detects ?demo=true from searchParams                             │
│  - Generates initial demo data using TypeScript types               │
│  - Persists mutations to sessionStorage                             │
│  - Disables realtime subscriptions                                  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        useDataSource() Hook                          │
│  Returns { isDemo, supabase?, demoState?, mutate }                  │
│                                                                      │
│  Production: { isDemo: false, supabase: client }                    │
│  Demo:       { isDemo: true, demoState: state, mutate: fn }         │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Data Abstraction Hooks                            │
│  useHousehold(), useChildren(), useMembers(), usePickups()          │
│  useMeals(), useTasks(), useRecipes(), useShoppingLists()           │
│  useFeed(), useWishlists(), useAdmin()                              │
│                                                                      │
│  Each returns same shape regardless of data source                  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Page Components (unchanged)                       │
│  Import hooks instead of creating Supabase client                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/
├── lib/
│   └── demo/
│       ├── context.tsx           # DemoDataProvider, useDataSource()
│       ├── types.ts              # DemoState interface
│       ├── generator.ts          # Initial demo data generation
│       ├── storage.ts            # sessionStorage persistence
│       ├── rate-limiter.ts       # Demo-specific AI rate limits
│       └── images.ts             # Image path constants
│
├── hooks/
│   └── data/
│       ├── useHousehold.ts       # Abstracts household data
│       ├── useChildren.ts        # Abstracts children data
│       ├── useMembers.ts         # Abstracts members data
│       ├── usePickups.ts         # Abstracts pickups with mutations
│       ├── useMeals.ts           # Abstracts meals with mutations
│       ├── useTasks.ts           # Abstracts child tasks
│       ├── useRecipes.ts         # Abstracts recipes
│       ├── useShoppingLists.ts   # Abstracts shopping lists
│       ├── useFeed.ts            # Abstracts feed (messages, photos)
│       ├── useWishlists.ts       # Abstracts wishlists
│       ├── useAdmin.ts           # Abstracts admin data (fake households)
│       └── index.ts              # Re-exports all hooks
│
├── components/
│   └── demo/
│       ├── DemoBanner.tsx        # Fixed top banner
│       └── DemoEntryPage.tsx     # /demo landing (optional)
│
├── app/
│   └── demo/
│       └── page.tsx              # Redirects to /?demo=true

public/
└── demo/
    ├── children/                 # AI-generated child portraits
    │   ├── emilie.jpg
    │   ├── oliver.jpg
    │   └── sofie.jpg
    ├── feed/                     # AI-generated activity photos
    │   ├── barnehage-tur.jpg
    │   ├── barnehage-kunst.jpg
    │   ├── fotball-trening.jpg
    │   └── ...
    └── meals/                    # AI-generated meal photos
        ├── taco.jpg
        ├── fiskegrateng.jpg
        └── ...

scripts/
└── generate-demo-images.ts       # AI image generation (runs in CI)
```

---

## Demo Family: "Familien Hansen"

### Household
```typescript
const demoHousehold: Household = {
  id: 'demo-household-001',
  name: 'Familien Hansen',
  ai_meal_context: 'Vi liker enkel hverdagsmat. Unngå skalldyr (allergi).',
  share_names_with_ai: true,
  external_integrations_enabled: true,
  created_at: '2024-01-15T10:00:00Z',
}
```

### Members (2 parents)
| Name | Short | Role | Work Email | Allergies |
|------|-------|------|------------|-----------|
| Erik Hansen | Erik | Far, Admin | erik@techcorp.no | — |
| Marte Hansen | Marte | Mor | marte@hospital.no | — |

### Children (3 kids)
| Name | Age | Color | Location | Allergies |
|------|-----|-------|----------|-----------|
| Emilie | 8 | coral | Steinerskolen | — |
| Oliver | 5 | sky | Trollskogen Barnehage | Skalldyr |
| Sofie | 3 | sage | Trollskogen Barnehage | — |

---

## Demo Scenarios

### Current Week (dynamic based on actual date)

The generator creates data relative to `new Date()`:

```typescript
function generateWeekPickups(weekStart: Date): Pickup[] {
  // Monday: Marte picks Emilie, Erik picks Oliver+Sofie
  // Tuesday: Erik picks Emilie, Marte picks Oliver+Sofie
  // ... pattern continues
}
```

### Sample Week Pattern
| Day | Emilie | Oliver | Sofie | Meal | Events |
|-----|--------|--------|-------|------|--------|
| Mon | Marte 15:30 | Erik 16:00 | Erik 16:00 | Kyllingwok | |
| Tue | Erik 16:00 | Marte 15:00 | Marte 15:00 | Fiskegrateng | Oliver: Fotball 17:00 |
| Wed | Marte 14:00 | Erik 16:30 | Erik 16:30 | Pasta Bolognese | Oliver: Tannlege 10:00 |
| Thu | Erik 15:30 | Marte 15:00 | Marte 15:00 | Restedag | Marte jobber sent |
| Fri | Marte 14:00 | Erik 15:00 | Erik 15:00 | Taco! | |

### Member Events
- Erik: "Jobbreise til Oslo" (next Tue-Wed)
- Marte: "Jobbe sent" (Thursday)
- Erik: "Middag med kollegaer" (next Friday)

### Child Tasks
| Child | Task | Type | Day |
|-------|------|------|-----|
| Emilie | Ta med gymtøy | bring | Monday |
| Emilie | Utviklingssamtale | appointment | Friday 14:00 |
| Oliver | Tannlegetime | appointment | Wednesday 10:00 |
| Oliver | Ta med regntøy | bring | Thursday |
| Sofie | Samtykkeskjema leveres | reminder | Tuesday |

### Integration Messages (Feed)

**Spond - Emilies Fotball:**
```typescript
{
  sender_name: 'Trener Kari',
  title: 'Trening tirsdag',
  body: 'Husk å ta med drikke og gode sko!',
  source_type: 'message',
}
```

**MyKid - Trollskogen Barnehage:**
```typescript
{
  sender_name: 'Pedagogisk leder',
  title: 'Ukebrev uke 52',
  body: 'I dag har vi vært på tur i skogen og funnet høstblader 🍂',
  source_type: 'newsletter',
}
```

**iSkole - Steinerskolen:**
```typescript
{
  sender_name: 'Klasselærer',
  title: 'Foreldremøte',
  body: 'Påminnelse: Foreldremøte torsdag kl 18:00 i klasserommet',
  source_type: 'message',
}
```

### Shopping Lists
```typescript
const demoShoppingLists: ShoppingList[] = [
  {
    id: 'demo-list-groceries',
    name: 'Dagligvarer',
    items: [
      { name: 'Melk', quantity: '2L', category: 'dairy' },
      { name: 'Brød', quantity: '1', category: 'bakery' },
      { name: 'Bananer', quantity: '1 kg', category: 'produce' },
      { name: 'Kyllingfilet', quantity: '500g', category: 'meat' },
    ]
  }
]
```

### Recipes
```typescript
const demoRecipes: Recipe[] = [
  { name: 'Taco', is_quick: true, is_kid_friendly: true, is_favorite: true },
  { name: 'Fiskegrateng', is_quick: false, is_kid_friendly: true },
  { name: 'Pasta Bolognese', is_quick: true, is_kid_friendly: true },
  { name: 'Kyllingwok', is_quick: true, is_kid_friendly: false },
  // ...
]
```

### Wishlists
| Person | Occasion | Items |
|--------|----------|-------|
| Emilie | Bursdag | Lego Friends, Boksett Harry Potter |
| Oliver | Jul | Paw Patrol figurer, Fotball |
| Sofie | Bursdag | Duplo, Kosedyr |
| Erik | Jul | Støyreduserende hodetelefoner |
| Marte | Jul | Spa-gavekort, Bok |

---

## Demo State Management

### sessionStorage Schema

```typescript
interface DemoState {
  // Core data (generated once, mutated in session)
  household: Household
  members: HouseholdMember[]
  children: Child[]

  // Week data (regenerated on week change)
  pickups: Pickup[]
  meals: MealWithRecipe[]
  childTasks: ChildTask[]
  memberEvents: MemberEvent[]
  householdEvents: HouseholdEvent[]
  externalEvents: ExternalEvent[]

  // Other data
  recipes: Recipe[]
  shoppingLists: ShoppingListWithItems[]
  wishlists: WishlistItem[]
  feedMessages: ExternalMessage[]
  feedPhotos: ExternalPhoto[]

  // Admin data (fake households for admin page)
  adminHouseholds: Household[]
  adminAllowedEmails: AllowedEmail[]

  // Metadata
  generatedAt: string  // ISO timestamp
  weekOffset: number   // Current week being viewed
}

const STORAGE_KEY = 'familjen-demo-state'
```

### State Persistence

```typescript
// src/lib/demo/storage.ts
export function saveDemoState(state: DemoState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function loadDemoState(): DemoState | null {
  const stored = sessionStorage.getItem(STORAGE_KEY)
  if (!stored) return null

  try {
    const state = JSON.parse(stored) as DemoState
    // Validate state has required fields
    if (!state.household || !state.children) return null
    return state
  } catch {
    return null
  }
}

export function clearDemoState(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}
```

### Mutation Handling

```typescript
// src/lib/demo/context.tsx
function useDemoMutations() {
  const [state, setState] = useState<DemoState>(initialState)

  const updatePickup = useCallback((childId: string, date: string, pickerId: string | null) => {
    setState(prev => {
      const existingIdx = prev.pickups.findIndex(p =>
        p.child_id === childId && p.date === date
      )

      let newPickups: Pickup[]
      if (existingIdx >= 0) {
        if (pickerId) {
          // Update existing
          newPickups = prev.pickups.map((p, i) =>
            i === existingIdx ? { ...p, picker_id: pickerId } : p
          )
        } else {
          // Delete
          newPickups = prev.pickups.filter((_, i) => i !== existingIdx)
        }
      } else if (pickerId) {
        // Insert new
        newPickups = [...prev.pickups, createDemoPickup(childId, date, pickerId)]
      } else {
        newPickups = prev.pickups
      }

      const newState = { ...prev, pickups: newPickups }
      saveDemoState(newState)
      return newState
    })
  }, [])

  // Similar for updateMeal, addTask, toggleTask, etc.

  return { updatePickup, updateMeal, addTask, /* ... */ }
}
```

---

## Demo Banner Component

```typescript
// src/components/demo/DemoBanner.tsx
'use client'

import { useRouter } from 'next/navigation'
import { clearDemoState } from '@/lib/demo/storage'
import { useLanguage } from '@/lib/i18n/context'

export function DemoBanner() {
  const router = useRouter()
  const { t } = useLanguage()

  const handleExit = () => {
    clearDemoState()
    router.push('/login')
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-2"
      style={{
        background: 'linear-gradient(135deg, var(--color-honey) 0%, #D4A84B 100%)',
        color: 'white',
      }}
    >
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span className="text-sm font-medium">
          {t.demo?.banner || 'Dette er en demo med eksempeldata'}
        </span>
      </div>
      <button
        onClick={handleExit}
        className="text-sm font-medium underline hover:no-underline"
      >
        {t.demo?.exit || 'Avslutt demo'}
      </button>
    </div>
  )
}
```

### Header Update

The main header should show "Familjen Demo" instead of "Familjen" when in demo mode:

```typescript
// In src/components/Header.tsx
const { isDemo } = useDataSource()

<span className="font-display font-semibold">
  Familjen{isDemo && ' Demo'}
</span>
```

---

## AI Rate Limiting for Demo

### Global Demo Limits

```typescript
// src/lib/demo/rate-limiter.ts
interface DemoRateLimits {
  maxTokensPerHour: number      // Total tokens across all demo users
  maxRequestsPerHour: number    // Total requests
  maxCostPerHour: number        // Max USD cost per hour
  cooldownMinutes: number       // Cooldown when limit hit
}

const DEMO_LIMITS: DemoRateLimits = {
  maxTokensPerHour: 100_000,    // ~$0.01/hour at gemini-flash rates
  maxRequestsPerHour: 50,       // Plenty for testing
  maxCostPerHour: 0.10,         // $0.10/hour max
  cooldownMinutes: 5,
}

// Track in Redis/KV store for global limits
interface DemoUsage {
  tokensUsed: number
  requestCount: number
  costUsd: number
  windowStart: string  // ISO timestamp
}
```

### API Route Integration

```typescript
// In src/app/api/openrouter/suggest/route.ts
import { checkDemoRateLimit, recordDemoUsage } from '@/lib/demo/rate-limiter'

export async function POST(request: Request) {
  const isDemo = request.headers.get('x-demo-mode') === 'true'

  if (isDemo) {
    const { allowed, reason } = await checkDemoRateLimit()
    if (!allowed) {
      return NextResponse.json(
        { error: reason },
        { status: 429 }
      )
    }
  }

  // ... make OpenRouter request ...

  if (isDemo) {
    await recordDemoUsage({
      tokens: response.usage.total_tokens,
      cost: response.usage.cost,
    })
  }
}
```

### Default AI Model

Update OpenRouter config to default to cost-effective model:

```typescript
// src/lib/openrouter.ts
export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'

export async function getAIModel(supabase: SupabaseClient | null): Promise<string> {
  if (!supabase) return DEFAULT_MODEL  // Demo mode

  // Check admin-configured model
  const { data } = await supabase
    .from('app_settings')
    .select('ai_model')
    .single()

  return data?.ai_model || DEFAULT_MODEL
}
```

---

## AI Image Generation

Images are generated during PR to main, making each demo slightly unique.

### Generation Script

```typescript
// scripts/generate-demo-images.ts
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'

const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.0-flash-001'

interface ImageSpec {
  name: string
  prompt: string
  category: 'children' | 'feed' | 'meals'
}

const IMAGES: ImageSpec[] = [
  // Children portraits (illustrated style, privacy-safe)
  {
    name: 'emilie',
    category: 'children',
    prompt: 'Illustrated portrait of a cheerful 8-year-old Norwegian girl with blonde braids, friendly smile, soft watercolor style, warm colors, suitable for family app avatar',
  },
  {
    name: 'oliver',
    category: 'children',
    prompt: 'Illustrated portrait of a happy 5-year-old Norwegian boy with short brown hair, bright eyes, soft watercolor style, playful expression, family app avatar',
  },
  {
    name: 'sofie',
    category: 'children',
    prompt: 'Illustrated portrait of a sweet 3-year-old Norwegian girl with curly light hair, gentle smile, soft watercolor style, warm tones, family app avatar',
  },

  // Feed photos (activity scenes)
  {
    name: 'barnehage-tur',
    category: 'feed',
    prompt: 'Children on a nature walk in Norwegian forest, autumn leaves, kindergarten outdoor activity, warm natural lighting, no faces visible, cozy Scandinavian aesthetic',
  },
  {
    name: 'barnehage-kunst',
    category: 'feed',
    prompt: 'Colorful children art and craft activity, painted handprints, kindergarten art table, bright cheerful colors, Scandinavian style',
  },
  {
    name: 'fotball-trening',
    category: 'feed',
    prompt: 'Youth soccer practice on Norwegian grass field, children in sports clothes, action shot from behind, evening light, community sports feel',
  },

  // Meal photos
  {
    name: 'taco',
    category: 'meals',
    prompt: 'Norwegian-style taco Friday dinner, colorful toppings, family dinner table, warm lighting, appetizing food photography',
  },
  {
    name: 'fiskegrateng',
    category: 'meals',
    prompt: 'Traditional Norwegian fish gratin (fiskegrateng) in baking dish, golden brown top, home-cooked comfort food style',
  },
  {
    name: 'pasta',
    category: 'meals',
    prompt: 'Homemade pasta bolognese on white plate, fresh herbs, family dinner, warm inviting food photography',
  },
]

async function generateImages() {
  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
  })

  for (const spec of IMAGES) {
    console.log(`Generating ${spec.category}/${spec.name}...`)

    const response = await openai.images.generate({
      model: 'stabilityai/stable-diffusion-xl-base-1.0',
      prompt: spec.prompt,
      n: 1,
      size: '512x512',
    })

    const imageUrl = response.data[0].url
    if (!imageUrl) continue

    // Download and save
    const imageResponse = await fetch(imageUrl)
    const buffer = Buffer.from(await imageResponse.arrayBuffer())

    const dir = path.join('public', 'demo', spec.category)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${spec.name}.jpg`), buffer)

    console.log(`  ✓ Saved ${spec.category}/${spec.name}.jpg`)

    // Rate limit protection
    await new Promise(r => setTimeout(r, 2000))
  }
}

generateImages().catch(console.error)
```

### CI Integration

```yaml
# .github/workflows/demo-images.yml
name: Generate Demo Images

on:
  push:
    branches: [main]
    paths:
      - 'scripts/generate-demo-images.ts'
      - '.github/workflows/demo-images.yml'

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Generate images
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        run: npx tsx scripts/generate-demo-images.ts

      - name: Commit images
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add public/demo/
          git commit -m "chore: regenerate demo images" || exit 0
          git push
```

---

## Admin Page Demo Data

For Playwright testing, the admin page shows realistic fake data:

```typescript
// In src/lib/demo/generator.ts

export function generateAdminData(): AdminDemoData {
  return {
    households: [
      {
        id: 'demo-household-001',
        name: 'Familien Hansen',
        members: [{ name: 'Erik Hansen' }, { name: 'Marte Hansen' }],
        children: [{ name: 'Emilie' }, { name: 'Oliver' }, { name: 'Sofie' }],
        created_at: '2024-01-15',
      },
      {
        id: 'demo-household-002',
        name: 'Familien Olsen',
        members: [{ name: 'Lars Olsen' }, { name: 'Ingrid Olsen' }],
        children: [{ name: 'Emma' }, { name: 'Noah' }],
        created_at: '2024-03-22',
      },
      {
        id: 'demo-household-003',
        name: 'Familien Berg',
        members: [{ name: 'Thomas Berg' }],
        children: [{ name: 'Maja' }],
        created_at: '2024-06-10',
      },
    ],

    allowedEmails: [
      { email: 'erik@example.com', is_admin: true, can_create_household: true },
      { email: 'marte@example.com', is_admin: false, can_create_household: false },
      { email: 'lars@example.com', is_admin: false, can_create_household: true },
      { email: 'ingrid@example.com', is_admin: false, can_create_household: false },
      { email: 'thomas@example.com', is_admin: false, can_create_household: true },
    ],

    aiSettings: {
      model: 'google/gemini-2.5-flash-lite',
      usageThisMonth: {
        requests: 1247,
        tokens: 523_000,
        costUsd: 0.52,
      },
    },

    auditLog: [
      { action: 'household.created', actor: 'thomas@example.com', timestamp: '2024-06-10T14:30:00Z' },
      { action: 'member.invited', actor: 'erik@example.com', timestamp: '2024-06-09T10:15:00Z' },
      // ...
    ],
  }
}
```

---

## Data Hooks Implementation

### Example: usePickups

```typescript
// src/hooks/data/usePickups.ts
'use client'

import { useCallback } from 'react'
import { useDataSource } from '@/lib/demo/context'
import type { Pickup, PickupWithDetails } from '@/lib/types'

interface UsePickupsOptions {
  weekStart: Date
  weekEnd: Date
}

interface UsePickupsReturn {
  pickups: PickupWithDetails[]
  loading: boolean
  error: string | null
  updatePickup: (childId: string, date: string, pickerId: string | null) => Promise<void>
  refetch: () => void
}

export function usePickups({ weekStart, weekEnd }: UsePickupsOptions): UsePickupsReturn {
  const { isDemo, supabase, demoState, demoMutations } = useDataSource()

  if (isDemo) {
    // Demo mode: return from local state
    const pickups = demoState.pickups.filter(p => {
      const date = p.date
      return date >= formatDateISO(weekStart) && date <= formatDateISO(weekEnd)
    })

    // Hydrate with child/picker details from demo state
    const pickupsWithDetails = pickups.map(p => ({
      ...p,
      child: demoState.children.find(c => c.id === p.child_id)!,
      picker: demoState.members.find(m => m.id === p.picker_id) || null,
    }))

    return {
      pickups: pickupsWithDetails,
      loading: false,
      error: null,
      updatePickup: async (childId, date, pickerId) => {
        demoMutations.updatePickup(childId, date, pickerId)
      },
      refetch: () => {}, // No-op in demo
    }
  }

  // Production mode: use Supabase
  // ... existing SWR/useEffect logic ...
}
```

### Hook Migration Matrix

| Hook | Data Types | Read | Write | Realtime |
|------|-----------|------|-------|----------|
| `useHousehold` | Household | ✓ | ✓ | — |
| `useChildren` | Child[] | ✓ | ✓ | — |
| `useMembers` | HouseholdMember[] | ✓ | ✓ | — |
| `usePickups` | PickupWithDetails[] | ✓ | ✓ | Demo: off |
| `useMeals` | MealWithRecipe[] | ✓ | ✓ | Demo: off |
| `useTasks` | ChildTask[] | ✓ | ✓ | Demo: off |
| `useRecipes` | Recipe[] | ✓ | ✓ | — |
| `useMemberEvents` | MemberEvent[] | ✓ | ✓ | Demo: off |
| `useHouseholdEvents` | HouseholdEvent[] | ✓ | ✓ | Demo: off |
| `useExternalEvents` | ExternalEvent[] | ✓ | ✗ | — |
| `useFeed` | Messages, Photos | ✓ | ✗ | — |
| `useShoppingLists` | Lists, Items | ✓ | ✓ | Demo: off |
| `useWishlists` | WishlistItem[] | ✓ | ✓ | — |
| `useAdmin` | Households, Emails | ✓ | ✓ | — |

---

## Playwright E2E Integration

### Test Structure

```typescript
// tests/e2e/demo.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Demo Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing demo state
    await page.goto('/')
    await page.evaluate(() => sessionStorage.clear())
  })

  test('home page shows demo family', async ({ page }) => {
    await page.goto('/?demo=true')

    // Demo banner visible
    await expect(page.locator('text=Dette er en demo')).toBeVisible()

    // Family data visible
    await expect(page.locator('text=Emilie')).toBeVisible()
    await expect(page.locator('text=Oliver')).toBeVisible()
    await expect(page.locator('text=Sofie')).toBeVisible()
  })

  test('can navigate week planner and modify pickups', async ({ page }) => {
    await page.goto('/uke?demo=true')

    // Week grid visible
    await expect(page.locator('[data-testid="week-grid"]')).toBeVisible()

    // Click on a pickup cell and change picker
    await page.locator('[data-testid="pickup-emilie-mon"]').click()
    await page.locator('text=Erik').click()

    // Verify change persisted
    await expect(page.locator('[data-testid="pickup-emilie-mon"]')).toContainText('Erik')

    // Navigate away and back
    await page.goto('/?demo=true')
    await page.goto('/uke?demo=true')

    // Change should persist (sessionStorage)
    await expect(page.locator('[data-testid="pickup-emilie-mon"]')).toContainText('Erik')
  })

  test('feed shows integration messages', async ({ page }) => {
    await page.goto('/feed?demo=true')

    await expect(page.locator('text=Trollskogen Barnehage')).toBeVisible()
    await expect(page.locator('text=Emilies Fotball')).toBeVisible()
    await expect(page.locator('text=Steinerskolen')).toBeVisible()
  })

  test('AI meal suggestions work', async ({ page }) => {
    await page.goto('/uke?demo=true')

    // Click AI suggestion button
    await page.locator('text=Få AI-forslag').click()

    // Wait for suggestions (real AI call)
    await expect(page.locator('[data-testid="ai-suggestion-modal"]')).toBeVisible()
    await expect(page.locator('[data-testid="ai-suggestion-0"]')).toBeVisible({ timeout: 15000 })
  })

  test('admin page shows fake households', async ({ page }) => {
    await page.goto('/admin?demo=true')

    await expect(page.locator('text=Familien Hansen')).toBeVisible()
    await expect(page.locator('text=Familien Olsen')).toBeVisible()
    await expect(page.locator('text=Familien Berg')).toBeVisible()
  })

  test('exit demo clears state', async ({ page }) => {
    await page.goto('/?demo=true')

    // Make a change
    await page.goto('/uke?demo=true')
    await page.locator('[data-testid="pickup-emilie-mon"]').click()
    await page.locator('text=Erik').click()

    // Exit demo
    await page.locator('text=Avslutt demo').click()

    // Should be on login page
    await expect(page).toHaveURL('/login')

    // Re-enter demo - should have fresh data
    await page.goto('/?demo=true')
    await page.goto('/uke?demo=true')

    // Change should NOT persist (state was cleared)
    // (verification depends on initial state)
  })
})
```

### Visual Validation Tests

```typescript
// tests/e2e/demo-visual.spec.ts
import { test, expect } from '@playwright/test'

const DEMO_PAGES = [
  { path: '/?demo=true', name: 'home' },
  { path: '/uke?demo=true', name: 'week' },
  { path: '/feed?demo=true', name: 'feed' },
  { path: '/innstillinger?demo=true', name: 'settings' },
  { path: '/handleliste?demo=true', name: 'shopping' },
  { path: '/oppskrifter?demo=true', name: 'recipes' },
  { path: '/admin?demo=true', name: 'admin' },
]

test.describe('Demo Visual Validation', () => {
  for (const page of DEMO_PAGES) {
    test(`${page.name} page renders correctly`, async ({ page: p }) => {
      await p.goto(page.path)

      // Wait for content to load
      await p.waitForLoadState('networkidle')

      // Take screenshot for AI validation
      await p.screenshot({
        path: `tests/visual/screenshots/demo-${page.name}.png`,
        fullPage: true,
      })
    })
  }
})
```

---

## Implementation Phases

### Phase 1: Foundation (Core Infrastructure)

**Goal**: Demo mode works for home page with generated data

- [ ] Create `src/lib/demo/context.tsx` with DemoDataProvider
- [ ] Create `src/lib/demo/types.ts` with DemoState interface
- [ ] Create `src/lib/demo/generator.ts` with demo family data
- [ ] Create `src/lib/demo/storage.ts` for sessionStorage
- [ ] Create `src/components/demo/DemoBanner.tsx`
- [ ] Create `src/app/demo/page.tsx` (redirect to `/?demo=true`)
- [ ] Update `src/components/Header.tsx` to show "Familjen Demo"
- [ ] Add `demo.banner`, `demo.exit` to i18n translations

### Phase 2: Data Hooks Layer

**Goal**: Abstract data fetching for all pages

- [ ] Create `src/hooks/data/useDataSource.ts` (re-export from context)
- [ ] Create `src/hooks/data/useHousehold.ts`
- [ ] Create `src/hooks/data/useChildren.ts`
- [ ] Create `src/hooks/data/useMembers.ts`
- [ ] Create `src/hooks/data/usePickups.ts` with mutations
- [ ] Create `src/hooks/data/useMeals.ts` with mutations
- [ ] Create `src/hooks/data/useTasks.ts` with mutations
- [ ] Create `src/hooks/data/useMemberEvents.ts` with mutations
- [ ] Create `src/hooks/data/useHouseholdEvents.ts` with mutations
- [ ] Create `src/hooks/data/useRecipes.ts` with mutations
- [ ] Create `src/hooks/data/useShoppingLists.ts` with mutations
- [ ] Create `src/hooks/data/useFeed.ts` (read-only)
- [ ] Create `src/hooks/data/useWishlists.ts` with mutations
- [ ] Create `src/hooks/data/useAdmin.ts`
- [ ] Create `src/hooks/data/index.ts` barrel export

### Phase 3: Page Migration

**Goal**: All pages use data hooks instead of direct Supabase

- [ ] Migrate `/` (home) page to use hooks
- [ ] Migrate `/uke` (week) page to use hooks
- [ ] Migrate `/feed` page to use hooks
- [ ] Migrate `/innstillinger` (settings) page to use hooks
- [ ] Migrate `/handleliste` (shopping) page to use hooks
- [ ] Migrate `/oppskrifter` (recipes) page to use hooks
- [ ] Migrate `/admin` page to use hooks

### Phase 4: AI Features

**Goal**: AI works in demo with rate limiting

- [ ] Create `src/lib/demo/rate-limiter.ts`
- [ ] Update OpenRouter API routes to check demo mode
- [ ] Set default model to `google/gemini-2.5-flash-lite`
- [ ] Add demo header (`x-demo-mode: true`) to fetch calls
- [ ] Implement global demo rate limits (tokens/cost per hour)

### Phase 5: Demo Data Polish

**Goal**: Comprehensive demo scenarios

- [ ] Expand demo family data with full week scenarios
- [ ] Add demo integration messages (Spond, MyKid, iSkole)
- [ ] Add demo external events
- [ ] Add demo shopping lists with categories
- [ ] Add demo wishlists with items
- [ ] Add demo recipes library
- [ ] Generate fake admin data (households, emails, audit log)

### Phase 6: Images

**Goal**: AI-generated images for demo

- [ ] Create `scripts/generate-demo-images.ts`
- [ ] Define image prompts for children, feed, meals
- [ ] Create `.github/workflows/demo-images.yml`
- [ ] Add placeholder images for initial development
- [ ] Update image references in demo generator

### Phase 7: E2E Testing

**Goal**: Full test coverage using demo mode

- [ ] Create `tests/e2e/demo.spec.ts` with navigation tests
- [ ] Create `tests/e2e/demo-interactions.spec.ts` for mutations
- [ ] Create `tests/e2e/demo-visual.spec.ts` for screenshots
- [ ] Update CI to run demo tests on PRs
- [ ] Update visual validation to use demo pages

### Phase 8: Polish & Documentation

**Goal**: Production-ready demo mode

- [ ] Add "Prøv demo" link on login page
- [ ] Test demo on mobile (responsive banner)
- [ ] Test demo across all languages (nb, sv, en)
- [ ] Performance optimization (lazy load demo data)
- [ ] Update CLAUDE.md with demo mode documentation
- [ ] Remove this plan file (DEMO_MODE_PLAN.md)

---

## Success Criteria

- [ ] `/?demo=true` loads instantly without auth
- [ ] All pages work with demo data (no errors)
- [ ] Mutations persist across page navigation (sessionStorage)
- [ ] "Avslutt demo" clears state and redirects to login
- [ ] AI features work with rate limiting
- [ ] TypeScript errors if schema changes (forces generator update)
- [ ] Playwright tests pass using demo mode
- [ ] Visual validation captures all pages correctly
- [ ] Works on Vercel preview with any migration state
- [ ] Clear "Familjen Demo" indicator in header

---

## Security Considerations

- Demo routes are public (no auth required)
- No real user data exposed (all generated)
- AI rate limits prevent abuse
- Demo state isolated in sessionStorage (per-tab)
- No demo mutations touch production database
- Clear visual indicator prevents confusion

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Entry point | `/demo` redirects to `/?demo=true` |
| State persistence | sessionStorage (survives refresh, clears on tab close) |
| Exit mechanism | Clear sessionStorage + redirect to `/login` |
| AI in demo | Real AI with demo-specific rate limits |
| Realtime | Disabled in demo (local state only) |
| Images | AI-generated during PR to main |
| Admin page | Multiple fake households |
| Default AI model | `google/gemini-2.5-flash-lite` everywhere |
