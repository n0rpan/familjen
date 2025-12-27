# Demo Mode Implementation Plan

## Overview

Create a `/demo` route that showcases the app with pre-generated mock data, useful for:
1. E2E testing without auth complexity
2. User onboarding ("see how the app works")
3. Development without database dependency

## Demo Family: "Familien Hansen"

### Members (2 parents)
- **Erik Hansen** - Far (Dad), short name "Erik"
- **Marte Hansen** - Mor (Mom), short name "Marte"

### Children (3 kids)
1. **Emilie** (8 år) - Color: coral, Location: Steinerskolen
2. **Oliver** (5 år) - Color: sky, Location: Trollskogen Barnehage
3. **Sofie** (3 år) - Color: sage, Location: Trollskogen Barnehage

## Pre-generated Images

Store in `public/demo/`:

```
public/demo/
├── children/
│   ├── emilie.jpg      # Girl ~8 years, illustrated style
│   ├── oliver.jpg      # Boy ~5 years, illustrated style
│   └── sofie.jpg       # Girl ~3 years, illustrated style
├── feed/
│   ├── barnehage-1.jpg # Kids playing outdoors
│   ├── barnehage-2.jpg # Craft activity
│   ├── barnehage-3.jpg # Story time / circle
│   └── barnehage-4.jpg # Outdoor nature walk
└── meals/
    ├── taco.jpg        # Taco Friday classic
    ├── fiskegrateng.jpg # Norwegian fish gratin
    └── pasta.jpg       # Family pasta dish
```

**Image generation prompts (Stable Diffusion / DALL-E style):**
- Children: "Friendly illustrated portrait of a [age] year old Norwegian [boy/girl], warm colors, children's book style, simple background"
- Activities: "Children playing [activity] at Scandinavian kindergarten, bright and cheerful, photograph style"
- Meals: "Homemade [dish name], family dinner, overhead shot, cozy kitchen"

## Demo Data Structure

### Week Plan (current week)
| Day | Emilie Pickup | Oliver Pickup | Sofie Pickup | Meal |
|-----|---------------|---------------|--------------|------|
| Mon | Marte 15:30 | Erik 16:00 | Erik 16:00 | Kyllingwok |
| Tue | Erik 16:00 | Marte 15:00 | Marte 15:00 | Fiskegrateng |
| Wed | Marte 14:00 | Erik 16:30 | Erik 16:30 | Pasta Bolognese |
| Thu | Erik 15:30 | Marte 15:00 | Marte 15:00 | Restedag |
| Fri | Marte 14:00 | Erik 15:00 | Erik 15:00 | Taco! |

### Feed Messages (from integrations)
1. **Trollskogen Barnehage** (2 days ago)
   - "Kjære foreldre! I dag har vi vært på tur i skogen..."
   - Photo: barnehage-4.jpg

2. **Trollskogen Barnehage** (4 days ago)
   - "Denne uken har vi jobbet med høstprosjektet..."
   - Photo: barnehage-2.jpg

3. **Steinerskolen** (1 week ago)
   - "Påminnelse: Foreldremøte torsdag kl 18:00"
   - No photo

4. **Spond - Emilies Fotball** (3 days ago)
   - "Trening avlyst tirsdag pga banearbeid"
   - No photo

### Child Tasks
- Emilie: "Ta med gymtøy" (bring gym clothes) - Monday
- Oliver: "Tannlegetime 10:00" (dentist) - Wednesday
- Sofie: "Regntøy trengs" (rain gear needed) - Thursday

## Route Structure

```
src/app/(demo)/
├── layout.tsx              # DemoDataProvider wrapper
└── demo/
    ├── page.tsx            # Today view → reuses TodayOverview
    ├── uke/
    │   └── page.tsx        # Week view → reuses WeekGrid
    ├── feed/
    │   └── page.tsx        # Feed view → reuses Feed components
    ├── oppskrifter/
    │   └── page.tsx        # Recipes (empty state or sample)
    ├── innstillinger/
    │   └── page.tsx        # Settings (read-only view)
    └── handleliste/
        └── page.tsx        # Shopping list (sample items)
```

## Implementation Steps

### Phase 1: Demo Data & Images
1. [ ] Create `scripts/generate-demo-images.ts` - AI image generation script
2. [ ] Generate and commit images to `public/demo/`
3. [ ] Create `src/lib/demo/data.ts` - Static demo data (Familien Hansen)

### Phase 2: Demo Provider
4. [ ] Create `src/lib/demo/context.tsx` - DemoDataContext
5. [ ] Create demo layout `src/app/(demo)/layout.tsx`
6. [ ] Create useDemo hook that provides data in same shape as real hooks

### Phase 3: Demo Pages
7. [ ] `/demo` - Today page with demo data
8. [ ] `/demo/uke` - Week planner
9. [ ] `/demo/feed` - Feed with messages and photos
10. [ ] `/demo/innstillinger` - Settings (read-only)

### Phase 4: E2E Integration
11. [ ] Update E2E tests to use `/demo` routes
12. [ ] Update CI workflow to test against `/demo`
13. [ ] Remove complex mock-auth setup

### Phase 5: Landing Page Integration
14. [ ] Add "Prøv demo" (Try demo) button on login page
15. [ ] Demo banner showing "Dette er en demo" (This is a demo)

## Technical Decisions

### Data Hook Abstraction
Components should work with both real and demo data:

```typescript
// Option A: Context-based (recommended)
// Components check if they're in demo mode
const { isDemo, household, children } = useHouseholdData()

// Option B: Props-based
// Pass data source as prop
<WeekGrid dataSource={isDemoMode ? demoData : undefined} />
```

**Recommendation:** Option A with context - less prop drilling

### Navigation in Demo Mode
- Demo uses `/demo/*` routes
- Header shows "Demo" badge
- "Logg inn" button to exit demo → `/login`

### Language in Demo Mode
- Respect browser language setting (nb/sv/en)
- Demo family names stay Norwegian (authentic feel)

## Security Considerations
- Demo routes are public (no auth)
- Read-only, no mutations
- No real data exposed
- Clear visual indicator that it's demo mode

## AI Image Generation Script

```typescript
// scripts/generate-demo-images.ts
import { AI_MODELS } from './ai-config'

const DEMO_IMAGES = [
  {
    path: 'children/emilie.jpg',
    prompt: 'Friendly illustrated portrait of an 8 year old Norwegian girl with light brown hair, warm smile, soft watercolor style, simple pastel background',
  },
  // ... more images
]

async function generateDemoImages() {
  for (const image of DEMO_IMAGES) {
    console.log(`Generating ${image.path}...`)
    const result = await generateImage(image.prompt)
    await saveImage(result, `public/demo/${image.path}`)
  }
}
```

## Success Criteria
- [ ] `/demo` loads without auth
- [ ] Shows realistic Norwegian family data
- [ ] Feed has messages with photos
- [ ] Week planner shows pickups and meals
- [ ] E2E tests pass using `/demo` routes
- [ ] Works on Vercel preview with any migration state
- [ ] Clear "demo mode" indicator for users
