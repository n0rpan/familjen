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
- **Kidplan Sync**: Sync messages and photos from kindergarten (barnehage)
- **iSkole Sync**: Sync messages from school (skole) via parent portal
- **MyKid Sync**: Sync newsletters and photos from MyKid kindergarten app
- **Unified Feed**: View all messages, photos, and reminders from all services in one place
- **AI Action Extraction**: Automatically extract tasks/reminders from messages
- **Suggestion Review**: Review AI-suggested tasks before adding to calendar
- **Daily Sync**: Automatic sync at 05:00 UTC + cleanup at 06:00 UTC
- **Photo Gallery**: 1-year retention for kindergarten photos with homepage preview
- **Admin Control**: Enable/disable integrations per household

### Progressive Web App (PWA)
- **Install as App**: Add to home screen for native app experience
- **Push Notifications**: Get notified about pickup assignments
- **Offline Support**: Basic functionality works without internet
- **Pull-to-Refresh**: Native-feel refresh gesture (PWA mode only)
- **View Transitions**: Smooth page transitions with 250ms crossfade
- **Scroll Restoration**: Maintains scroll position on back/forward navigation
- **iOS Optimized**: Dynamic Island and safe area support
- **Auto-Update**: Prompts when new versions are available
- **Adaptive Prefetching**: Respects Data Saver mode and slow connections

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

### CI/CD Environment Variables (GitHub Actions)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | For AI code review, migration review, visual review |
| `OPENROUTER_FAST_MODEL` | Yes | Fast model for migrations (e.g., `google/gemini-2.0-flash-001`) |
| `OPENROUTER_CAPABLE_MODEL` | Yes | Capable model for code review (e.g., `anthropic/claude-sonnet-4.5`) |
| `OPENROUTER_VISION_MODEL` | Yes | Vision model for screenshots (e.g., `google/gemini-2.0-flash-001`) |

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
- `external_integrations` - Spond/Kidplan/iSkole connections (encrypted)
- `external_events` - Synced events from external services
- `external_messages` - Synced messages for AI extraction
- `external_photos` - Kindergarten photos (1-year retention)
- `external_suggestions` - AI-extracted action items pending review

**Other:**
- `shopping_lists` / `shopping_list_items` - Grocery lists
- `wishlists` / `wishlist_items` - Gift wishlists
- `push_subscriptions` - Web push subscriptions

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Home (today overview + photo strip + AI input)
│   ├── uke/               # Week planner
│   │   └── components/    # Modal components (ChildTask, MemberEvent, HouseholdEvent)
│   ├── feed/              # Unified feed (messages, photos, reminders)
│   ├── oppskrifter/       # Recipes
│   ├── handleliste/       # Shopping lists with AI categorization
│   ├── innstillinger/     # Settings (profile, household, integrations)
│   │   └── sections/      # Extracted sections (Children, Members, AI, HouseholdAdmin)
│   ├── admin/             # Admin panel
│   ├── login/             # Authentication
│   ├── ny-husstand/       # Create new household
│   └── api/
│       ├── openrouter/    # AI endpoints
│       ├── calendar/      # Google Calendar
│       ├── integrations/  # Spond, Kidplan, iSkole sync
│       ├── cron/          # Scheduled jobs (sync + photo cleanup)
│       └── push/          # Push notifications
├── components/
│   ├── ai/                # UniversalAIInput
│   ├── feed/              # FeedPage, MessageCard, PhotoGallery, etc.
│   ├── integrations/      # Integration UIs
│   │   ├── shared/        # Shared infrastructure (BaseIntegration, useIntegrationState)
│   │   └── *.tsx          # Spond, Kidplan, iSkole, MyKid components
│   ├── shopping/          # Shopping list components
│   ├── AppShell.tsx       # iOS app shell with pull-to-refresh
│   ├── Header.tsx         # Navigation (4-item mobile: Hjem, Uke, Feed, Mer)
│   ├── WeekGrid.tsx       # Week planner grid
│   ├── TodayOverview.tsx  # Home page today summary
│   └── ...
├── lib/
│   ├── types.ts           # TypeScript interfaces
│   ├── utils.ts           # Helper functions
│   ├── supabase/          # Supabase clients (server/client)
│   ├── i18n/              # Internationalization
│   │   ├── context.tsx    # LanguageProvider, useLanguage
│   │   └── translations/  # nb.ts, sv.ts, en.ts
│   └── integrations/
│       ├── spond/         # Spond API client
│       ├── kidplan/       # Kidplan API client (kindergarten)
│       ├── iskole/        # iSkole API client (school)
│       └── mykid/         # MyKid API client (kindergarten)
├── hooks/                  # Custom React hooks
│   ├── useUndoStack.ts    # Undo/redo with retry
│   ├── useRealtimeSubscription.ts  # Supabase realtime
│   └── ...
└── styles/

tests/                      # Vitest tests
├── setup.ts
├── lib/
└── hooks/

public/
├── manifest.json          # PWA manifest
├── sw.js                  # Service worker
└── icons/                 # App icons
```

## Development

```bash
npm run dev        # Development server
npm run build      # Production build
npm run lint       # TypeScript + ESLint check
npm run test       # Run tests in watch mode
npm run test:run   # Run tests once
npm run test:e2e   # Run Playwright E2E tests

# AI Review Scripts (for local testing)
npm run ai:migration-review   # Review database migrations
npm run ai:code-review        # Review code changes
npm run ai:visual-review      # Compare screenshots
```

### Testing

Tests use Vitest with jsdom for React component testing:

```
tests/
├── setup.ts              # Test setup
├── lib/
│   ├── utils.test.ts     # Date utilities
│   └── ics-parser.test.ts # Calendar parsing
└── hooks/
    └── useUndoStack.test.ts # Undo/redo hook
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
- **Security Headers**: HSTS (1-year), CSP, X-Powered-By disabled
- **Middleware Optimization**: Cookie-based auth check before API calls

## AI-Powered CI/CD

The project uses AI to enhance the CI/CD pipeline beyond traditional static analysis.

### Pipeline Stages

| Stage | Trigger | Purpose |
|-------|---------|---------|
| **Lint + Typecheck** | All pushes/PRs | Fast syntax and type validation |
| **Unit Tests** | After lint | 250+ tests for utilities, hooks, integrations |
| **Build** | After tests | Verify production build succeeds |
| **AI Migration Review** | PRs with migrations | Checks RLS, naming, security, rollback safety |
| **AI Code Review** | All PRs | Reviews diff for security, i18n, data integrity |
| **AI Visual Review** | PRs (optional) | Compares screenshots for UI regressions |

### AI Review Features

- **Structured Outputs**: Uses JSON schemas for guaranteed response format
- **PR Comments**: Posts review summary directly to GitHub PRs
- **Familjen-Aware**: AI understands Norwegian context, child safety, RLS patterns
- **Configurable Models**: Set your preferred OpenRouter models via GitHub Secrets

### Setup

1. Add `OPENROUTER_API_KEY` to GitHub repository secrets
2. (Optional) Add baseline screenshots to `tests/visual/baselines/` for visual review
3. Pipeline runs automatically on PRs

See [CLAUDE.md](./CLAUDE.md) for detailed documentation.

## Contributing

See [CLAUDE.md](./CLAUDE.md) for development guidelines and codebase context.

## License

Private project.
