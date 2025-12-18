# Spond Integration

TypeScript client for the unofficial Spond API.

## Source Reference

This client is ported from the Python library:
- **Original:** https://github.com/Olen/Spond
- **Version ported from:** 1.1.1 (Feb 2025)
- **API documentation:** https://martcl.github.io/spond/

## API Details

- **Base URL:** `https://api.spond.com/core/v1/`
- **Authentication:** Username/password → Bearer token
- **Chat API:** Separate endpoint and auth token

## Endpoints Implemented

| Endpoint | Method | Our Implementation |
|----------|--------|-------------------|
| `/login` | POST | `SpondClient.login()` |
| `/groups/` | GET | `SpondClient.getGroups()` |
| `/sponds/` | GET | `SpondClient.getEvents()` |
| `/sponds/{uid}` | GET | `SpondClient.getEvent()` |
| `/chat` | POST | `SpondClient.getChatAuth()` |
| `{chatUrl}/chats/` | GET | `SpondClient.getChats()` |

## Usage

```typescript
import { SpondClient } from '@/lib/integrations/spond/client'

const client = new SpondClient()

// Login (required before other calls)
await client.login('email@example.com', 'password')

// Get all groups
const groups = await client.getGroups()

// Get events for next 30 days
const events = await client.getEvents({
  groupId: 'group-uid',
  includeScheduled: true,
  maxEvents: 100,
})

// Get chat messages
const chats = await client.getChats()
```

## If Spond Breaks

1. Check https://github.com/Olen/Spond/issues for known issues
2. Check https://github.com/Olen/Spond/commits for recent fixes
3. Compare our endpoints against the Python library
4. Common issues:
   - Auth token format changes
   - Endpoint URL changes
   - Response schema changes

## Debugging

Set `SPOND_DEBUG=true` environment variable to enable request/response logging.

## Last Verified Working

- **Date:** 2025-12-18
- **Verified by:** Initial implementation

## Key Differences from Python Library

1. **No token persistence** - We re-authenticate each sync session
2. **Retry on 401** - Auto re-login if token becomes invalid
3. **TypeScript types** - Full typing for API responses
4. **Simpler chat handling** - Only fetch messages, no send capability
