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

### Proxy (Authentication Middleware)

**Important:** This project uses Next.js 16's `proxy.ts` convention (not the deprecated `middleware.ts`).

```
src/proxy.ts          # Authentication and route protection
src/lib/supabase/middleware.ts  # Session update logic
```

The proxy handles:
- Session refresh for authenticated users
- Redirect to `/login` for protected routes without auth
- Admin-only route protection (`/admin`)
- Demo mode bypass for certain paths

**Note for AI reviewers:** The `middleware.ts` → `proxy.ts` rename is a Next.js 16 requirement, not a bug. See [Next.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).

### React Hook Patterns

**Timer/Ref Cleanup Pattern:**
When cleaning up refs in useEffect, capture the ref value at effect setup time:

```typescript
// ✅ Correct - capture ref at setup
useEffect(() => {
  const timers = timersRef.current
  return () => {
    timers.forEach(timer => clearTimeout(timer))
  }
}, [])

// ❌ Wrong - ref may change by cleanup time
useEffect(() => {
  return () => {
    timersRef.current.forEach(timer => clearTimeout(timer))
  }
}, [])
```

**Domain Props vs React Children:**
This codebase uses `children` as a prop name for household children (kids), not React children. The ESLint rule `react/no-children-prop` is disabled because of this intentional naming:

```typescript
// This is valid - 'children' refers to Child[] (household kids)
<WeekGrid children={householdChildren} members={members} />
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
| `WeekSection` | Client wrapper for WeekGrid with event modals (used on home page) |
| `TodaySection` | Client wrapper for TodayOverview with event modals |
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
| `/api/auth/google` | Start Google OAuth for login (shows familjen.eu) |
| `/api/auth/google/callback` | Handle Google OAuth callback |
| `/api/openrouter/suggest` | AI meal suggestions |
| `/api/openrouter/models` | Available AI models |
| `/api/calendar/auth` | Start Google OAuth for calendar |
| `/api/calendar/callback` | Calendar OAuth callback |
| `/api/calendar/sync` | Sync inbound calendar events |
| `/api/calendar/send-invite` | Send pickup to work calendar |
| `/api/openrouter/analyze-wishlist-image` | AI extracts product info from images |
| `/api/integrations/deduplicate` | Trigger AI duplicate detection for household |
| `/api/integrations/duplicates` | GET pending suggestions and merged duplicates |
| `/api/cron/sync-integrations` | Nightly cron: sync all integrations + deduplicate |

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
3. Configure Site URL in Auth → URL Configuration (e.g., `https://familjen.eu`)

### Google Cloud Console Setup
Google OAuth is handled by our custom flow (shows `familjen.eu` instead of Supabase URL):

1. Configure OAuth consent screen (APIs & Services → OAuth consent screen)
   - User type: External
   - App name: Familjen
   - Support email: your email
   - Scopes: `openid`, `email`, `profile`
2. Create OAuth 2.0 Client ID (APIs & Services → Credentials)
3. Add authorized redirect URIs:
   - `https://familjen.eu/api/auth/google/callback` (login)
   - `https://familjen.eu/api/calendar/callback` (calendar sync)
   - For local dev: `http://localhost:3000/api/auth/google/callback`
4. Copy Client ID and Client Secret to environment variables

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
# Google OAuth (required - used for login AND calendar sync)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
# Only needed for calendar sync feature
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

### PR-Aware Test Generation

AI analyzes PR diffs to generate **targeted test scenarios** that verify the specific changes. This catches regressions that static e2e tests miss.

**How it works:**
1. `ai-pr-test-generator.ts` reads the PR diff and changed files
2. AI generates test scenarios based on what changed (e.g., "click event should open detail modal")
3. Scenarios are saved to `tests/e2e/generated/pr-scenarios.json`
4. `pr-scenarios.spec.ts` reads and executes these scenarios via Playwright

**Generated Test Format:**
```json
{
  "scenarios": [
    {
      "id": "demo-event-click",
      "name": "Event detail modal opens on click",
      "priority": "critical",
      "page": "/uke?demo=true",
      "needsAuth": false,
      "needsDemo": true,
      "steps": [
        { "action": "click", "target": "[data-testid='event-item']" }
      ],
      "assertions": [
        { "type": "visible", "target": ".modal" },
        { "type": "text", "target": ".modal-title", "value": "Detaljer" }
      ],
      "prContext": "PR adds event click handlers to week page (/uke)"
    }
  ]
}
```

**Run locally:**
```bash
# Generate tests from current diff
npx tsx scripts/ai-pr-test-generator.ts --base origin/main

# Execute generated tests
npx playwright test tests/e2e/pr-scenarios.spec.ts
```

**CI Integration:** The `e2e-preview` job automatically generates and runs PR-specific tests when:
- `OPENROUTER_API_KEY` and `OPENROUTER_FAST_MODEL` are set
- The Vercel preview is available

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

### Architecture: Two-Tier Intelligence

The CI uses a **two-tier AI architecture** for smart test optimization:

```
┌─────────────────────────────────────────────────────────────┐
│  🚀 Fast Selector (Tier 1)                                   │
│  - Runs FIRST, analyzes PR diff                              │
│  - Decides which tests to run/skip based on file changes     │
│  - Uses fast model (Gemini Flash) for quick decisions        │
│  - Conservative: when in doubt, runs the test                │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        [Tests run based on selector decisions]
              │               │               │
              └───────────────┴───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  🧠 Wise Supervisor (Tier 2)                                 │
│  - Reviews ALL findings AND selector's decisions             │
│  - Can OVERRIDE selector and run skipped tests               │
│  - Uses OPENROUTER_VERDICT_MODEL for final decision           │
│  - Has tools to run visual/e2e/api tests if needed           │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Fast feedback (skip irrelevant tests)
- Conservative safety (supervisor can override)
- Cost-effective (only runs extra tests when needed)
- Self-documenting (explains all decisions)

### Smart Test Selection

The fast selector categorizes changes and decides what tests to run:

| Change Type | Tests Run | Tests Skipped |
|-------------|-----------|---------------|
| Migration-only | lint, typecheck, unit, migration-review | visual, e2e, api |
| Docs-only | lint | everything else |
| UI changes | lint, typecheck, unit, visual, e2e | migration, api |
| API changes | lint, typecheck, unit, e2e, api | visual, migration |
| Core file changed | ALL tests | none |

**Core files** (always trigger full suite):
- `src/lib/types.ts`, `src/lib/utils.ts`
- `src/lib/supabase/*.ts`
- `src/lib/i18n/context.tsx`, `src/lib/i18n/types.ts`
- `src/components/Header.tsx`, `src/components/AppShell.tsx`

### Supervisor Override

The final verdict AI can override selector decisions:
1. Calls `get_test_selection` to see what was skipped
2. Uses `explain_skip_decision` to understand reasoning
3. If disagreement, uses `run_visual_validation`, `run_e2e_tests`, etc.
4. Factors additional test results into final PASS/BLOCK decision

### Extended Checks

The smart selector can recommend additional checks based on PR context:

| Check Type | When Recommended | What It Does |
|------------|-----------------|--------------|
| `dead-code-analysis` | Refactoring PRs, file deletions | Finds unused exports and functions |
| `mobile-ux-validation` | Touch handlers, mobile components | Validates mobile user experience |
| `accessibility-audit` | UI changes, color/contrast changes | Checks ARIA labels, keyboard nav |
| `performance-check` | Data fetching, large components | Analyzes render performance |
| `security-audit` | Auth changes, API routes | Reviews credential handling |
| `bundle-size-check` | New dependencies added | Checks bundle impact |
| `i18n-completeness` | Translation file changes | Verifies all languages have keys |

**How it works:**
1. Smart selector analyzes PR and recommends checks in `ci-state/test-selection.json`
2. Pre-verdict check runs ALL recommended extended checks automatically
3. Results saved to `ci-state/pre-verdict-check.json` for supervisor
4. Supervisor reviews findings via `get_pre_verdict_check` tool

**Priority levels** (for supervisor context, all are run by pre-verdict):
- **High**: Critical for this PR type
- **Medium**: Recommended based on changes
- **Low**: Nice to have

### Pre-Verdict Check

The pre-verdict check (`ai-pre-verdict-check.ts`) is a **fast, cheap LLM pass** that runs in parallel with test jobs, before the expensive supervisor.

**What it does:**
1. **Quick checks** (no LLM): TypeScript compilation, preview health, pattern detection
2. **Selector review**: Fast LLM verifies skip decisions make sense
3. **Extended checks**: Runs all checks recommended by selector
4. **Context gathering**: Identifies high-risk changes for supervisor

**Extended checks run:**
| Check | What it detects |
|-------|-----------------|
| `dead-code-analysis` | Unused exports in changed files |
| `accessibility-audit` | Missing alt text, aria-labels, clickable divs |
| `i18n-completeness` | Translation files out of sync |
| `security-audit` | XSS risks, hardcoded credentials |
| `bundle-size-check` | Large dependency additions |

**Output:** `ci-state/pre-verdict-check.json`
```json
{
  "selectorReview": { "verified": true, "concerns": [] },
  "quickChecks": [{ "check": "typescript", "status": "pass" }],
  "extendedChecks": [{ "type": "security-audit", "status": "pass" }],
  "recommendation": "proceed",  // or "run_more_tests", "needs_investigation"
  "reasoning": "All checks passed, selector decisions verified"
}
```

### AI Review Scripts

```
scripts/
├── ai-config.ts              # Model config + OpenRouter structured outputs
├── ai-review-types.ts        # Shared types for all reviewers (ReviewerOutput)
├── ai-metrics.ts             # 🆕 Cost tracking and trend analysis
├── ai-test-selector.ts       # Smart test selection (Tier 1)
├── ai-pr-labeler.ts          # 🆕 Auto-labels PRs based on content
├── ai-pre-verdict-check.ts   # Fast LLM pass before supervisor (Tier 1.5)
├── migration-ai-review.ts    # Reviews database migrations (non-blocking)
├── ai-code-review.ts         # Reviews PR code changes (non-blocking)
├── ai-security-review.ts     # 🆕 OWASP Top 10 security scanning
├── ai-pr-quality.ts          # 🆕 PR description/size/commit quality
├── ai-dependency-review.ts   # 🆕 Dependency security and license review
├── ai-bundle-size.ts         # 🆕 Bundle size tracking with AI suggestions
├── ai-changelog.ts           # 🆕 Auto-generates release notes from commits
├── ai-visual-validation.ts   # Evaluates screenshots (non-blocking)
├── ai-pr-test-generator.ts   # Generates PR-specific E2E test scenarios
├── api-test-reporter.ts      # Converts Vitest results to ReviewerOutput
├── e2e-test-reporter.ts      # Converts Playwright results to ReviewerOutput
├── ai-final-verdict.ts       # The "super AI" supervisor (BLOCKING)
└── lib/
    ├── pr-state.ts           # Tracks test results across PR commits
    └── dependency-graph.ts   # Analyzes file dependencies
```

### Environment Variables

**Required (GitHub Secrets):**
```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_FAST_MODEL=google/gemini-3-flash-preview     # Fast checks, test selector
OPENROUTER_CAPABLE_MODEL=anthropic/claude-sonnet-4.5   # Code review (best quality)
OPENROUTER_VISION_MODEL=google/gemini-3-flash-preview  # Visual validation
OPENROUTER_VERDICT_MODEL=openai/gpt-5.2                # Final verdict (fast reasoning)
OPENROUTER_TEST_MODEL=google/gemini-2.5-flash-lite     # Bulk analysis (cheapest)
```

**Model Selection Guide (Dec 2025 - tested for quality & speed):**

| Role | Model | Speed | Quality | Context | Notes |
|------|-------|-------|---------|---------|-------|
| fast | gemini-3-flash-preview | 1.5s | Good | 1M | Fast + thorough |
| capable | claude-sonnet-4.5 | 8.5s | Best | 1M | Only one that found all bugs |
| vision | gemini-3-flash-preview | 1.5s | Good | 1M | Fast vision support |
| verdict | gpt-5.2 | 4.5s | Good | 400K | Fast reasoning, good decisions |
| test | gemini-2.5-flash-lite | 1s | Good | 1M | Cheapest, proven in app |

**Alternative options:**
- **verdict**: `anthropic/claude-opus-4.5` (best reasoning), `google/gemini-3-pro-preview`
- **capable**: `x-ai/grok-code-fast-1` (faster but less thorough)
- **fast**: `google/gemini-2.5-flash-lite` (cheapest), `x-ai/grok-4.1-fast` (2M context)

**Optional:**
```bash
OPENROUTER_IMAGE_MODEL=stabilityai/stable-diffusion-xl  # Image generation tests
VERCEL_AUTOMATION_BYPASS_SECRET=xxx                     # Bypass Vercel protection for CI smoke tests
```

**Note:** All model env vars are required - no hardcoded defaults. This ensures you're always using your intended models and prevents silent fallbacks to stale model IDs when you update your secrets.

### Running Locally

```bash
# Smart test selector (see what tests would run)
npx tsx scripts/ai-test-selector.ts --base main
npx tsx scripts/ai-test-selector.ts --base origin/main  # Against remote

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
npm run ai:final-verdict               # Requires ai-reviews/*.json files
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
    └─► 🧠 SMART SELECTOR ◄──────── Analyzes diff, decides what to test
            │
            │  Outputs: run_visual, run_e2e, run_migration, run_api
            │
    ┌───────┴───────┐
    │               │
    ├─► lint ───────┤ (always run)
    ├─► typecheck ──┤ (always run)
    │               │
    └─► unit-tests ◄┘
            │
    ┌───────┴────────────────────────────────┐
    │  Conditional jobs (based on selector)   │
    │                                         │
    ├─► migration-review (if run_migration)   │
    ├─► visual-validation (if run_visual) ───┼──► ai-reviews/*.json
    ├─► e2e-preview (if run_e2e) ────────────┤
    ├─► api-tests (if run_api) ──────────────┤
    └─► 🔍 PRE-VERDICT CHECK ◄───────────────┘
               │                    │
               │  Runs extended checks (dead-code, a11y, i18n, security)
               │  Reviews selector decisions with fast LLM
               │
               └─► 🎯 WISE SUPERVISOR ◄── Downloads all artifacts
                            │              Reviews pre-verdict findings
                            │              Can run skipped tests if needed
                            │              Makes final PASS/BLOCK
                            ▼
                       ✅ PASS → Merge allowed
                       ❌ BLOCK → CI fails


Push to Main (from merged PR)
    │
    └─► 🔍 MERGE CHECK ◄──────── Was PR CI green?
            │
            ├─► Yes → Skip redundant tests (only smoke test)
            └─► No/Direct push → Run full protection suite
```

**Key features:**
- **Smart selector** runs first, skips irrelevant tests
- **Pre-verdict check** runs extended checks in parallel with test jobs
- All reviewers are **non-blocking** (`continue-on-error: true`)
- **Wise supervisor** reviews pre-verdict findings, can run skipped tests
- Merge to main skips tests if PR already passed
- Conservative approach: when in doubt, run the test

### Verdict Aggregation

The final verdict follows this logic:
1. **Mechanical verdict**: If any reviewer has FAIL → default BLOCK
2. **AI analysis**: AI can override BLOCK→PASS if issues are pre-existing/unrelated
3. **Explicit override**: When AI overrides, the PR comment clearly shows:
   - Which reviewers failed
   - Why AI approved anyway
   - Mark overridden verdicts in the table

### Final Verdict Tools

The "super AI" has access to tools for deeper investigation:

| Tool | Purpose |
|------|---------|
| `read_file` | Read any file in the repo |
| `read_diff` | Get the full PR diff |
| `search_code` | Grep for patterns |
| `get_commits` | List PR commits |
| `get_full_documentation` | Get full CLAUDE.md or README.md (when truncated) |
| `get_file_section` | Get specific section of a large file |
| `check_migration_patterns` | Find dangerous SQL patterns |
| `verify_rls_coverage` | Check new tables have RLS + household scoping |
| `test_endpoint` | Make HTTP requests to preview |
| `verify_auth_required` | Test protected routes return 401 |
| `smoke_test_critical_paths` | Quick health checks |
| `verify_imports` | Check for hallucinated packages |
| `check_env_usage` | Find undocumented env vars |
| `check_typescript` | Run tsc on changed files |

### Smart Truncation

To balance cost vs context, reviewers use smart truncation:
- **Code review**: Diff truncated at 100KB, docs at 15KB each
- **Migration review**: Last 3 migrations full, older ones truncated at 5KB
- **Final verdict**: Has tools to fetch full context when needed

When content is truncated, the AI sees a note like:
```
... [CLAUDE.md truncated: 25KB more available]
```

If the AI needs more context, it can use `get_full_documentation` or `get_file_section`.

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
| User | Own household data (all normal app features) |
| Household Admin | Destructive operations: delete household, remove members |
| App Admin | All households, user management, AI settings |

**When to use `is_household_admin()`:**
- Deleting the household
- Removing household members
- Changing household-level settings that affect all members

**When NOT to require admin:**
- Normal app usage (pickups, meals, tasks, wishlists)
- Syncing integrations
- Managing duplicate events
- Viewing/editing own profile

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

### Event Deduplication

Events from multiple sources (school calendar, Spond, kindergarten) often duplicate. The app uses AI to detect and merge duplicates.

**Files:**
- `src/lib/integrations/event-deduplication.ts` - Core deduplication logic
- `src/app/api/integrations/deduplicate/route.ts` - Manual trigger endpoint
- `src/app/api/integrations/duplicates/route.ts` - GET suggestions/merged
- `src/components/feed/DuplicateSuggestions.tsx` - Review UI
- `src/components/feed/MergedDuplicates.tsx` - Undo merged duplicates

**Confidence thresholds:**
- `>90%`: Auto-merge (hide duplicate, keep one)
- `60-90%`: Create suggestion for user review
- `<60%`: No action

**Safety safeguards:**
- Parameterized `.in()` queries instead of `.or()` string interpolation (prevents SQL injection)
- Separate queries by source type, combined in JavaScript (avoids string concatenation)
- Deletion detection skipped if API returns <1 event or >50% would be deleted
- Max 10 deletions per sync (likely API error if more)

**Security pattern (IMPORTANT):**
```typescript
// ❌ UNSAFE - String interpolation in .or() can be exploited
const sourceFilter = `source_url_id.in.(${ids.join(',')})`
await supabase.from('external_events').or(sourceFilter)

// ✅ SAFE - Parameterized .in() queries, combined in JavaScript
const [result1, result2] = await Promise.all([
  supabase.from('external_events').in('source_url_id', sourceUrlIds),
  supabase.from('external_events').in('integration_id', integrationIds),
])
const combined = combineAndDeduplicateEvents(result1.data, result2.data)
```

**Cron sync behavior:**
```
05:00 UTC daily:
1. Sync all integrations (Spond, MyKid, etc.)
2. Detect deleted/changed events → notify parents
3. Run deduplication for all households
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

### Calendar Source Extraction (Kalenderkilder)

Users can add external calendar URLs (school calendars, kindergarten schedules) that are synced via AI extraction.

**AI Model:** Configured via `OPENROUTER_TEST_MODEL` or `OPENROUTER_FAST_MODEL` env vars, or `app_settings.openrouter_vision_model` in database.

**How it works:**
1. Fetches HTML from the calendar URL
2. Converts HTML tables to markdown format (preserves column relationships)
3. Cleans HTML (removes scripts, styles, nav, footer) - max 50,000 chars
4. Sends to AI with Norwegian prompt optimized for school calendars
5. AI extracts events with dates, times, and event types
6. **LLM-based semantic matching** to track events across syncs (see below)

**Key files:**
- `src/lib/integrations/document-extraction.ts` - AI extraction logic
- `src/lib/integrations/calendar-source-sync.ts` - Sync orchestration with LLM matching
- `src/components/integrations/ManualSourceUrls.tsx` - UI component

**School year inference:**
The prompt dynamically calculates the school year (Aug-Jul cycle):
- August-December → currentYear-nextYear (e.g., 2025-2026)
- January-July → previousYear-currentYear (e.g., 2024-2025)

**Supported Norwegian terms:**
- "Planleggingsdag" / "Planl.dag" = teacher planning day (no school)
- "Stengt" = closed
- "Ferie" = holiday period
- "Dugnad" = parent volunteer activity
- "Elevene slutter kl. 11.00" = early dismissal

### LLM-Powered Calendar Sync

Calendar source sync uses three LLM-powered features for accurate event tracking:

**1. Semantic Event Matching (`matchEventsWithLLM`)**

AI extraction is non-deterministic - the same event can be extracted with different titles between syncs (e.g., "Fri (Helligdag)" vs "Helligdag"). Instead of hash-based matching (which would cause false "removed" notifications), we use LLM semantic matching:

```
Extracted: "Helligdag" on 2025-05-14
Existing:  "Fri (Helligdag)" on 2025-05-14
→ LLM recognizes these as the same event (confidence: 0.95)
```

**Key features:**
- 1:1 matching constraint (each event matches at most one other)
- Confidence threshold of 0.7 for matches
- Detects date/time changes on matched events
- Falls back to hash matching if LLM unavailable

**2. Extraction Validation (`validateExtractedEvents`)**

Second LLM pass catches obvious extraction errors:
- Wrong school year (e.g., "Vinterferie" extracted for July instead of February)
- Impossible dates (30. February)
- Duplicate events
- Mismatched event types

If corrections are identified, they're applied before sync continues.

**3. Smart Notifications (`generateSmartNotification`)**

Instead of generic "Event removed" messages, LLM generates contextual explanations:

| Change Type | Example Notification |
|-------------|---------------------|
| Date moved | "Hendelsen ble flyttet fra 14. mai til 17. mai" |
| Removed | "Planleggingsdagen ble fjernet fra kalenderen. Sjekk med skolen." |
| Time changed | "Tidspunkt endret fra 08:00 til 09:00" |

**Database columns for smart notifications:**
```sql
event_change_notifications:
  explanation TEXT       -- AI-generated explanation
  suggested_action TEXT  -- What the user should do
  new_title TEXT         -- For title changes
  new_date DATE          -- For date changes
  new_time TIME          -- For time changes
```

**Timeout protection:**
All LLM API calls use a 30-second timeout (`LLM_TIMEOUT_MS`) to prevent hanging requests from blocking the entire sync process.

## Demo Mode Architecture

Demo mode (`?demo=true`) is used for e2e testing and visual validation. It provides a fully functional UI with mock data, without making any real API calls.

### Key Principles

1. **Same component for demo and production** - Every page uses the same React component for both modes. Demo mode is detected internally via `useSearchParams()`.

2. **No Supabase calls in demo mode** - Data hooks (`useWeekData`, `useFeed`, etc.) auto-detect demo mode via `useDataSource()` and return mock data instead of making API calls.

3. **Mutations are blocked in demo mode** - All mutation handlers check for demo mode and return early with a toast message.

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                         Page Component                       │
│  const isDemo = useSearchParams().get('demo') === 'true'    │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────┐
│      Demo Mode          │     │     Production Mode         │
│  - useWeekData() →      │     │  - useWeekData() →          │
│    returns mock data    │     │    fetches from Supabase    │
│  - Mutations blocked    │     │  - Mutations allowed        │
│  - No API calls         │     │  - Real API calls           │
└─────────────────────────┘     └─────────────────────────────┘
```

### Demo Data Hooks

Located in `src/hooks/data/`:

| Hook | Purpose |
|------|---------|
| `useDataSource()` | Core hook - detects demo mode, returns appropriate data source |
| `useWeekData()` | Week plan data (pickups, meals, events, tasks) |
| `useFeed()` | Feed messages and photos |
| `useChildren()` | Household children |
| `useMembers()` | Household members |
| `useTasks()` | Child tasks |
| `useRecipes()` | Recipe list |
| `useShoppingLists()` | Shopping lists |

### Demo Context

The `DemoDataProvider` in `src/lib/demo/context.tsx` provides:
- Mock household, members, and children data
- State management for demo data mutations
- Persistence to localStorage (optional)

### Entry Points

- `/demo` - Redirects to `/?demo=true`
- `?demo=true` - Enables demo mode on any page

### Testing with Demo Mode

```bash
# Run e2e tests in demo mode
npx playwright test --project=chromium

# Visual validation uses demo mode by default
npm run ai:visual-validate
```

### Adding New Pages (Maintainability Guidelines)

When adding new pages, follow these steps to ensure demo/production consistency:

1. **Create as client component** with `'use client'` directive
2. **Detect demo mode** using `useSearchParams()`:
   ```typescript
   const searchParams = useSearchParams()
   const isDemo = searchParams.get('demo') === 'true'
   ```
3. **Use data hooks** that auto-detect demo mode:
   ```typescript
   // These hooks automatically return mock data in demo mode
   const { children } = useChildren()
   const { members } = useMembers()
   const weekData = useWeekData()
   ```
4. **Guard all mutations** with demo mode check:
   ```typescript
   const handleSave = async () => {
     if (isDemo) {
       showMessage('info', t.common.viewOnly)
       return
     }
     // ... actual mutation logic
   }
   ```
5. **Use proper i18n** - never hardcode strings:
   ```typescript
   // ✅ Good
   <h1>{t.nav.settings}</h1>

   // ❌ Bad
   <h1>Settings</h1>
   ```

**Why this matters:**
- Demo mode is used for e2e testing and visual validation
- If demo and production diverge, tests become unreliable
- Hardcoded strings break i18n and make the app inconsistent

## Offline Support and Sync

The app supports offline-first mutations with background sync when connectivity is restored.

### Architecture

```
src/lib/
├── offline-queue.ts              # IndexedDB queue for pending changes
│   ├── queueChange()             # Queue a change for later sync
│   ├── updateQueuedInsert()      # Update data in a queued insert
│   ├── removeQueuedInsert()      # Remove a queued insert
│   ├── getQueuedChanges()        # Get all pending changes
│   ├── clearAllChanges()         # Clear the queue
│   └── getPendingCount()         # Count pending changes

src/hooks/
├── useBackgroundSync.ts          # Processes queue when online
│   ├── SYNC_EVENTS               # Custom events for UI feedback
│   └── processChange()           # Handles each change type

src/components/
└── OfflineIndicator.tsx          # Shows sync status banner
```

### Offline Mutation Flow

1. **User makes a change** (add/update/delete task, wishlist item, etc.)
2. **Check connectivity** via `navigator.onLine`
3. **If offline:**
   - Generate temp ID (`temp-{timestamp}`) for new items
   - Queue change to IndexedDB via `queueChange()`
   - Optimistically update local state
4. **When online:**
   - `useBackgroundSync` detects connectivity
   - Processes queue in order (FIFO)
   - Emits sync events for UI feedback
   - Refetches data to sync temp IDs with real IDs

### Temp ID Handling

When creating items offline, they get temporary IDs. If the user edits or deletes a temp item before sync:

```typescript
// Editing a temp item - update the queued insert directly
if (taskId.startsWith('temp-')) {
  await updateQueuedInsert('child_tasks', '_tempId', taskId, updates)
} else {
  await queueChange({ table: 'child_tasks', operation: 'update', data: { id: taskId, ...updates } })
}

// Deleting a temp item - remove the queued insert
if (taskId.startsWith('temp-')) {
  await removeQueuedInsert('child_tasks', '_tempId', taskId)
} else {
  await queueChange({ table: 'child_tasks', operation: 'delete', data: { id: taskId } })
}
```

### Conflict Resolution: Last Write Wins (with Detection)

**The app uses "last write wins" with conflict detection and user notification.**

When syncing updates, the app:
1. Checks the server's `updated_at` timestamp
2. Compares it to the timestamp when the user started editing
3. If server is newer (another device synced first), emits a `SYNC_CONFLICT` event
4. Applies local changes anyway (last-write-wins) and notifies the user

```typescript
// In useBackgroundSync.ts processChange()
case 'update': {
  const { id, ...updateData } = data
  const itemId = id as string

  // Check for conflicts if we have the original timestamp
  if (originalUpdatedAt) {
    const { data: currentData } = await supabase
      .from(table)
      .select('updated_at')
      .eq('id', itemId)
      .single()

    if (currentData?.updated_at) {
      const serverTime = new Date(currentData.updated_at).getTime()
      const localTime = new Date(originalUpdatedAt).getTime()

      if (serverTime > localTime) {
        // Conflict detected! Notify user but continue with update
        dispatchSyncEvent(SYNC_EVENTS.SYNC_CONFLICT, {
          table, itemId, localData: updateData,
          serverUpdatedAt: currentData.updated_at,
          localUpdatedAt: originalUpdatedAt,
          autoResolved: true,
        })
      }
    }
  }

  // Apply the update (last-write-wins)
  const updateWithId = { id: itemId, ...updateData, updated_at: new Date().toISOString() }
  await supabase.from(table).upsert(updateWithId, { onConflict: 'id' })
  break
}
```

**How it works:**
- Inserts use `upsert` with `ignoreDuplicates: true` - if a duplicate temp ID somehow exists, it's ignored
- Updates check `updated_at` timestamp for conflicts before applying
- The last device to sync "wins", but user is notified of the conflict
- User sees a yellow banner: "Changes from another device were overwritten"

**Trade-offs:**
| Scenario | Behavior |
|----------|----------|
| Single device, intermittent connectivity | Works perfectly - no conflicts |
| Multiple devices, same user | Conflict detected, user notified, local wins |
| Rapid edits while offline | All edits merge correctly (queue updated in-place) |
| Delete then recreate while offline | Works correctly (insert queued, delete removed) |

**Why this approach:**
- Simple to implement and reason about
- User is aware when conflicts occur (can check other device)
- Matches user mental model for a family app (one parent usually makes changes)
- Avoids blocking sync on conflicts - data always moves forward

**Optional enhancement (not implemented):**
For critical data, you could reject the local update and show a manual resolution UI instead of auto-resolving.

### Sync Events

The background sync emits custom DOM events for UI feedback:

```typescript
export const SYNC_EVENTS = {
  SYNC_START: 'familjen:sync:start',
  SYNC_SUCCESS: 'familjen:sync:success',
  SYNC_FAILURE: 'familjen:sync:failure',
  SYNC_COMPLETE: 'familjen:sync:complete',
} as const

export interface SyncFailureDetail {
  table: string
  operation: string
  error: string
  droppedAfterRetries?: boolean
}

// Emitting events
window.dispatchEvent(new CustomEvent(SYNC_EVENTS.SYNC_FAILURE, {
  detail: { table, operation, error: error.message, droppedAfterRetries: true }
}))
```

### OfflineIndicator States

| State | Color | Message |
|-------|-------|---------|
| Sync failed | Coral red | "Synkronisering feilet, prøver igjen..." |
| Dropped after retries | Coral red | "Endringen kunne ikke lagres" |
| Conflict detected | Honey yellow | "Endringer fra en annen enhet ble overskrevet" |
| Offline | Sky blue | "Offline" + pending count |
| Syncing | Honey yellow | "Synkroniserer (N)..." |
| Back online | Sage green | "Tilkoblet igjen" |

### Retry Logic

Failed syncs retry up to 3 times with exponential backoff:
- 1st retry: 1 second delay
- 2nd retry: 2 second delay
- 3rd retry: 4 second delay
- After 3 failures: change is dropped and user is notified

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
