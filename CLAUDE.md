# Familjen Development Guide

## Project Overview

Norwegian family planning app for managing:
- Daily pickup assignments (who picks up which child)
- Weekly meal planning with recipe storage
- Child tasks (reminders, appointments, bring items)
- Wishlists for family members and children (with public share links)
- Calendar sync with Google Calendar

## Tech Stack

- **Next.js 16** with App Router (pages in `src/app/`)
- **Supabase** for PostgreSQL database + Auth + Row Level Security
- **Tailwind CSS v4** with CSS variables for theming
- **TypeScript** with strict typing
- **OpenRouter** for AI meal suggestions
- **Google Calendar API** for calendar sync

## Key Patterns

### Supabase Client

```typescript
// Server component
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()

// Client component
import { createClient } from '@/lib/supabase/client'
const supabase = useMemo(() => createClient(), [])
```

### Date Handling

Always use local timezone formatting:
```typescript
import { formatDateISO } from '@/lib/utils'
const dateStr = formatDateISO(new Date()) // "2024-12-16"
```

### RLS Security

All tables use Row Level Security. Helper functions:
- `get_user_household_id()` - Get user's household (SECURITY DEFINER)
- `is_admin()` - Check app admin status
- `is_household_admin()` - Check household admin status

### Color System

Child colors: `sky | coral | sage | honey | lavender | mint`

```typescript
const CHILD_COLOR_MAP: Record<ChildColor, { bg: string; text: string }> = {
  sky: { bg: 'rgba(126, 182, 196, 0.3)', text: 'var(--color-sky)' },
  // ...
}
```

## File Structure

### Pages (`src/app/`)

| Page | Purpose |
|------|---------|
| `/` | Home - Today overview with pickups, meals, tasks |
| `/uke` | Week planner - Edit pickups, meals, events, tasks |
| `/feed` | Feed - Messages, photos, reminders from integrations |
| `/oppskrifter` | Recipe management |
| `/handleliste` | Shopping list with AI categorization |
| `/innstillinger` | Settings - Profile, household, members, children |
| `/admin` | Admin panel - User management, AI settings, calendar |
| `/login` | Authentication page |
| `/ny-husstand` | Create new household |
| `/g/[token]` | Public wishlist share page (no auth required) |

### Components (`src/components/`)

| Component | Purpose |
|-----------|---------|
| `WeekGrid` | Desktop 7-day grid with pickups, events, tasks, meals |
| `TodayOverview` | Today's summary card |
| `DayView` | Single day detail view |
| `MealSelector` | Recipe/custom meal dropdown |
| `AISuggestionModal` | AI meal suggestion interface |
| `Header` | Navigation with user menu |
| `WishlistSection` | Wishlist display with occasion tabs, share links |
| `AddWishlistItemModal` | Add/edit wishlist item with AI image analysis |

### Types (`src/lib/types.ts`)

Key interfaces:
- `Household`, `HouseholdMember`, `Child`
- `Pickup`, `PickupWithDetails`
- `Meal`, `MealWithRecipe`, `Recipe`
- `ChildTask`, `ChildTaskWithChild`
- `MemberEvent`
- `WishlistItem`, `WishlistOccasion`, `WishlistShareToken`
- `DaySummary`, `WeekPlan`

### API Routes (`src/app/api/`)

| Route | Purpose |
|-------|---------|
| `/api/openrouter/suggest` | AI meal suggestions |
| `/api/openrouter/models` | Available AI models |
| `/api/calendar/auth` | Start Google OAuth |
| `/api/calendar/callback` | OAuth callback |
| `/api/calendar/sync` | Sync inbound calendar events |
| `/api/calendar/send-invite` | Send pickup to work calendar |
| `/api/openrouter/analyze-wishlist-image` | AI extracts product info from images |

## Database Schema

### Core Tables

```sql
households          -- Family units
household_members   -- Adults (email, work_email, allergies)
children           -- Kids (name, color, location, allergies)
pickups            -- Daily assignments (child_id, picker_id, date)
meals              -- Meal plans (date, recipe_id or custom_meal)
recipes            -- Stored recipes (name, ingredients, instructions)
```

### Task System

```sql
child_tasks (
  child_id, date, time,
  task_type: 'bring' | 'appointment' | 'reminder' | 'other',
  title, notes,
  status: 'open' | 'done'
)
```

### Calendar Integration

```sql
member_events      -- Parent events (work trips, dinners)
google_calendar_tokens  -- OAuth tokens for shared Gmail
```

### Wishlist System

```sql
wishlist_items (
  id, household_id, child_id OR member_id,
  name, description, link, price,
  image_path,  -- Storage path in wishlist-images bucket
  priority: 0-5,
  occasion: 'birthday' | 'christmas' | 'general',
  status: 'open' | 'reserved' | 'bought',
  reserved_by, bought_by, bought_at,
  created_at, updated_at
)

wishlist_share_tokens (
  id, household_id, child_id OR member_id,
  token,  -- Short random string (16 hex chars)
  occasion,  -- Optional filter for shared view
  created_at
)
```

**Key features:**
- Items can belong to children OR household members (mutually exclusive)
- Share tokens allow unauthenticated access via `/g/[token]`
- Reserve/buy status hidden from wishlist owner, visible to others
- AI image analysis extracts product name, description, price from photos

### Access Control

```sql
allowed_emails (
  email,
  is_admin,           -- App-wide admin
  can_create_household,  -- Can create own household
  invited_by_household_id  -- Which household invited them
)
```

**RLS Policies on `allowed_emails`:**
| Policy | Command | Who can access |
|--------|---------|----------------|
| `View allowed emails` | SELECT | Own email entry, emails invited by your household, or admin |
| `Admin manages allowed_emails` | ALL | Admin only |
| `Insert allowed emails` | INSERT | Admin or household admin (for invites) |
| `Delete allowed emails` | DELETE | Admin or household admin (for their invites) |

**Critical**: Users must be able to read their own entry to check `can_create_household`. The SELECT policy includes:
```sql
OR email = LOWER((SELECT email FROM auth.users WHERE id = auth.uid()))
```

## Migrations

Located in `supabase/migrations/`. Run with:
```bash
npx supabase db push
```

Key migrations (in order):
1. Base schema (households, members, children, pickups, meals)
2. Recipes and shopping lists
3. RLS policies with SECURITY DEFINER helpers
4. Admin and household admin roles
5. Child colors and allergies
6. Member events and Google Calendar tokens
7. Child tasks
8. Pickup calendar sync
9. Household creation fixes (RLS auth.jwt(), allergies array, calendar hint)
10. Wishlist system (items, share tokens, storage bucket, RLS policies)

## Production Deployment Checklist

### Supabase Setup
1. Create new Supabase project
2. Run migrations via SQL Editor (CLI may have permission issues):
   - Copy content from `supabase/migrations/20251216000000_base_schema.sql`
   - Run in SQL Editor
3. Set up Google OAuth in Supabase Auth → Providers → Google
4. Configure Site URL in Auth → URL Configuration (e.g., `https://familjen.eu`)

### Required Database Columns
Ensure these columns exist (some migrations may not apply cleanly):
```sql
-- household_members
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS short_name TEXT;
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS work_email TEXT;
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS allergies TEXT;
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS birth_date DATE;

-- children
ALTER TABLE children ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE children ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE children ADD COLUMN IF NOT EXISTS allergies TEXT;

-- member_events
ALTER TABLE member_events ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE member_events ADD COLUMN IF NOT EXISTS source_email TEXT;
```

### Required Functions
```sql
-- Household creation (bypasses RLS)
CREATE OR REPLACE FUNCTION create_household_with_admin(
  p_household_name TEXT, p_member_name TEXT, p_member_email TEXT
) RETURNS UUID AS $$
DECLARE v_household_id UUID; v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM household_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'Already has household';
  END IF;
  INSERT INTO households (name) VALUES (p_household_name) RETURNING id INTO v_household_id;
  INSERT INTO household_members (household_id, user_id, name, short_name, email, is_parent, is_household_admin)
  VALUES (v_household_id, v_user_id, p_member_name, LEFT(p_member_name, 3), LOWER(p_member_email), true, true);
  RETURN v_household_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION create_household_with_admin(TEXT, TEXT, TEXT) TO authenticated;

-- Updated version with birth_date and allergies (allergies as text[] array)
CREATE OR REPLACE FUNCTION create_household_with_admin(
  p_household_name TEXT, p_member_name TEXT, p_member_email TEXT,
  p_birth_date DATE DEFAULT NULL, p_allergies TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_household_id UUID; v_user_id UUID; v_allergies TEXT[];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM household_members WHERE user_id = v_user_id) THEN RAISE EXCEPTION 'Already has household'; END IF;
  IF p_allergies IS NOT NULL AND TRIM(p_allergies) != '' THEN v_allergies := string_to_array(TRIM(p_allergies), ','); END IF;
  INSERT INTO households (name) VALUES (p_household_name) RETURNING id INTO v_household_id;
  INSERT INTO household_members (household_id, user_id, name, short_name, email, is_parent, is_household_admin, birth_date, allergies)
  VALUES (v_household_id, v_user_id, p_member_name, LEFT(p_member_name, 3), LOWER(p_member_email), true, true, p_birth_date, v_allergies);
  RETURN v_household_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION create_household_with_admin(TEXT, TEXT, TEXT, DATE, TEXT) TO authenticated;

-- RLS: allowed_emails self-read (use auth.jwt() not subquery to auth.users)
DROP POLICY IF EXISTS "View allowed emails" ON allowed_emails;
CREATE POLICY "View allowed emails" ON allowed_emails FOR SELECT TO authenticated
USING (is_admin() OR invited_by_household_id = get_user_household_id() OR LOWER(email) = LOWER(auth.jwt() ->> 'email'));

-- Get connected calendar email (for all household members)
CREATE OR REPLACE FUNCTION get_connected_calendar_email()
RETURNS TEXT AS $$
DECLARE v_household_id UUID; v_email TEXT;
BEGIN
  SELECT household_id INTO v_household_id FROM household_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_household_id IS NULL THEN RETURN NULL; END IF;
  SELECT email INTO v_email FROM google_calendar_tokens WHERE household_id = v_household_id LIMIT 1;
  RETURN v_email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION get_connected_calendar_email() TO authenticated;
```

### Vercel Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ... (from Legacy API keys)
OPENROUTER_API_KEY=sk-or-...
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://your-domain.com/api/calendar/callback
```

### Admin Setup
1. Add yourself to `allowed_emails`:
```sql
INSERT INTO allowed_emails (email, is_admin, can_create_household)
VALUES ('your@email.com', true, true)
ON CONFLICT (email) DO UPDATE SET is_admin = true, can_create_household = true;
```

2. **Important:** After deployment, log out and log back in to get the JWT with `is_admin` claim. Admin status is synced from DB to JWT on login.

## Development Commands

```bash
# Development
npm run dev          # Development server
npm run build        # Production build
npm run lint         # TypeScript + ESLint

# Testing
npm run test         # Run tests in watch mode
npm run test:run     # Run tests once
npm run test:coverage # Run tests with coverage
npm run test:e2e     # Run Playwright E2E tests
npm run test:e2e:ui  # Run E2E tests with UI

# AI Reviews (requires OPENROUTER_API_KEY)
npm run ai:migration-review  # Review new database migrations
npm run ai:code-review       # Review code changes vs main
npm run ai:visual-review     # Compare screenshots (needs baselines)

# Database
npx supabase db push # Push migrations
```

## Testing

Tests use Vitest for unit/integration tests and Playwright for E2E tests. Located in `tests/`. Run with `npm run test:run`.

### Testing Philosophy

**Core Principles:**

1. **Wrong data is worse than sync not working** - Users trust that synced data from integrations (Spond, MyKid, etc.) is accurate. If we show wrong pickup times, event dates, or messages, users will miss important things. A failed sync with clear error message is far better than silently showing corrupted data.

2. **Users must know when something fails** - When an integration sync fails, the user should see a clear message in their language. They should understand if they can fix it themselves (wrong password) or need to contact support (server error).

3. **Every merge to main is a release** - There's no staging environment. Real users depend on the app working. Tests must catch regressions before merge.

4. **Test what matters, not what's easy** - Focus on user-facing behavior and data integrity, not implementation details.

### Test Structure

```
tests/
├── setup.ts                          # Test setup with jsdom
├── lib/
│   ├── utils.test.ts                 # Date formatting, utilities
│   ├── ics-parser.test.ts            # ICS calendar parsing
│   ├── credentials.test.ts           # Credential encryption/decryption
│   ├── sanitize.test.ts              # Date/time validation
│   └── api-errors.test.ts            # Standardized API error responses
├── hooks/
│   ├── useUndoStack.test.ts          # Undo/redo functionality
│   ├── useBackgroundSync.test.ts     # Offline queue processing
│   └── useSwipeDelete.test.ts        # Touch gesture handling
└── integrations/
    ├── spond-client.test.ts          # Spond auth + data mappers
    └── mykid-client.test.ts          # MyKid 3-step CSRF auth + mappers
```

### What to Test

**Always test:**
- Integration client authentication flows
- Data mappers (external API → database format) - **critical for data integrity**
- Error handling and user-facing error messages
- Date/time parsing and formatting
- Credential encryption/decryption
- Hooks with complex state logic

**Test integration mappers thoroughly:**
```typescript
// Integration mappers are critical - wrong mapping = wrong data shown to users
describe('mapEventToDb', () => {
  it('maps Spond event to database format', () => {
    const spondEvent = {
      id: 'event-123',
      heading: 'Football Training',        // Spond uses 'heading', not 'title'
      startTimestamp: '2024-12-20T18:00:00.000Z',
      endTimestamp: '2024-12-20T20:00:00.000Z',
      type: 'EVENT',                       // Gets lowercased
    }
    const mapped = SpondClient.mapEventToDb(spondEvent, 'group-456')

    expect(mapped.title).toBe('Football Training')
    expect(mapped.eventDate).toBe('2024-12-20')
    expect(mapped.eventType).toBe('event')  // lowercase
  })
})
```

### Error Handling Helpers

**Use `ApiErrors` for all API routes:**
```typescript
import { ApiErrors, handleApiError } from '@/lib/api-errors'

// Returns Norwegian user-facing messages
return ApiErrors.unauthorized()     // "Du må logge inn på nytt"
return ApiErrors.forbidden()        // "Du har ikke tilgang til dette"
return ApiErrors.notFound('Barn')   // "Barn ble ikke funnet"
return ApiErrors.validation('E-post er påkrevd', { field: 'email' })
return ApiErrors.rateLimit(30)      // "Vennligst vent 30 sekunder..."
return ApiErrors.authFailed('Spond') // "Kunne ikke logge inn på Spond"

// Never expose internal errors to users
return ApiErrors.internal({
  internalMessage: 'DB connection failed: ECONNREFUSED'  // Logged, not shown
})

// Catch-all for unexpected errors
try {
  // ...
} catch (error) {
  return handleApiError(error, 'calendar sync')  // Logs context, returns 500
}
```

**Use type-safe credential helpers:**
```typescript
import { decryptCredentials, isSpondCredentials } from '@/lib/credentials'

const result = await decryptCredentials<SpondCredentials>(supabase, encrypted)
if (!result.success) {
  return ApiErrors.internal({ internalMessage: result.error })
}
if (!isSpondCredentials(result.credentials)) {
  return ApiErrors.internal({ internalMessage: 'Invalid Spond credentials format' })
}
const { email, password } = result.credentials
```

**Use sanitize helpers for AI-generated dates:**
```typescript
import { sanitizeDate, sanitizeTime } from '@/lib/sanitize'

// AI might return invalid dates like "2024-02-30" - sanitizeDate catches this
const validDate = sanitizeDate(aiResponse.date)   // null if invalid
const validTime = sanitizeTime(aiResponse.time)   // null if invalid or out of range
```

### Writing Tests

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('MyFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks()  // Always reset mocks
  })

  it('handles success case', () => {
    expect(myFunction('valid')).toBe(expected)
  })

  it('returns null for invalid input', () => {
    expect(myFunction('invalid')).toBeNull()
  })

  it('throws on missing required data', () => {
    expect(() => myFunction(undefined)).toThrow()
  })
})
```

### Mocking Patterns

**Mock fetch for integration clients:**
```typescript
const mockFetch = vi.fn()
global.fetch = mockFetch

mockFetch.mockResolvedValueOnce({
  ok: true,
  json: () => Promise.resolve({ loginToken: 'token-123' }),
})
```

**Mock Supabase client:**
```typescript
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    })),
  })),
}))
```

### E2E Testing (Playwright)

E2E tests use Playwright with **mock auth and AI-generated test data**. This allows testing on fresh Vercel previews without needing a real database or test user.

**Test Structure:**
```
tests/e2e/
├── fixtures/
│   ├── mock-auth.ts           # Mock Supabase auth state
│   └── test-data-generator.ts  # AI-generated Norwegian family data
├── critical-journeys.spec.ts   # User journey tests with mock data
├── design-system.spec.ts       # Deterministic design checks (no AI)
├── capture-screenshots.spec.ts # Screenshot capture for AI validation
└── auth.setup.ts               # Real auth (only used if credentials provided)
```

**Mock Auth Mode (Default):**
```typescript
// tests/e2e/critical-journeys.spec.ts
import { test, expect } from '@playwright/test'
import { setupTestFixture } from './fixtures/mock-auth'

test('home page shows children and pickups', async ({ page, context }) => {
  // Set up mock auth and AI-generated test data
  const { household } = await setupTestFixture(context, page, {
    childCount: 2,
    memberCount: 2,
    withPickups: true,
  })

  await page.goto('/')

  // Test data is automatically injected via route mocks
  for (const child of household.children) {
    await expect(page.locator(`text=${child.name}`)).toBeVisible()
  }
})
```

**Run E2E tests:**
```bash
npx playwright test                    # Mock auth (default)
npx playwright test --project=chromium # Desktop only
PLAYWRIGHT_BASE_URL=https://preview.vercel.app npx playwright test

# With real auth (optional - needs test user in database)
E2E_TEST_EMAIL=test@example.com E2E_TEST_PASSWORD=secret npx playwright test
```

**Benefits of Mock Auth:**
- Works on fresh Vercel previews with no database setup
- Tests adapts to schema changes (AI generates valid data)
- No need to maintain test users or seed data
- Tests run faster (no auth API calls)

### Current Coverage

- **220+ tests** covering:
  - Utilities (date formatting, ICS parsing)
  - Hooks (undo stack, background sync, swipe delete)
  - Integration clients (Spond, MyKid auth flows and mappers)
  - API error helpers
  - Credential handling
  - Data sanitization

### CI/CD Integration

Tests run on every PR via GitHub Actions:
- TypeScript compilation check
- ESLint
- Vitest unit tests
- AI Migration Review (for PRs with migrations)
- AI Code Review (posts comment to PR)
- AI Visual Review (optional, if baselines exist)

**Before merging:** All tests must pass. No exceptions.

## AI-Powered CI/CD

The CI pipeline uses AI to review code changes, following our philosophy: *"We don't test to make tests pass. We test to be confident busy parents won't have headaches."*

### Architecture: Non-Blocking Reviewers + Final Verdict

The CI uses a **two-tier architecture**:
1. **Individual Reviewers** - Run in parallel, inform but don't block (exit 0)
2. **Final Verdict** - The "super AI" that aggregates all findings and makes the sole PASS/BLOCK decision

This design allows:
- Fast feedback from multiple reviewers
- Intelligent decision-making that considers context
- No false positives blocking PRs unnecessarily

### AI Review Scripts

```
scripts/
├── ai-config.ts              # Model config + OpenRouter structured outputs
├── ai-review-types.ts        # Shared types for all reviewers (ReviewerOutput)
├── migration-ai-review.ts    # Reviews database migrations (non-blocking)
├── ai-code-review.ts         # Reviews PR code changes (non-blocking)
├── ai-visual-validation.ts   # Evaluates screenshots (non-blocking)
├── api-test-reporter.ts      # Converts Vitest results to ReviewerOutput
├── e2e-test-reporter.ts      # Converts Playwright results to ReviewerOutput
└── ai-final-verdict.ts       # The "super AI" decision maker (BLOCKING)
```

### Environment Variables

**Required (GitHub Secrets):**
```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_FAST_MODEL=google/gemini-2.0-flash-001       # Migration review
OPENROUTER_CAPABLE_MODEL=anthropic/claude-sonnet-4     # Code review
OPENROUTER_VISION_MODEL=google/gemini-2.0-flash-001    # Visual validation
OPENROUTER_VERDICT_MODEL=anthropic/claude-opus-4       # Final verdict (most capable)
OPENROUTER_TEST_MODEL=google/gemini-2.0-flash-001      # API tests
```

**Optional:**
```bash
OPENROUTER_IMAGE_MODEL=stabilityai/stable-diffusion-xl  # Image generation tests
```

**Note:** All model env vars are required - no hardcoded defaults. This ensures you're always using your intended models and prevents silent fallbacks to stale model IDs when you update your secrets.

### Running Locally

```bash
# Review new migrations
npm run ai:migration-review
npm run ai:migration-review -- --all  # Review all migrations

# Review code changes
npm run ai:code-review
npm run ai:code-review -- --base origin/main

# Visual review (baseline-based, optional)
npm run ai:visual-review
npm run ai:visual-review -- --capture  # Show capture instructions
npm run ai:visual-review -- --update   # Update baselines from current

# Visual validation (no baselines needed - default in CI)
npm run ai:visual-validate             # Validates screenshots against design system

# Final verdict (aggregates all reviewers, only run after other reviews)
npm run ai:final-verdict               # Requires .ai-reviews/*.json files
```

### Migration Review

Reviews new database migrations for:
- **Naming conventions**: snake_case tables/columns, verb-prefix functions
- **RLS security**: Policies, SECURITY DEFINER, household_id scoping
- **Data integrity**: Foreign keys, constraints, indexes
- **Rollback safety**: IF EXISTS, reversible changes
- **Familjen patterns**: TIMESTAMPTZ, UUIDs, household isolation

```typescript
// Output format (structured via JSON schema)
{
  "verdict": "PASS" | "FAIL" | "WARN",
  "issues": [{ "severity": "critical|warning|info", "message": "...", "line": 42 }],
  "suggestions": ["Add index on household_id"],
  "summary": "Migration adds user preferences table with proper RLS..."
}
```

### Code Review

Reviews PR diffs for:
- **Security**: Auth checks, RLS policies, input sanitization, no secrets
- **Data integrity**: Error handling, optimistic update rollbacks
- **Norwegian app specifics**: i18n translations, child colors, date formatting
- **AI agent detection**: Hallucinated imports, placeholder TODOs, logic vs comments
- **Code quality**: TypeScript types, patterns, dead code

Posts a comment to the PR with verdict and actionable feedback:
```markdown
## 🤖 AI Code Review

**Verdict:** APPROVE

This PR adds sync failure banners with proper error handling...

### 💡 Suggestions
- `src/components/Banner.tsx:42`: Consider memoizing the filter function
```

### Visual Review (Baseline-Based)

Compares baseline screenshots with current screenshots to detect:
- Critical elements present (pickups, meals, tasks visible)
- Accessibility concerns (contrast, touch targets 44px+)
- Obvious bugs (overlapping elements, cut-off text)
- Mobile usability (one-handed use for busy parents)

**Setup baselines:**
```bash
# 1. Capture current screenshots
npx playwright test capture-screenshots --project=chromium

# 2. Review and set as baselines
npm run ai:visual-review -- --update

# 3. Commit baselines
git add tests/visual/baselines/
git commit -m "Add visual regression baselines"
```

### Visual Validation (No Baselines Needed)

The preferred approach for CI - AI evaluates screenshots against design system expectations:

**What it checks:**
- **Design System Compliance**: Colors, typography, spacing, touch targets
- **Content Visibility**: Expected elements present (children, pickups, meals)
- **Mobile Usability**: Can busy parents use this with one hand?
- **Norwegian Context**: ø, æ, å characters render correctly

**How it works:**
1. Playwright captures screenshots using mock auth + AI-generated test data
2. Works on fresh Vercel previews with no real database needed
3. AI vision model evaluates each screenshot against expectations
4. Results posted as PR comment with PASS/WARN/FAIL verdict

**Page expectations are defined in code:**
```typescript
// scripts/ai-visual-validation.ts
const PAGE_EXPECTATIONS = [
  {
    name: 'home',
    description: 'Home page showing today\'s overview for a busy parent',
    mustShow: [
      'Today\'s date or "I dag"',
      'Children names or pickup assignments',
      'Navigation (bottom or sidebar)',
    ],
    mustNotShow: [
      'Error messages or crash screens',
      'Infinite loading spinners',
    ],
    mobileConsiderations: [
      'Most important info (pickups) should be immediately visible',
      'No horizontal scrolling',
    ],
  },
  // ... more pages
]
```

**Output format:**
```json
{
  "verdict": "PASS",
  "score": 85,
  "designSystemCompliance": {
    "colorPalette": true,
    "typography": true,
    "spacing": true,
    "touchTargets": true
  },
  "contentVisibility": {
    "expected": ["pickups", "children", "navigation"],
    "found": ["pickups", "children", "navigation"],
    "missing": []
  },
  "mobileUsability": {
    "score": 90,
    "notes": ["Good thumb zone placement for navigation"]
  },
  "summary": "Home page renders correctly with all expected elements visible"
}
```

### CI Pipeline Flow

```
PR Created
    │
    ├─► lint ─────────────────────┐
    ├─► typecheck ────────────────┤
    │                             │
    ├─► migration-review ◄────────┘ (if migrations changed)
    │       │ (non-blocking)
    └─► unit-tests ◄──────────────┘
            │
            └─► build
                  │
                  ├─► ai-code-review ───────────────┐
                  │   (non-blocking)                 │
                  │                                  │
                  ├─► visual-validation ─────────────┤  All upload to
                  │   (non-blocking)                 │  .ai-reviews/*.json
                  │                                  │
                  ├─► e2e-preview ───────────────────┤
                  │   (non-blocking)                 │
                  │                                  │
                  └─► api-tests ─────────────────────┘
                            │
                            └─► 🎯 FINAL VERDICT ◄── Downloads all artifacts
                                    │                 Has tools to fetch context
                                    │                 Makes PASS/BLOCK decision
                                    ▼
                               ✅ PASS → Merge allowed
                               ❌ BLOCK → CI fails, PR blocked
```

**Key features:**
- All reviewers are **non-blocking** (`continue-on-error: true`)
- Reviewers upload findings to `.ai-reviews/*.json` artifacts
- Final verdict downloads all artifacts and aggregates findings
- Final verdict has **tools** to read files, search code, test endpoints
- Only the final verdict can fail CI and block the PR

### Final Verdict Tools

The "super AI" has access to tools for deeper investigation:

| Tool | Purpose |
|------|---------|
| `read_file` | Read any file in the repo |
| `read_diff` | Get the full PR diff |
| `search_code` | Grep for patterns |
| `get_commits` | List PR commits |
| `check_migration_patterns` | Find dangerous SQL patterns |
| `verify_rls_coverage` | Check new tables have RLS |
| `test_endpoint` | Make HTTP requests to preview |
| `verify_auth_required` | Test protected routes return 401 |
| `smoke_test_critical_paths` | Quick health checks |
| `verify_imports` | Check for hallucinated packages |
| `check_env_usage` | Find undocumented env vars |

### Structured Outputs

All AI reviews use OpenRouter's structured outputs feature with JSON schemas to guarantee consistent response formats:

```typescript
// From scripts/ai-config.ts
export const SCHEMAS = {
  migrationReview: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['PASS', 'FAIL', 'WARN'] },
      issues: { type: 'array', items: { ... } },
      // ...
    },
    required: ['verdict', 'issues', 'suggestions', 'summary'],
    additionalProperties: false,
  },
  // codeReview, visualReview schemas...
}
```

This ensures:
- No parsing failures from malformed JSON
- Type-safe results in TypeScript
- Consistent output across different models

## Internationalization (i18n)

The app supports Norwegian (nb), Swedish (sv), and English (en).

### Architecture

```
src/lib/i18n/
├── types.ts           # Language type, TranslationStrings interface (~150 keys)
├── context.tsx        # LanguageProvider, useLanguage(), useTranslation()
├── cookie.ts          # Client: getLanguageFromCookieClient(), setLanguageCookie()
├── cookie.server.ts   # Server: getLanguageFromCookieOrBrowser()
└── translations/
    ├── nb.ts          # Norwegian (default)
    ├── sv.ts          # Swedish
    └── en.ts          # English
```

### Usage Patterns

**Client components:**
```typescript
import { useLanguage } from '@/lib/i18n/context'

function MyComponent() {
  const { t, language, setLanguage } = useLanguage()
  return <h1>{t.common.save}</h1>
}
```

**Server components:**
```typescript
import { getLanguageFromCookieOrBrowser } from '@/lib/i18n/cookie.server'
import { getTranslations } from '@/lib/i18n/translations'

async function Page() {
  const language = await getLanguageFromCookieOrBrowser()
  const t = getTranslations(language)
  return <h1>{t.common.save}</h1>
}
```

### Language Persistence

1. **Cookie**: `familjen-language` (7-day expiry)
2. **Database**: `household_members.language_preference` for logged-in users
3. **Browser detection**: Falls back to `Accept-Language` header

### Adding New Translations

1. Add key to `TranslationStrings` interface in `types.ts`
2. Add value to all three translation files (nb.ts, sv.ts, en.ts)
3. Use via `t.section.key` in components

### Key Translation Sections

| Section | Purpose |
|---------|---------|
| `common` | Buttons, labels, states (save, cancel, loading...) |
| `nav` | Navigation items |
| `date` | Weekdays, months, week format |
| `home` | Home page strings |
| `week` | Week planner, AI modal |
| `settings` | Settings page |
| `recipes` | Recipe management |
| `shopping` | Shopping list |
| `admin` | Admin panel (~40 keys) |
| `wizard` | Setup wizard |
| `wishlists` | Wishlist management (~30 keys) |
| `errors` | Error messages |
| `success` | Success messages |

## Norwegian Terms Reference

Key Norwegian terms used in code:
- Henting = Pickup
- Middag = Dinner
- Oppgave = Task
- Husstand = Household
- Innstillinger = Settings
- Ukeplan = Week plan
- Ønskeliste = Wishlist

## Error Handling

- Use try/catch with user-friendly Norwegian messages
- PGRST116 = "no rows returned" - OK for optional queries
- 403 from RLS = Check policy and SECURITY DEFINER functions

## Calendar Integration

### Inbound (from work calendars)
- Shared Gmail receives calendar invites
- Sync endpoint matches sender email to household members
- Creates `member_events` for matched invites

### Outbound (to work calendars)
- Pickup assignments can send invite to picker's work_email
- Creates event with picker as attendee
- Stores event ID for updates/deletes

## AI Meal Suggestions

Uses OpenRouter API with context:
- Household allergies (members + children)
- Week context (free text notes)
- Existing week meals
- Previous recipes

## Permissions Model

| Role | Access |
|------|--------|
| User | Own household data |
| Household Admin | Manage household members/children |
| App Admin | All households, user management, AI settings |

## External Integrations

The app syncs data from external services (kindergartens, schools, sports clubs).

### Services

| Service | Auth Method | Data Synced |
|---------|-------------|-------------|
| Spond | Email + Password | Messages, photos, calendar events |
| Kidplan | Email + Password | Messages, photos, calendar events |
| iSkole | Username + Password (SHA256) | Messages, timetable, absences, school calendar |
| MyKid | Phone + Password | Newsletters, photos, calendar events |

### Integration Files

```
src/lib/integrations/
├── spond/client.ts      # Spond API client
├── kidplan/client.ts    # Kidplan API client
├── iskole/client.ts     # iSkole API client (3-step SHA256 auth)
└── mykid/
    ├── client.ts        # MyKid API client (3-step CSRF auth)
    ├── types.ts         # MyKid-specific types
    └── index.ts         # Exports

src/app/api/integrations/
├── spond/sync/          # Spond sync endpoint
├── kidplan/sync/        # Kidplan sync endpoint
├── iskole/sync/         # iSkole sync endpoint
└── mykid/
    ├── test-connection/ # Test MyKid credentials
    ├── groups/          # Get children for mapping
    └── sync/            # Sync MyKid data

src/components/integrations/
├── shared/
│   ├── BaseIntegration.tsx      # Shared UI component
│   ├── useIntegrationState.ts   # Shared state management
│   └── types.ts                 # Shared types
├── SpondIntegration.tsx         # Uses shared infrastructure
├── KidplanIntegration.tsx
├── ISkoleIntegration.tsx
└── MyKidIntegration.tsx
```

### Database Tables

```sql
external_integrations (
  id, household_id, service, display_name,
  credentials_encrypted,  -- Encrypted via RPC
  child_mappings,         -- JSON: external_group_id → child_id
  last_sync_at, last_sync_status, last_sync_error,
  created_at
)

external_messages (
  id, integration_id, child_id, external_id,
  sender_name, title, body, message_date,
  source_type,  -- 'message', 'newsletter', 'board_post'
  raw_data
)

external_events (
  id, integration_id, external_id,
  title, event_date, end_date, event_time, end_time,
  event_type,  -- 'birthday', 'school_class', 'school_absence', 'school_closure'
  raw_data
)

external_photos (
  id, integration_id, child_id, external_id,
  title, taken_at, storage_path,
  width, height, file_size, expires_at,
  raw_data
)
```

### Sync Flow

1. **Cron job** (`/api/cron/sync-integrations`) runs on schedule
2. **Decrypts credentials** via `decrypt_token` RPC
3. **Authenticates** with each service
4. **Syncs data** (messages, events, photos)
5. **AI extracts** actionable items from messages → `ai_suggestions`

### Historical Sync

On **first sync** (when `last_sync_at` is null), all integrations fetch **365 days** of historical data to populate the feed with rich context. Subsequent syncs only fetch new data since `last_sync_at`.

**Manual re-fetch:** To re-sync historical data (e.g., after adding new child mappings), pass `fullSync: true`:

```typescript
// Request
POST /api/integrations/spond/sync
{ "integrationId": "...", "fullSync": true }
```

The `HISTORICAL_SYNC_DAYS` constant (365) is defined in `src/lib/integrations/shared/sync-handler.ts`.

### Key Patterns

**Credential encryption:**
```typescript
// Store (RPC handles encryption)
await supabase.rpc('upsert_external_integration', {
  p_service: 'mykid',
  p_credentials: { phone, password },  // Raw object, NOT JSON.stringify
  p_display_name: phone,
  p_child_mappings: mappings,
})

// Retrieve (RPC handles decryption)
const { data } = await supabase.rpc('decrypt_token', {
  ciphertext: integration.credentials_encrypted
})
const { phone, password } = JSON.parse(data)
```

**MyKid-specific (3-step CSRF):**
```typescript
// 1. GET /nb/logg_inn → extract CSRF from hidden input
// 2. POST /forside/forside/login with AJAX headers
// 3. GET /foreldre → extract CSRF from meta tag
const client = new MyKidClient()
await client.login(phone, password)
```

### Feed System

Feed page (`/feed`) displays synced content:
- Messages from kindergartens/schools
- Photos with lightbox viewer
- Reminders extracted by AI

Filter categories:
- **Spond** - Sports club messages
- **Skole** - iSkole school messages
- **Barnehage** - Kidplan + MyKid messages
- **Bilder** - Photos from all services
- **Påminnelser** - AI-extracted reminders

## Performance Patterns

### View Transitions

The app uses the View Transitions API for native-feel navigation:

```typescript
// Always use TransitionLink instead of next/link for internal navigation
import { TransitionLink } from '@/components/TransitionLink'

<TransitionLink href="/uke">Week</TransitionLink>
```

**Key files:**
- `src/components/TransitionLink.tsx` - Wrapper with view transition support
- `src/app/globals.css` - Transition animations (250ms crossfade)
- `src/components/AppShell.tsx` - Pull-to-refresh (PWA only) + scroll restoration

### Middleware Auth Optimization

The middleware checks for session cookies before making expensive auth API calls:

```typescript
// src/lib/supabase/middleware.ts
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(c => c.name.includes('-auth-token'))
}

// Skip getUser() if no cookie exists - major TTFB improvement
if (!hasAuthCookie(request)) {
  if (isProtectedPath) return NextResponse.redirect('/login')
  return NextResponse.next({ request })
}
```

### Component Memoization

Key patterns used for performance:

```typescript
// Wrap modals and heavy components with memo
export const AISuggestionModal = memo(function AISuggestionModal({ ... }) { ... })

// Click-outside listeners only when needed
useEffect(() => {
  if (!isOpen) return  // Don't register listener when closed
  document.addEventListener('mousedown', handleClickOutside)
  return () => document.removeEventListener('mousedown', handleClickOutside)
}, [isOpen])

// Pre-compute lookups to avoid render-time calculations
const holidaysByDate = useMemo(() => {
  const map = new Map<string, Holiday | null>()
  weekDates.forEach(date => map.set(formatDateISO(date), getHoliday(date, holidays)))
  return map
}, [weekDates, holidays])

// Memoize sliced arrays to prevent child re-renders
const displayPhotos = useMemo(
  () => (activeFilter === 'all' ? photos.slice(0, 8) : photos),
  [photos, activeFilter]
)
```

### Progressive Loading

For large data sets, load progressively instead of blocking:

```typescript
// FeedPage: Set photos immediately, load URLs in background
setPhotos(initialPhotos)  // Render with placeholders

// Process URLs in batches of 5
for (let i = 0; i < photos.length; i += 5) {
  const batch = photos.slice(i, i + 5)
  const urls = await Promise.all(batch.map(p => getSignedUrl(p)))
  setPhotos(prev => prev.map(p => /* merge URLs */))
}
```

### Adaptive Prefetching

Prefetch routes based on connection quality:

```typescript
// src/hooks/usePrefetchRoutes.ts
const shouldSkipPrefetch = () => {
  const conn = navigator.connection
  return conn?.saveData || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g'
}

// Use requestIdleCallback for non-blocking prefetch
requestIdleCallback(() => router.prefetch(route), { timeout: 2000 })
```

## Security Headers

The app sets security headers via `next.config.ts`:
- **HSTS**: Strict-Transport-Security with 1-year max-age
- **CSP**: Content-Security-Policy for XSS protection
- **X-Powered-By**: Disabled to hide framework info

## Rate Limiting

Rate limiting protects expensive endpoints (AI, external API calls) from abuse.

### Architecture

```
src/lib/rate-limit.ts
├── checkRateLimit()        # Main rate limit check
├── checkDemoRateLimit()    # Demo mode global rate limit
├── RATE_LIMITS             # Per-endpoint configs
└── DEMO_RATE_LIMITS        # Demo mode configs
```

### Production (Upstash Redis)

When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set:
- Uses Upstash Redis for distributed rate limiting
- Sliding window algorithm for smooth limit enforcement
- Analytics enabled for monitoring
- Prefix: `familjen:ratelimit`

### Development (In-Memory Fallback)

When Redis env vars are not set:
- Falls back to in-memory Map
- Same limits enforced locally
- Periodic cleanup to prevent memory leaks

### Per-User Limits (Production)

| Endpoint | Limit | Window |
|----------|-------|--------|
| `aiSuggest` | 10/min | 60s |
| `aiParseReminders` | 20/min | 60s |
| `calendarSync` | 30/min | 60s |
| `spondSync` | 10/min | 60s |
| `urlFetch` | 10/min | 60s |

### Demo Mode Limits

Demo mode uses **global** rate limits (shared across all demo users):

| Endpoint | Limit | Window | Cost estimate |
|----------|-------|--------|---------------|
| `aiSuggest` | 50/hour | 3600s | ~$0.01/hour |

**Key design decisions:**
- Global key (`demo:global:aiSuggest`) prevents demo users from exhausting limits individually
- 5-minute cooldown after hitting limit (`DEMO_COOLDOWN_MS`)
- Uses cheap model (`google/gemini-2.5-flash-lite`) to minimize costs
- Demo requests bypass Supabase client creation for efficiency

### Usage in API Routes

```typescript
import { checkRateLimit, createRateLimitKey, RATE_LIMITS, checkDemoRateLimit, isDemoRequest } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const isDemo = isDemoRequest(request)

  if (isDemo) {
    // Demo: global rate limit, no Supabase client needed
    const demoLimit = await checkDemoRateLimit('aiSuggest')
    if (demoLimit.limited) {
      return NextResponse.json(
        { error: `Prøv igjen om ${Math.ceil(demoLimit.retryAfter / 60)} minutter.` },
        { status: 429, headers: { 'Retry-After': String(demoLimit.retryAfter) } }
      )
    }
    // Handle demo request...
    return handleDemoRequest()
  }

  // Production: per-user rate limit
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const rateLimit = await checkRateLimit(
    createRateLimitKey(user.id, 'aiSuggest'),
    RATE_LIMITS.aiSuggest
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: `Prøv igjen om ${rateLimit.retryAfter} sekunder.` },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }
  // Handle production request...
}
```

### Demo Mode Detection

Demo requests are identified via header:
```typescript
// Client sets header
headers: { 'x-demo-mode': 'true' }

// Server checks
function isDemoRequest(request: Request): boolean {
  return request.headers.get('x-demo-mode') === 'true'
}
```
