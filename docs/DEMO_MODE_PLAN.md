# Demo Mode Implementation Plan

## Overview

Create a `/demo` route that showcases the app with generated mock data, useful for:
1. **E2E testing** - No auth complexity, works with any migration state
2. **User onboarding** - "See how the app works" before signup
3. **Development** - Work on UI without database dependency

## Architecture: Hybrid Approach

### Pre-generated (commit to repo)
- **Images only** - These don't change with schema
- Child portraits, activity photos, meal photos

### Dynamic (runtime generation)
- **All data** - Uses TypeScript types from codebase
- If types change → TypeScript errors → forces update
- Flexible scenarios for testing any feature

```typescript
// src/lib/demo/generator.ts
import type { Child, Pickup, MemberEvent, ExternalMessage } from '@/lib/types'

// Uses real types - schema changes break compilation
export function generateDemoData(): DemoHousehold {
  return {
    household: generateHousehold(),
    children: generateChildren(),
    pickups: generatePickups(),
    // ... always matches current types
  }
}
```

---

## Demo Family: "Familien Hansen"

### Members (2 parents)
| Name | Role | Short | Work Email |
|------|------|-------|------------|
| Erik Hansen | Far | Erik | erik@techcorp.no |
| Marte Hansen | Mor | Marte | marte@hospital.no |

### Children (3 kids)
| Name | Age | Color | Location |
|------|-----|-------|----------|
| Emilie | 8 år | coral | Steinerskolen |
| Oliver | 5 år | sky | Trollskogen Barnehage |
| Sofie | 3 år | sage | Trollskogen Barnehage |

---

## Pre-generated Images

Store in `public/demo/`:

```
public/demo/
├── children/
│   ├── emilie.jpg      # Girl ~8 years, illustrated style
│   ├── oliver.jpg      # Boy ~5 years, illustrated style
│   └── sofie.jpg       # Girl ~3 years, illustrated style
├── feed/
│   ├── barnehage-tur.jpg    # Kids on nature walk
│   ├── barnehage-kunst.jpg  # Craft activity
│   ├── barnehage-lek.jpg    # Playing outdoors
│   ├── barnehage-samling.jpg # Circle time
│   ├── fotball-trening.jpg  # Soccer practice
│   └── svomming.jpg         # Swimming activity
└── meals/
    ├── taco.jpg
    ├── fiskegrateng.jpg
    └── pasta.jpg
```

**Generation script:** `scripts/generate-demo-images.ts`

---

## Demo Scenarios

### Week Plan (current week)
| Day | Emilie | Oliver | Sofie | Meal | Notes |
|-----|--------|--------|-------|------|-------|
| Mon | Marte 15:30 | Erik 16:00 | Erik 16:00 | Kyllingwok | |
| Tue | Erik 16:00 | Marte 15:00 | Marte 15:00 | Fiskegrateng | |
| Wed | Marte 14:00 | Erik 16:30 | Erik 16:30 | Pasta Bolognese | Oliver: Tannlege 10:00 |
| Thu | Erik 15:30 | Marte 15:00 | Marte 15:00 | Restedag | Marte jobber sent |
| Fri | Marte 14:00 | Erik 15:00 | Erik 15:00 | Taco! | |

### Member Events
| Who | Event | When |
|-----|-------|------|
| Erik | Jobbreise til Oslo | Next Tue-Wed |
| Marte | Jobbe sent | This Thursday |
| Erik | Middag med kollegaer | Next Friday |

### Integration Messages (Feed)

**Spond - Emilies Fotball:**
- "Trening tirsdag kl 17:00 - ta med drikke!"
- "Kamp lørdag avlyst pga værforhold"
- Photo: fotball-trening.jpg

**Spond - Olivers Svømming:**
- "Svømmestevne denne helgen - påmelding åpen"
- Photo: svomming.jpg

**MyKid - Trollskogen Barnehage:**
- "I dag har vi vært på tur i skogen og funnet høstblader 🍂"
- "Ukemeny: Mandag: Fiskeboller, Tirsdag: Pasta..."
- Photos: barnehage-tur.jpg, barnehage-kunst.jpg

**iSkole - Steinerskolen:**
- "Påminnelse: Foreldremøte torsdag kl 18:00 i klasserommet"
- "Utviklingssamtale for Emilie: Book tid via lenken"

**Kidplan - Alternative barnehage:**
- "God helg alle sammen! Neste uke er det høstfest 🎃"

### Child Tasks
| Child | Task | Day | Time |
|-------|------|-----|------|
| Emilie | Ta med gymtøy | Monday | |
| Emilie | Utviklingssamtale | Friday | 14:00 |
| Oliver | Tannlegetime | Wednesday | 10:00 |
| Oliver | Ta med regntøy | Thursday | |
| Sofie | Samtykkeskjema leveres | Tuesday | |

---

## Route Structure

```
src/app/(demo)/
├── layout.tsx              # DemoDataProvider, demo banner
└── demo/
    ├── page.tsx            # Today view
    ├── uke/
    │   └── page.tsx        # Week planner
    ├── feed/
    │   └── page.tsx        # Feed with messages & photos
    ├── oppskrifter/
    │   └── page.tsx        # Sample recipes
    ├── handleliste/
    │   └── page.tsx        # Sample shopping list
    └── innstillinger/
        └── page.tsx        # Settings (read-only)
```

---

## Implementation

### File Structure
```
src/lib/demo/
├── generator.ts        # Main data generator (uses real types)
├── scenarios.ts        # Predefined scenarios (busy week, quiet week, etc.)
├── images.ts           # Image path constants
└── context.tsx         # DemoDataContext provider

scripts/
└── generate-demo-images.ts  # AI image generation (run once)
```

### Demo Data Generator
```typescript
// src/lib/demo/generator.ts
import type {
  Household, HouseholdMember, Child,
  Pickup, Meal, ChildTask, MemberEvent,
  ExternalMessage, ExternalPhoto
} from '@/lib/types'

interface DemoData {
  household: Household
  members: HouseholdMember[]
  children: Child[]
  pickups: Pickup[]
  meals: Meal[]
  tasks: ChildTask[]
  memberEvents: MemberEvent[]
  messages: ExternalMessage[]
  photos: ExternalPhoto[]
}

export function generateDemoData(options?: {
  weekOffset?: number  // 0 = current week
  scenario?: 'busy' | 'quiet' | 'default'
}): DemoData {
  // Generate based on current week
  // Uses real types - breaks if schema changes
}
```

### Demo Context
```typescript
// src/lib/demo/context.tsx
'use client'

const DemoContext = createContext<DemoData | null>(null)

export function DemoProvider({ children }: { children: ReactNode }) {
  const data = useMemo(() => generateDemoData(), [])
  return (
    <DemoContext.Provider value={data}>
      {children}
    </DemoContext.Provider>
  )
}

export function useDemoData() {
  const context = useContext(DemoContext)
  if (!context) throw new Error('useDemoData must be used within DemoProvider')
  return context
}
```

### Demo Layout
```typescript
// src/app/(demo)/layout.tsx
import { DemoProvider } from '@/lib/demo/context'
import { DemoBanner } from '@/components/DemoBanner'

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoProvider>
      <DemoBanner />
      {children}
    </DemoProvider>
  )
}
```

---

## E2E Testing Integration

### Before (complex, doesn't work with server components)
```typescript
await setupTestFixture(context, page, {...})  // Mock auth, API intercepts
await page.goto('/')  // Hits login anyway
```

### After (simple, works everywhere)
```typescript
await page.goto('/demo')  // No auth needed
await expect(page.getByText('Emilie')).toBeVisible()
```

### Updated Test Structure
```typescript
// tests/e2e/demo.spec.ts
test.describe('Demo Mode', () => {
  test('shows today overview with children', async ({ page }) => {
    await page.goto('/demo')
    await expect(page.getByText('Familien Hansen')).toBeVisible()
    await expect(page.getByText('Emilie')).toBeVisible()
    await expect(page.getByText('Oliver')).toBeVisible()
    await expect(page.getByText('Sofie')).toBeVisible()
  })

  test('shows week planner with pickups', async ({ page }) => {
    await page.goto('/demo/uke')
    // Check pickups visible
  })

  test('shows feed with integration messages', async ({ page }) => {
    await page.goto('/demo/feed')
    await expect(page.getByText('Trollskogen Barnehage')).toBeVisible()
    await expect(page.getByText('Emilies Fotball')).toBeVisible()
  })
})
```

---

## User Onboarding Integration

### Login Page
```typescript
// Add to login page
<Link href="/demo" className="text-sm text-muted">
  Prøv demo først →
</Link>
```

### Demo Banner
```typescript
// Shown on all /demo pages
<div className="bg-amber-100 text-amber-800 px-4 py-2 text-center">
  <span>Dette er en demo med eksempeldata</span>
  <Link href="/login" className="ml-2 underline">
    Logg inn for å bruke appen
  </Link>
</div>
```

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Create `src/lib/demo/generator.ts` with types
- [ ] Create `src/lib/demo/context.tsx`
- [ ] Create demo layout with banner

### Phase 2: Images
- [ ] Create `scripts/generate-demo-images.ts`
- [ ] Generate and commit images to `public/demo/`

### Phase 3: Demo Pages
- [ ] `/demo` - Today page
- [ ] `/demo/uke` - Week planner
- [ ] `/demo/feed` - Feed with messages
- [ ] `/demo/innstillinger` - Read-only settings

### Phase 4: E2E Migration
- [ ] Create `tests/e2e/demo.spec.ts`
- [ ] Update visual validation to use `/demo`
- [ ] Remove old mock-auth complexity

### Phase 5: Polish
- [ ] "Prøv demo" link on login page
- [ ] Responsive demo banner
- [ ] Language support in demo

---

## Security Considerations

- Demo routes are public (no auth required)
- Read-only - no mutations to real data
- No real user data exposed
- Clear visual indicator (banner) that it's demo mode
- Demo data generated fresh - no stale sensitive info

---

## Success Criteria

- [ ] `/demo` loads without auth
- [ ] Shows realistic Norwegian family data
- [ ] All integrations represented in feed
- [ ] Week planner shows pickups, meals, tasks, events
- [ ] E2E tests pass using `/demo` routes
- [ ] Works on Vercel preview with any migration state
- [ ] TypeScript errors if schema changes (forces update)
- [ ] Clear "demo mode" indicator for users
