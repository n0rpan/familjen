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
```

### Vercel Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
ADMIN_EMAIL=your@email.com
OPENROUTER_API_KEY=sk-or-...
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
CALENDAR_ENCRYPTION_KEY=32-char-random-string
```

### Admin Setup
Add yourself to `allowed_emails`:
```sql
INSERT INTO allowed_emails (email, is_admin, can_create_household)
VALUES ('your@email.com', true, true)
ON CONFLICT (email) DO UPDATE SET is_admin = true, can_create_household = true;
```

## Development Commands

```bash
npm run dev          # Development server
npm run build        # Production build
npm run lint         # TypeScript + ESLint
npx supabase db push # Push migrations
```

## Norwegian UI Text

The app uses Norwegian (Bokmål). Key terms:
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
