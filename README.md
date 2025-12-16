# Familjen

Norwegian family planning app for managing daily pickups, meals, and child tasks.

## Features

- **Pickup Management**: Assign who picks up each child daily
- **Meal Planning**: Plan weekly dinners with recipe storage
- **Child Tasks**: Track reminders and appointments per child (bring items, doctor visits, etc.)
- **AI Meal Suggestions**: Get dinner ideas based on preferences and allergies
- **Calendar Integration**: Sync with Google Calendar for work calendar blocking
- **Multi-household Support**: Invite family members to collaborate
- **Multi-language Support**: Norwegian (nb), Swedish (sv), and English (en)

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
| `OPENROUTER_API_KEY` | No | For AI meal suggestions |
| `GOOGLE_CLIENT_ID` | No | For calendar integration |
| `GOOGLE_CLIENT_SECRET` | No | For calendar integration |
| `GOOGLE_REDIRECT_URI` | No | OAuth callback URL |

## Database Migrations

Migrations are in `supabase/migrations/`. Key tables:

- `households` - Family units
- `household_members` - Parents/adults
- `children` - Kids with colors and locations
- `pickups` - Daily pickup assignments
- `meals` - Meal plans linked to recipes
- `recipes` - Stored recipes
- `child_tasks` - Reminders/appointments per child
- `member_events` - Parent calendar events
- `google_calendar_tokens` - OAuth tokens for calendar sync

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
│   ├── innstillinger/  # Settings (includes language switcher)
│   └── api/            # API routes
├── components/         # React components
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
│   └── google-calendar.ts
└── styles/            # Global CSS
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
