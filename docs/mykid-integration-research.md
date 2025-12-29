# MyKid.no Integration Research

This document details the MyKid.no API based on HAR file analysis and live verification testing, for implementing an integration similar to the existing Kidplan integration.

## Overview

MyKid.no is a Norwegian kindergarten management platform (barnehagesystem). The API uses:
- Session-based authentication with CSRF tokens
- AJAX endpoints returning HTML fragments or JSON
- JWT-signed URLs for photos (via external CDN)
- WebSocket for real-time notifications

**Base URL:** `https://mykid.no`
**Photo CDN:** `https://media1.intutor.no`

**Status: VERIFIED** - All core endpoints tested and working as of 2025-12-18.

---

## Authentication

### Overview

Authentication is a 3-step process:
1. GET login page to extract CSRF token from hidden input
2. POST login with AJAX headers to get session
3. GET dashboard to extract new CSRF token from meta tag for subsequent requests

### Step 1: Get Login Page

```
GET /nb/logg_inn
```

**Response:** HTML page (~61KB) containing:
- CSRF token in hidden input: `<input type="hidden" name="_csrf_token" value="...">`
- Sets initial cookies: `MYKIDUID`, `uniquebrowserid`, `landingpage_language`

**IMPORTANT:** The login page is `/nb/logg_inn`, NOT `/forside` (which is the public marketing page).

### Step 2: Login POST (AJAX)

```
POST /forside/forside/login
Content-Type: application/x-www-form-urlencoded
Accept: application/json
X-Requested-With: XMLHttpRequest
Origin: https://mykid.no
Referer: https://mykid.no/nb/logg_inn
```

**Request Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `_csrf_token` | string | CSRF token from login page hidden input |
| `pp` | string | Country code: `47` for Norway |
| `m` | string | Mobile phone number (login identifier) |
| `p` | string | Password |

**Success Response:**
```json
{"status":"ok","message":"","link":"/foreldre"}
```

**Error Responses:**
```json
{"status":"bad","message":"CSRF-feil. Prøv å laste siden på nytt."}
{"status":"bad","message":"Feil brukernavn og/eller passord."}
```

**CRITICAL:** The `Accept: application/json` and `X-Requested-With: XMLHttpRequest` headers are REQUIRED. Without them, the server returns CSRF errors even with valid tokens.

**Session Cookie:** Login updates `MYKIDUID` with new session value.

### Step 3: Get Dashboard + CSRF

```
GET /foreldre
Cookie: {session cookies from login}
```

**Response:** HTML page (~96KB) containing:
- New CSRF token in meta tag: `<meta name="_csrf_token" content="...">`
- Child information
- Photo URLs (if available)

**IMPORTANT:** All subsequent AJAX requests must use the CSRF token from the dashboard meta tag, not the login page hidden input.

### Code Example

```typescript
async function login(phone: string, password: string) {
  const cookies = new Map<string, string>()

  // Step 1: Get login page for CSRF
  const loginPage = await fetch('https://mykid.no/nb/logg_inn')
  updateCookies(loginPage.headers, cookies)
  const html = await loginPage.text()
  const loginCsrf = html.match(/name="_csrf_token"\s+value="([^"]+)"/)?.[1]

  // Step 2: POST login with AJAX headers
  const form = new URLSearchParams()
  form.append('_csrf_token', loginCsrf)
  form.append('pp', '47')
  form.append('m', phone)
  form.append('p', password)

  const login = await fetch('https://mykid.no/forside/forside/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': getCookieHeader(cookies),
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: form.toString(),
  })
  updateCookies(login.headers, cookies)

  const result = JSON.parse(await login.text())
  if (result.status !== 'ok') throw new Error(result.message)

  // Step 3: Get dashboard for new CSRF
  const dashboard = await fetch('https://mykid.no/foreldre', {
    headers: { 'Cookie': getCookieHeader(cookies) },
  })
  updateCookies(dashboard.headers, cookies)
  const dashHtml = await dashboard.text()
  const csrf = dashHtml.match(/<meta name="_csrf_token" content="([^"]+)"/)?.[1]

  return { cookies, csrf, dashboardHtml: dashHtml }
}
```

---

## AJAX Requests Pattern

All AJAX endpoints follow this pattern:

```typescript
const response = await fetch(`https://mykid.no${endpoint}`, {
  method: 'POST', // or 'GET' for some endpoints
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cookie': getCookieHeader(cookies),
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://mykid.no/foreldre',
  },
  body: `param1=value1&_csrf=${csrf}`, // CSRF always included
})
```

---

## Verified Endpoints

| Endpoint | Method | Response | Status |
|----------|--------|----------|--------|
| `/_ajax/nyhetsbrev/get_unseen_news` | POST | JSON | VERIFIED |
| `/_ajax/calendar/fetch_calendar_week` | GET | HTML | VERIFIED |
| `/_ajax/dagenmin/show_myday` | POST | HTML | VERIFIED |
| `/_ajax/dagenmin/show_myday_photos` | POST | HTML | VERIFIED |
| `/_ajax/nyhetsbrev/list_news_letters` | POST | HTML | VERIFIED |
| `/_ajax/kommunikasjon/fetch_messages` | POST | HTML | VERIFIED |
| `/_ajax/calendar/fetch_calendar_data` | POST | JSON | VERIFIED |
| `/_ajax/kalender/fetch_attendance_status` | POST | HTML | VERIFIED |
| `/_ajax/infobus/get_topics` | GET | JSON | VERIFIED |

---

## Child Management

### Discovering Child IDs

Child IDs can be extracted from:
1. **InfoBus topics** (most reliable):
```
GET /_ajax/infobus/get_topics?_csrf={csrf}
```
Response:
```json
[
  "general.user.999999.update",
  "parent.bell.123456.update",
  "parent.kid.123456.update",
  "parent.bell.123457.update",
  "parent.kid.123457.update"
]
```
Extract child IDs: `123456`, `123457`

2. **Dashboard HTML** - Look for avatar URLs:
```
/_ajax/image/fetchimage/kid_avatar/123456/50
```

### Switch Active Child

```
GET /_ajax/avdelinger/bytt_barn/{child_id}/foreldre
```

**Response:** 302 redirect (switches session context to specified child)

---

## Calendar (VERIFIED - JSON)

### Get Calendar Data

```
POST /_ajax/calendar/fetch_calendar_data
Content-Type: application/x-www-form-urlencoded
```

**Request Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | string | Start date `YYYY-MM-DD` |
| `to` | string | End date `YYYY-MM-DD` |
| `_csrf` | string | CSRF token |

**Response:** JSON array of events:
```json
[
  {
    "id": "b_554975",
    "fromyear": "2025",
    "frommonth": "12",
    "toyear": "2026",
    "tomonth": "01",
    "bornyear": "2023",
    "birthmont": "06",
    "fornavn": "[Child Name]",
    "event_at": "2026-06-28",
    "title": "[Child Name] 3 år",
    "event_until": null,
    "is_all_day": true,
    "isHolidayEvent": 0,
    "description": null,
    "class": "birthday",
    "icon": "bursdag.png",
    "allow_delete": false,
    "editable": false,
    "sortorder": 1782511200
  }
]
```

**Event Classes:**
- `birthday` - Birthday events
- (others TBD from more data)

---

## Daily Summary ("Dagen Min")

### Get Day Overview

```
POST /_ajax/dagenmin/show_myday
```

**Request Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `date` | string | Date format: `YYYY-MM-DD+00:00:00` (URL encoded) |
| `_csrf` | string | CSRF token |

**Response:** HTML fragment with day's activities, mood, sleep, food, etc.

### Get Day Photos

```
POST /_ajax/dagenmin/show_myday_photos
```

**Request Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `date` | string | Date format: `YYYY-MM-DD+00:00:00` (URL encoded) |
| `_csrf` | string | CSRF token |

**Response:** HTML fragment with photos from that day (may be empty `[]` if no photos)

---

## Newsletter ("Nyhetsbrev")

### Get Unseen News Count (JSON)

```
POST /_ajax/nyhetsbrev/get_unseen_news
```

**Response:**
```json
{"local":"43","su":"0","4":"8"}
```

- `local` - Local newsletters unread count
- `su` - SU (parent council) unread count
- Other keys may represent specific categories

### List Newsletters

```
POST /_ajax/nyhetsbrev/list_news_letters
```

**Request Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `filter[page]` | string | `"alle"` for all |
| `_csrf` | string | CSRF token |

**Response:** HTML fragment with newsletter list. Extract IDs via:
```javascript
onclick="showLocalNews(1977044)"
```

### Get Newsletter Content

```
POST /_ajax/nyhetsbrev/hent_news_letter_local
```

**Request Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `newsid` | number | Newsletter ID |
| `_csrf` | string | CSRF token |

**Response:** HTML fragment with title, date, content, and attachments.

---

## Messages ("Kommunikasjon")

### Fetch Messages Interface

```
POST /_ajax/kommunikasjon/fetch_messages
```

**Request Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `user_id` | string | `"intern_melding"` for internal messages |
| `_csrf` | string | CSRF token |

**Response:** HTML fragment with messaging compose UI. Actual conversation loads separately.

### Get Conversation

```
GET /_ajax/kommunikasjon/get_sms_conversation?_csrf={csrf}
```

**Response:** HTML fragment with conversation history.

---

## Photos

### Photo URL Structure

Photos are served from an external CDN with JWT-signed URLs:

```
https://media1.intutor.no/photo.php?t={JWT_TOKEN}&thumb
```

Remove `&thumb` for full-size image.

### JWT Token Payload (VERIFIED)

```json
{
  "exp": 1734545460,
  "iat": 1734541860,
  "ip": "10.0.0.1",
  "date": "2025-12-17",
  "companyId": "1234",
  "name": "1234_1_3519988863555891755f54dde529f3cb.jpeg"
}
```

**Token Fields:**
| Field | Description |
|-------|-------------|
| `exp` | Expiration timestamp (~1 hour from issue) |
| `iat` | Issued at timestamp |
| `ip` | Client IP address - **TOKEN IS IP-LOCKED** |
| `date` | Photo date |
| `companyId` | Kindergarten ID |
| `name` | Filename: `{companyId}_{type}_{hash}.{ext}` |

### IP-Locked Tokens - Analysis

**The photo JWT tokens include the client's IP address (`ip` field).**

**VERIFIED BEHAVIOR:**
- CDN photos work with JWT URL alone - NO cookies required
- Avatars also work without session cookies (surprisingly!)
- Thumbnail: 79KB, Full size: 864KB - both fetch successfully

**Serverless Strategy (SHOULD WORK):**

If the sync request originates from the server:
1. Server logs into MyKid (JWT tokens generated contain SERVER's IP)
2. Server extracts photo URLs from dashboard HTML
3. Server immediately downloads photos (same IP as JWT)
4. Upload to Supabase Storage

The IP lock is NOT a blocker if:
- Login + photo discovery + photo download happen in the same request
- All from the same serverless function instance

**Token Expiry:**
- Tokens expire in ~1 hour (`exp - iat ≈ 3600s`)
- Photos must be downloaded during sync, not stored as URLs

### Photo Discovery

Photos appear in:
1. **Dashboard HTML** - Recent photos with full URLs
2. **My Day Photos endpoint** - Daily photos
3. **Newsletter content** - Embedded in newsletters

Pattern to find photo URLs:
```javascript
const photoUrls = html.match(/https:\/\/media\d*\.intutor\.no\/photo\.php\?t=[^"'\s&]+/g)
```

### Child Avatar

```
GET /_ajax/image/fetchimage/kid_avatar/{child_id}/{size}
```

**Path Parameters:**
| Parameter | Description |
|-----------|-------------|
| `child_id` | Child ID (e.g., `123456`) |
| `size` | Image size in pixels (e.g., `50`, `200`) |

**Response:** JPEG image binary

**REQUIRES SESSION:** Unlike CDN photos, avatars require session cookies.

### Attachment URLs

Newsletter/message attachments:
```
/_ajax/image/fetchimage/news_att/{attachment_id}/orig
/_ajax/image/fetchimage/attachment/{attachment_id}/orig
```

---

## Real-Time Updates (WebSocket)

### Get Topics

```
GET /_ajax/infobus/get_topics?_csrf={csrf}
```

**Response:**
```json
[
  "general.user.999999.update",
  "parent.bell.123456.update",
  "parent.kid.123456.update",
  "parent.bell.123457.update",
  "parent.kid.123457.update"
]
```

**Topic Pattern:**
- `general.user.{user_id}.update` - General user updates
- `parent.bell.{child_id}.update` - Notification bell for child
- `parent.kid.{child_id}.update` - Child-specific updates

### WebSocket Connection

```
wss://infobus.mykid.no/?t={JWT_TOKEN}
```

**JWT Token (HS512):**
```json
{
  "iss": "mykid.no",
  "aud": "infobus.mykid.no",
  "iat": 1766074576,
  "server": "web",
  "ip": "95.217.105.27",
  "exp": 1766679376,
  "checksum": "ff9fd4fee2a60ac42f816f2d0590f222"
}
```

**Token validity:** ~7 days from issue

---

## Implementation Plan

### Phase 1: Core Integration

1. **MyKidClient class** (`src/lib/integrations/mykid/client.ts`):
   ```typescript
   class MyKidClient {
     // Authentication
     async login(): Promise<void>          // 3-step auth flow

     // Child discovery
     async getChildren(): Promise<MyKidChild[]>  // From InfoBus topics

     // Calendar (JSON)
     async getCalendarEvents(from: Date, to: Date): Promise<MyKidCalendarEvent[]>

     // Newsletters (HTML parsing)
     async getNewsletterList(): Promise<{id: number, title: string, date: string}[]>
     async getNewsletterContent(id: number): Promise<MyKidNewsletter>

     // Photos (from dashboard HTML)
     async getPhotos(): Promise<MyKidPhoto[]>
     async downloadPhoto(url: string): Promise<Buffer>
   }
   ```

2. **Database** (no new tables needed):
   - Credentials: `external_integrations.credentials` (encrypted)
   - Child mappings: `external_integration_members`
   - Newsletters: `external_messages` with `service: 'mykid'`
   - Calendar events: `external_events` with `service: 'mykid'`
   - Photos: `external_photos` with downloaded files in Storage

3. **Sync Route** (`src/app/api/integrations/mykid/sync/route.ts`):
   - Login with stored credentials
   - Fetch and store calendar events (JSON - easy)
   - Fetch and parse newsletter list (HTML)
   - Extract and download photos from dashboard
   - Upload photos to Supabase Storage

### Phase 2: Photos (VERIFIED - Should Work)

Server-side photo download approach:
1. During sync, login creates JWT tokens with SERVER IP
2. Extract photo URLs from dashboard HTML
3. Download photos immediately (same request = same IP)
4. Compress with sharp and upload to Storage
5. Store `external_photos` records with `storage_path`

Pattern matches Kidplan implementation.

### Phase 3: Real-Time (Optional/Future)

WebSocket integration for live updates - lower priority.
Could enable push notifications when new photos/messages arrive.

---

## Comparison with Existing Integrations

| Feature | MyKid | Kidplan | iSkole |
|---------|-------|---------|--------|
| Auth method | Phone + password + AJAX | Email + password | Email + SHA256 hash |
| Session | Cookie + dual CSRF | Cookie (.ASPXAUTH) | Cookie + jsessionid |
| Photo storage | External CDN (IP-locked JWT) | Direct URLs with auth | N/A |
| API style | HTML fragments + some JSON | JSON API | JSON API |
| Calendar | JSON endpoint | Part of board data | JSON endpoint |
| Real-time | WebSocket | Polling | N/A |

---

## Data Types

```typescript
interface MyKidCredentials {
  phone: string      // Login phone number
  password: string   // Password
}

interface MyKidSession {
  cookies: Map<string, string>
  csrf: string       // From dashboard meta tag
}

interface MyKidChild {
  id: number         // e.g., 123456
  name: string       // Parsed from UI
}

interface MyKidCalendarEvent {
  id: string         // e.g., "b_554975"
  event_at: string   // YYYY-MM-DD
  event_until: string | null
  title: string
  description: string | null
  is_all_day: boolean
  isHolidayEvent: number
  class: string      // "birthday", etc.
  icon: string
  editable: boolean
  allow_delete: boolean
}

interface MyKidNewsletter {
  id: number
  title: string
  date: string       // "15.12.2025"
  category: string
  attachments: Array<{
    id: number
    filename: string
    url: string
  }>
}

interface MyKidPhoto {
  url: string        // Full media1.intutor.no URL with JWT
  expiresAt: Date    // From JWT exp
  ipLocked: string   // IP the token is locked to
  childId?: number
}
```

---

## Security Considerations

1. **CSRF Protection:** All endpoints require valid CSRF token
2. **IP Validation:** Photo JWT tokens include client IP
3. **Token Expiry:** Photo tokens expire in ~1 hour
4. **Dual CSRF:** Login page has hidden input, dashboard has meta tag - they're DIFFERENT
5. **AJAX Headers Required:** Login POST requires JSON accept header
6. **Session Handling:** Use cookie jar to maintain session across requests

---

## Known IDs from Testing

| Type | ID | Description |
|------|----|-|
| Child | 123456 | First child |
| Child | 123457 | Second child |
| User | 999999 | Parent user ID |
| Company | 1234 | Kindergarten ID |

---

## Remaining Questions (Updated 2025-12-18)

1. ~~**Photo token generation:**~~ **RESOLVED** - Tokens generated during login contain requester's IP. Server-side sync works when login + download happen in same request.

2. ~~**Newsletter content parsing:**~~ **RESOLVED** - Built HTML parser using regex patterns for `onclick="showLocalNews(ID)"` and date/title extraction.

3. **My Day data structure:** The `show_myday` endpoint returns HTML - need to identify what data points are available (mood, activities, meals, sleep, etc.). Low priority since photos are the main value. **Not implemented** - future enhancement.

4. ~~**Child name discovery:**~~ **RESOLVED** - Parsed from InfoBus topics (`parent.kid.{id}.update`) and dashboard HTML during login.

5. ~~**Multiple children handling:**~~ **RESOLVED** - Data for all children available simultaneously via InfoBus topics. `bytt_barn` endpoint not required.

---

## Implementation Status (2025-12-18)

### Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/integrations/mykid/types.ts` | ~160 | Interfaces, error classes |
| `src/lib/integrations/mykid/client.ts` | ~550 | 3-step auth, all API methods |
| `src/lib/integrations/mykid/index.ts` | ~15 | Exports |
| `src/app/api/integrations/mykid/test-connection/route.ts` | ~100 | Credential validation |
| `src/app/api/integrations/mykid/groups/route.ts` | ~130 | Fetch children for editing |
| `src/app/api/integrations/mykid/sync/route.ts` | ~500 | Full sync (calendar, newsletters, photos) |
| `src/components/integrations/MyKidIntegration.tsx` | ~710 | Settings UI component |

### Files Modified

- `src/app/api/cron/sync-integrations/route.ts` - Added MyKid to cron sync (~180 lines)
- `src/app/innstillinger/page.tsx` - Added MyKid section to settings
- `src/lib/rate-limit.ts` - Added `mykidSync` and `mykidTestConnection` limits

### Features Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| Phone + password authentication | **Done** | 3-step with dual CSRF |
| Calendar events sync | **Done** | JSON API, 90 days ahead |
| Newsletter sync | **Done** | HTML parsing, full content fetch |
| Photo sync | **Done** | Download + sharp compression + storage |
| Child mapping UI | **Done** | Settings page integration |
| Cron sync | **Done** | Calendar + newsletters (photos skipped for speed) |
| Manual sync | **Done** | Includes photo download |

### Verification Scripts

Located in `scripts/mykid-verify/`:
- `quick-test.ts` - Interactive login test
- `working-test.ts` - Full endpoint verification (all 9 endpoints)
- `analyze-data.ts` - Data structure analysis
- `test-photos.ts` - Photo CDN verification

All scripts verified working with real MyKid credentials.
