# Familjen Development Guide

## Project Overview

Norwegian family planning app for managing:
- Daily pickup assignments (who picks up which child)
- Weekly meal planning with recipe storage
- Child tasks (reminders, appointments, bring items)
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
| `/oppskrifter` | Recipe management |
| `/handleliste` | Shopping list |
| `/innstillinger` | Settings - Profile, household, members, children |
| `/admin` | Admin panel - User management, AI settings, calendar |
| `/ny-husstand` | Create new household |

### Components (`src/components/`)

| Component | Purpose |
|-----------|---------|
| `WeekGrid` | Desktop 7-day grid with pickups, events, tasks, meals |
| `TodayOverview` | Today's summary card |
| `DayView` | Single day detail view |
| `MealSelector` | Recipe/custom meal dropdown |
| `AISuggestionModal` | AI meal suggestion interface |
| `Header` | Navigation with user menu |

### Types (`src/lib/types.ts`)

Key interfaces:
- `Household`, `HouseholdMember`, `Child`
- `Pickup`, `PickupWithDetails`
- `Meal`, `MealWithRecipe`, `Recipe`
- `ChildTask`, `ChildTaskWithChild`
- `MemberEvent`
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
npm run dev          # Development server
npm run build        # Production build
npm run lint         # TypeScript + ESLint
npx supabase db push # Push migrations
```

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
├── SpondIntegration.tsx
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
