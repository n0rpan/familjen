# Familjen

Norwegian family planning app for managing daily pickups, meals, and child tasks.

## Features

### Core Features
- **Pickup Management**: Assign who picks up each child daily
- **Meal Planning**: Plan weekly dinners with recipe storage
- **Child Tasks**: Track reminders and appointments per child (bring items, doctor visits, etc.)
- **Shopping Lists**: Manage grocery lists with recipe integration
- **Calendar Integration**: Sync with Google Calendar for work calendar blocking
- **Multi-household Support**: Invite family members to collaborate
- **Multi-language Support**: Norwegian (nb), Swedish (sv), and English (en)

### AI Features
- **AI Meal Suggestions**: Get dinner ideas based on preferences, allergies, and existing meals
- **Natural Language Input**: Use the AI input box to quickly add pickups, meals, and tasks
  - Example: "Jeg henter Falk i dag" (I'm picking up Falk today)
  - Example: "Taco til middag på fredag" (Tacos for dinner on Friday)

### External Integrations (Spond)
- **Spond Sync**: Connect to Spond to sync events from children's activity groups
- **AI Action Extraction**: Automatically extract tasks and reminders from Spond messages
- **Suggestion Review**: Review AI-suggested tasks before adding them to your calendar
- **Daily Sync**: Automatic sync at 05:00 UTC + manual refresh button
- **Admin Control**: Enable/disable integrations per household from admin panel

### Progressive Web App (PWA)
- **Install as App**: Add to home screen for native app experience
- **Push Notifications**: Get notified about pickup assignments and reminders
- **Offline Support**: Basic functionality works without internet
- **Pull-to-Refresh**: Native-feel refresh gesture on mobile
- **iOS Optimized**: Full support for Dynamic Island and safe areas
- **Auto-Update Prompts**: Get notified when new versions are available

### Mobile Experience
- **iOS App Shell**: Fixed header with proper safe area handling
- **Smooth Scrolling**: Content scrolls independently under fixed header
- **Touch Optimized**: Large touch targets and native-feel interactions
- **Skeleton Loaders**: Smooth loading states throughout the app

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Database**: Supabase (PostgreSQL + Auth + RLS)
- **Styling**: Tailwind CSS v4
- **Language**: TypeScript
- **AI**: OpenRouter API
- **Calendar**: Google Calendar API

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account
- (Optional) OpenRouter API key for AI features
- (Optional) Google Cloud project for calendar sync

### Installation

1. Clone the repository:
```bash
git clone https://github.com/n0rpan/familjen.git
cd familjen
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment example and fill in your values:
```bash
cp .env.example .env.local
```

4. Set up Supabase:
   - Create a new Supabase project
   - Run migrations: `npx supabase db push`
   - Copy URL and anon key to `.env.local`

5. Run development server:
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
| `OPENROUTER_API_KEY` | No | For AI meal suggestions and Spond message extraction |
| `GOOGLE_CLIENT_ID` | No | For calendar integration |
| `GOOGLE_CLIENT_SECRET` | No | For calendar integration |
| `GOOGLE_REDIRECT_URI` | No | OAuth callback URL |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No | For push notifications |
| `VAPID_PRIVATE_KEY` | No | For push notifications |
| `CRON_SECRET` | No | For Vercel Cron (Spond daily sync) |

## Database Migrations

Migrations are in `supabase/migrations/`. Key tables:

- `households` - Family units
- `household_members` - Parents/adults with language preferences
- `children` - Kids with colors, locations, and allergies
- `pickups` - Daily pickup assignments
- `meals` - Meal plans linked to recipes
- `recipes` - Stored recipes with ingredients
- `child_tasks` - Reminders/appointments per child
- `household_reminders` - General household reminders
- `member_events` - Parent calendar events
- `google_calendar_tokens` - OAuth tokens for calendar sync
- `push_subscriptions` - Web push notification subscriptions
- `allowed_emails` - Access control for app registration
- `external_integrations` - Spond/Kidplan/iSkole connections (encrypted credentials)
- `external_events` - Synced events from external services
- `external_messages` - Synced messages for AI extraction
- `external_suggestions` - AI-extracted action items pending review

Run migrations:
```bash
npx supabase db push
```

## Project Structure

```
src/
├── app/                 # Next.js pages
│   ├── page.tsx        # Home (today overview)
│   ├── uke/            # Week planner
│   ├── oppskrifter/    # Recipes
│   ├── handleliste/    # Shopping list
│   ├── huskeliste/     # Reminders list
│   ├── innstillinger/  # Settings (includes language switcher)
│   ├── admin/          # Admin panel
│   └── api/            # API routes
│       ├── openrouter/ # AI endpoints
│       ├── calendar/   # Google Calendar integration
│       └── push/       # Push notification endpoints
├── components/
│   ├── ai/             # AI input components
│   │   └── UniversalAIInput.tsx
│   ├── AppShell.tsx    # iOS app shell with pull-to-refresh
│   ├── Header.tsx      # Navigation with safe area support
│   ├── WeekGrid.tsx    # Week planner grid
│   └── ...
├── lib/
│   ├── types.ts       # TypeScript interfaces
│   ├── utils.ts       # Helper functions
│   ├── config.ts      # App configuration
│   ├── supabase/      # Supabase clients
│   ├── i18n/          # Internationalization
│   │   ├── types.ts        # Language types, TranslationStrings interface
│   │   ├── context.tsx     # LanguageProvider, useLanguage hook
│   │   ├── cookie.ts       # Client-side cookie helpers
│   │   ├── cookie.server.ts # Server-side cookie + browser detection
│   │   └── translations/   # nb.ts, sv.ts, en.ts
│   ├── integrations/  # External service clients
│   │   └── spond/     # Spond API client (ported from Python)
│   └── google-calendar.ts
└── styles/            # Global CSS

public/
├── manifest.json      # PWA manifest
├── sw.js              # Service worker
├── icons/             # App icons (various sizes)
└── apple-touch-icon.png
```

## Development

```bash
# Run dev server
npm run dev

# Build for production
npm run build

# Type check
npm run lint
```

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Environment for Production

Update `GOOGLE_REDIRECT_URI` to your production domain:
```
GOOGLE_REDIRECT_URI=https://your-domain.com/api/calendar/callback
```

## Contributing

See [CLAUDE.md](./CLAUDE.md) for development guidelines and codebase context.

## License

Private project - not open source.
