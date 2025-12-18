# Familjen

Family planning app for managing daily pickups, meals, tasks, and more. Built for Norwegian, Swedish, and English-speaking families.

## Features

### Core Features
- **Pickup Management**: Assign who picks up each child daily with work calendar integration
- **Meal Planning**: Plan weekly dinners with recipe storage and AI suggestions
- **Child Tasks**: Track reminders and appointments per child (bring items, doctor visits, activities)
- **Household Reminders**: Bills, insurance, car service, and other recurring tasks
- **Shopping Lists**: Manage grocery lists with recipe ingredient integration
- **Wishlists**: Birthday and Christmas wish lists for family members
- **Calendar Integration**: Sync with Google Calendar for work calendar blocking and pickup invites

### Multi-language Support
- **Norwegian (nb)**: Default language
- **Swedish (sv)**: Full translation
- **English (en)**: Full translation
- Language auto-detected from browser, or set manually in settings
- Per-user language preference saved to database

### AI Features
- **AI Meal Suggestions**: Get dinner ideas based on allergies, week context, and existing meals
- **Natural Language Input**: Quick add pickups, meals, and tasks via conversational input
  - "Jeg henter Emma i dag" → Creates pickup assignment
  - "Taco på fredag" → Adds meal to Friday
  - "Husk svømmebriller til Oliver på mandag" → Creates child task
- **Smart Extraction**: AI extracts action items from Spond messages

### External Integrations
- **Spond Sync**: Connect to Spond to sync events from children's activity groups
- **AI Action Extraction**: Automatically extract tasks/reminders from Spond messages
- **Suggestion Review**: Review AI-suggested tasks before adding to calendar
- **Daily Sync**: Automatic sync at 05:00 UTC + manual refresh
- **Admin Control**: Enable/disable integrations per household
- *Coming soon: Kidplan, iSkole*

### Progressive Web App (PWA)
- **Install as App**: Add to home screen for native app experience
- **Push Notifications**: Get notified about pickup assignments
- **Offline Support**: Basic functionality works without internet
- **Pull-to-Refresh**: Native-feel refresh gesture on mobile
- **iOS Optimized**: Dynamic Island and safe area support
- **Auto-Update**: Prompts when new versions are available

### Real-time Collaboration
- **Live Sync**: Changes sync instantly between family members
- **Toast Notifications**: See who changed what in real-time
- **Conflict-free**: Multiple users can edit simultaneously

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Database**: Supabase (PostgreSQL + Auth + RLS + Realtime)
- **Styling**: Tailwind CSS v4
- **Language**: TypeScript (strict)
- **AI**: OpenRouter API (configurable model)
- **Calendar**: Google Calendar API
- **Hosting**: Vercel (with Cron support)

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase account
- (Optional) OpenRouter API key for AI features
- (Optional) Google Cloud project for calendar sync

### Installation

1. Clone and install:
```bash
git clone https://github.com/n0rpan/familjen.git
cd familjen/app
npm install
```

2. Configure environment:
```bash
cp .env.example .env.local
# Edit .env.local with your values
```

3. Set up Supabase:
   - Create a new Supabase project
   - Run migrations via SQL Editor (copy from `supabase/migrations/`)
   - Add yourself to `allowed_emails` table as admin
   - Copy URL and keys to `.env.local`

4. Run development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | For server-side operations |
| `OPENROUTER_API_KEY` | No | For AI features (meal suggestions, message extraction) |
| `GOOGLE_CLIENT_ID` | No | For Google Calendar integration |
| `GOOGLE_CLIENT_SECRET` | No | For Google Calendar integration |
| `GOOGLE_REDIRECT_URI` | No | OAuth callback (e.g., `https://domain.com/api/calendar/callback`) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No | For push notifications |
| `VAPID_PRIVATE_KEY` | No | For push notifications |
| `CRON_SECRET` | No | For Vercel Cron (Spond daily sync) |

### Database Settings

Some settings are stored in the `app_settings` table:
```sql
-- Encryption key for OAuth tokens and integration credentials
INSERT INTO app_settings (key, value)
VALUES ('encryption_key', 'your-32-character-secret-key');

-- AI model (optional, has default)
INSERT INTO app_settings (key, value)
VALUES ('openrouter_model', 'google/gemini-2.0-flash-001');
```

## Database Schema

Key tables in `supabase/migrations/`:

**Core:**
- `households` - Family units with settings
- `household_members` - Adults (parents) with login, work email, allergies
- `children` - Kids with color coding, school/kindergarten, allergies
- `allowed_emails` - Access control for app registration

**Planning:**
- `pickups` - Daily pickup assignments with work calendar sync
- `meals` - Meal plans linked to recipes
- `recipes` - Stored recipes with ingredients
- `child_tasks` - Per-child reminders (bring items, appointments, activities)
- `household_reminders` - Household-level reminders (bills, etc.)

**Calendar & Events:**
- `member_events` - Parent events (work trips, dinners)
- `calendar_events` - Holidays and birthdays
- `google_calendar_tokens` - Encrypted OAuth tokens

**External Integrations:**
- `external_integrations` - Spond/Kidplan connections (encrypted)
- `external_events` - Synced events from external services
- `external_messages` - Synced messages for AI extraction
- `external_suggestions` - AI-extracted action items pending review

**Other:**
- `shopping_lists` / `shopping_list_items` - Grocery lists
- `wishlists` / `wishlist_items` - Gift wishlists
- `push_subscriptions` - Web push subscriptions

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Home (today overview + AI input)
│   ├── uke/               # Week planner
│   ├── oppskrifter/       # Recipes
│   ├── handleliste/       # Shopping lists
│   ├── huskeliste/        # Household reminders
│   ├── innstillinger/     # Settings (profile, household, integrations)
│   ├── admin/             # Admin panel
│   └── api/
│       ├── openrouter/    # AI endpoints
│       ├── calendar/      # Google Calendar
│       ├── integrations/  # Spond sync
│       ├── cron/          # Scheduled jobs
│       └── push/          # Push notifications
├── components/
│   ├── ai/                # UniversalAIInput
│   ├── integrations/      # SpondIntegration, SuggestionReview
│   ├── AppShell.tsx       # iOS app shell
│   ├── Header.tsx         # Navigation
│   ├── WeekGrid.tsx       # Week planner grid
│   └── ...
├── lib/
│   ├── types.ts           # TypeScript interfaces
│   ├── utils.ts           # Helper functions
│   ├── supabase/          # Supabase clients (server/client)
│   ├── i18n/              # Internationalization
│   │   ├── context.tsx    # LanguageProvider, useLanguage
│   │   └── translations/  # nb.ts, sv.ts, en.ts
│   └── integrations/
│       └── spond/         # Spond API client
└── styles/

public/
├── manifest.json          # PWA manifest
├── sw.js                  # Service worker
└── icons/                 # App icons
```

## Development

```bash
npm run dev      # Development server
npm run build    # Production build
npm run lint     # TypeScript + ESLint check
```

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import to Vercel
3. Add environment variables
4. Deploy

Vercel automatically picks up `vercel.json` for cron job configuration.

### Post-Deployment

1. Run all migrations in Supabase SQL Editor
2. Set encryption key in `app_settings` table
3. Add yourself as admin in `allowed_emails`
4. Log out and back in to get admin JWT claims

## Security

- **Row Level Security (RLS)**: All data scoped to household
- **Encrypted credentials**: OAuth tokens and integration passwords encrypted at rest
- **SECURITY DEFINER functions**: For cross-table operations
- **Rate limiting**: On AI and sync endpoints
- **Admin controls**: Per-household feature flags

## Contributing

See [CLAUDE.md](./CLAUDE.md) for development guidelines and codebase context.

## License

Private project.
