# Third-Party API Integration Documentation

This document provides comprehensive technical documentation for integrating with Norwegian family-oriented services: Spond (sports clubs), iSkole (schools), Kidplan (kindergartens), and MyKid (kindergartens).

> **Disclaimer**: These are unofficial, reverse-engineered APIs. They may change without notice. Use responsibly and respect rate limits.

---

## Table of Contents

1. [Overview](#overview)
2. [Spond API](#spond-api)
3. [iSkole API](#iskole-api)
4. [Kidplan API](#kidplan-api)
5. [MyKid API](#mykid-api)
6. [Common Patterns](#common-patterns)
7. [Error Handling](#error-handling)

---

## Overview

| Service | Type | Auth Method | Base URL |
|---------|------|-------------|----------|
| Spond | Sports clubs | Email + Password → Bearer token | `https://api.spond.com/core/v1/` |
| iSkole | Schools | National ID + SHA256 password → Session | `https://iskole.net/iskole_forelder/rest/v0/` |
| Kidplan | Kindergartens | Email + Password → ASP.NET cookie | `https://app.kidplan.com/` |
| MyKid | Kindergartens | Phone + Password → CSRF + cookies | `https://mykid.no/` |

### Data Available

| Service | Messages | Events | Photos | Timetable | Absences |
|---------|----------|--------|--------|-----------|----------|
| Spond | Posts + Chats | Calendar events | - | - | - |
| iSkole | School messages | School calendar | - | Full timetable | Absence records |
| Kidplan | Board + Conversations | - | Album photos | - | - |
| MyKid | Newsletters | Calendar + birthdays | Gallery photos | - | - |

### Quick Start Decision Tree

```
Need sports club data? → Spond (easiest API)
Need school data? → iSkole (complex auth, but comprehensive)
Need kindergarten data?
  → Check which service the kindergarten uses
  → Kidplan: simpler, good for board posts
  → MyKid: more complex, but has photos + calendar
```

---

## Spond API

Spond is a Norwegian sports team management platform. **This is the cleanest API** - well-structured JSON, simple auth, good error messages.

### Authentication

**Endpoint:** `POST /login`

```typescript
// Request
POST https://api.spond.com/core/v1/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secret"
}

// Response
{
  "loginToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Use the returned `loginToken` as a Bearer token for all subsequent requests:

```
Authorization: Bearer {loginToken}
```

### Endpoints

#### Get Groups

Returns all groups (teams) the user belongs to.

```typescript
GET /groups/

// Response: SpondGroup[]
[
  {
    "id": "ABC123",
    "name": "Fotball U12",
    "description": "Under 12 football team",
    "imageUrl": "https://...",
    "members": [...],
    "subGroups": [...]
  }
]
```

#### Get Single Group

```typescript
GET /groups/{groupId}

// Response: SpondGroup
```

#### Get Events (Sponds)

Events are called "sponds" internally.

```typescript
GET /sponds/?groupId={id}&scheduled=true&max=100&minEndTimestamp=2024-01-01T00:00:00.000Z

// Query Parameters
groupId?: string           // Filter by group
scheduled?: boolean        // Include recurring events (default: true)
max?: number              // Max results (default: 100)
minEndTimestamp?: string  // ISO date - events ending after this
maxStartTimestamp?: string // ISO date - events starting before this

// Response: SpondEvent[]
[
  {
    "id": "event123",
    "heading": "Training Session",
    "description": "Weekly practice",
    "type": "EVENT",
    "startTimestamp": "2024-12-20T17:00:00.000Z",
    "endTimestamp": "2024-12-20T18:30:00.000Z",
    "cancelled": false,
    "location": {
      "id": "loc1",
      "feature": "Main Field",
      "address": "Sportsveien 1, Oslo",
      "latitude": 59.9139,
      "longitude": 10.7522
    },
    "responses": {
      "acceptedIds": ["member1", "member2"],
      "declinedIds": ["member3"],
      "unansweredIds": ["member4"],
      "waitinglistIds": [],
      "unconfirmedIds": []
    }
  }
]
```

#### Get Single Event

```typescript
GET /sponds/{eventId}

// Response: SpondEvent
```

#### Get Posts (Innlegg)

Wall posts and announcements.

```typescript
GET /posts?type=PLAIN&groupId={id}&includeComments=true&max=100

// Query Parameters
type: "PLAIN"
groupId?: string
subGroupId?: string
includeComments?: boolean
includeReadStatus?: boolean
includeSeenCount?: boolean
max?: number
maxTimestamp?: string  // For pagination

// Response: SpondPost[]
[
  {
    "id": "post123",
    "body": "Important announcement about...",
    "timestamp": "2024-12-15T10:00:00.000Z",
    "createdTime": "2024-12-15T10:00:00.000Z",
    "author": {
      "id": "author1",
      "firstName": "John",
      "lastName": "Coach",
      "imageUrl": "https://..."
    },
    "group": {
      "id": "group1",
      "name": "Team A"
    },
    "subGroup": {
      "id": "sub1",
      "name": "Coaches"
    },
    "comments": [...],
    "readStatus": true,
    "seenCount": 15
  }
]
```

#### Get Chats

Chat requires separate authentication - **this is a different API endpoint**.

```typescript
// Step 1: Initialize chat auth
POST /chat
Authorization: Bearer {loginToken}

// Response
{
  "url": "https://chat.spond.com/v1/",
  "auth": "chat-specific-token"
}

// Step 2: Get chats (NOTE: different base URL!)
GET {chatUrl}/chats/?max=100
auth: {chatAuth}  // Custom header named "auth", NOT "Authorization"

// Response: SpondChat[]
[
  {
    "id": "chat123",
    "groupId": "group1",
    "type": "group",
    "name": "Team Chat",
    "imageUrl": "https://...",
    "unread": 5,
    "latestMessage": {...}
  }
]

// Step 3: Get messages
GET {chatUrl}/chats/{chatId}/messages?max=50
auth: {chatAuth}

// Response: SpondMessage[]
[
  {
    "chatId": "chat123",
    "msgNum": 1,
    "text": "Hello team!",
    "timestamp": "2024-12-15T10:00:00.000Z",
    "type": "text",
    "clubMessage": false,
    "sender": {
      "id": "user1",
      "firstName": "John",
      "lastName": "Doe",
      "imageUrl": "https://..."
    },
    "reactions": []
  }
]
```

### Types

```typescript
interface SpondGroup {
  id: string
  name: string
  description?: string
  imageUrl?: string
  members?: SpondGroupMember[]
  subGroups?: SpondSubGroup[]
  createdTime?: string
}

interface SpondEvent {
  id: string
  heading: string
  description?: string
  type?: string  // 'EVENT', 'RECURRING'
  startTimestamp: string
  endTimestamp?: string
  cancelled?: boolean
  location?: {
    id?: string
    feature?: string
    address?: string
    latitude?: number
    longitude?: number
  }
  responses?: {
    acceptedIds?: string[]
    declinedIds?: string[]
    unansweredIds?: string[]
    waitinglistIds?: string[]
    unconfirmedIds?: string[]
  }
  tasks?: SpondTask[]
  comments?: SpondComment[]
}

interface SpondPost {
  id: string
  body?: string
  timestamp?: string
  createdTime?: string
  author?: {
    id: string
    firstName: string
    lastName: string
    imageUrl?: string
  }
  group?: { id: string; name: string }
  subGroup?: { id: string; name: string }
  comments?: SpondComment[]
  readStatus?: boolean
  seenCount?: number
}

interface SpondMessage {
  chatId: string
  msgNum: number
  text: string
  timestamp: string
  type?: string
  clubMessage?: boolean
  sender?: {
    id: string
    firstName: string
    lastName: string
    imageUrl?: string
  }
  reactions?: unknown[]
}
```

### Lessons Learned & Gotchas

#### 1. Chat uses a completely different auth system
The chat API lives on a different domain and uses a custom `auth` header (not Bearer token). You must call `POST /chat` first to get the chat URL and auth token.

```typescript
// WRONG - this won't work
GET https://api.spond.com/core/v1/chats/
Authorization: Bearer {loginToken}

// RIGHT - use the chat-specific endpoint
const { url, auth } = await fetch('/chat', { method: 'POST', ... })
GET {url}/chats/
auth: {auth}  // Custom header
```

#### 2. Messages don't have unique IDs
Messages are identified by `chatId + msgNum`, not a single ID. When storing messages:

```typescript
const uniqueId = `${message.chatId}_${message.msgNum}`
```

#### 3. Posts vs Messages - they're different!
- **Posts** (`/posts`) = Wall announcements visible to group
- **Messages** (`/chats/{id}/messages`) = Private/group chat messages

#### 4. Token expiration
The login token eventually expires. When you get a 401:
1. Clear the old token
2. Re-authenticate with stored credentials
3. Retry the request

#### 5. Events are called "Sponds"
The API endpoint is `/sponds/`, not `/events/`. The naming comes from the app's core concept.

### Reference Implementation

Based on the unofficial Python library: https://github.com/Olen/Spond

---

## iSkole API

iSkole is a Norwegian school administration system using Oracle ADF REST APIs. **Most complex authentication** but provides the most comprehensive school data.

### Authentication

iSkole uses a **4-step** authentication flow with SHA256 password hashing.

```typescript
import { createHash } from 'crypto'

// Step 1: Hash the password (REQUIRED - plain text will fail)
const passwordHash = createHash('sha256').update(password).digest('hex')

// Step 2: Validate credentials
POST https://iskole.net/iskole_forelder/rest/v0/VoValidateUserCredentials
Content-Type: application/vnd.oracle.adf.action+json

{
  "name": "validateUserCredentials",
  "parameters": [
    { "username": "12345678901" },  // Fødselsnummer (11-digit national ID)
    { "password": "a1b2c3d4e5f6..." }  // SHA256 hash, NOT plain text
  ]
}

// Response (JSON string inside result field - must parse twice!)
{
  "result": "[{\"ret_code\":12345,\"navn\":\"Parent Name\",\"tofaktor\":\"0\",\"error_text\":null}]"
}
// ret_code = personId if positive, error code if negative
// tofaktor = "1" means 2FA required (not supported)
// error_text = "null" (string) on success, error message on failure

// Step 3: Establish session with FormData
POST https://iskole.net/iskole_forelder/login/login/{personId}
Content-Type: multipart/form-data

password={passwordHash}&tofaktorkode=

// Collect ALL cookies from Set-Cookie headers

// Step 4: Get session token (jsessionid)
POST https://iskole.net/iskole_forelder/rest/v0/VoUserData
Content-Type: application/vnd.oracle.adf.action+json
Cookie: {all collected cookies}

{
  "name": "validateJsessionId"
}

// Response
{
  "result": "[{\"fullname\":\"Name\",\"personid\":\"12345\",\"jsessionid\":\"abc123\",\"security_level\":\"1\",\"antall_barn\":\"2\"}]"
}
```

After authentication, **include jsessionid in the URL path** (not as a query param or header):
```
/rest/v0/VoEndpoint;jsessionid={jsessionid}?query=params
```

### Endpoints

#### Get Children

```typescript
GET /VoBarn;jsessionid={jsessionid}?onlyData=true&fields=Id,Fylkeid,Skoleid,Planperi,Elevnr,Elev,Klasse,Skolenavn,Bilde,Logo,AntallMeldinger

// Response
{
  "items": [
    {
      "Id": 123,
      "Fylkeid": "03",           // County ID
      "Skoleid": "001",          // School ID
      "Planperi": "2025-26",     // School year (format varies)
      "Elevnr": 456,             // Student number - use this for other requests
      "Elev": "Child Name",
      "Klasse": "1A",
      "Skolenavn": "School Name",
      "Bilde": "base64...",      // Child photo (base64)
      "Logo": "base64...",       // School logo (base64)
      "AntallMeldinger": 3       // Unread message count
    }
  ],
  "totalResults": 1,
  "count": 1,
  "hasMore": false,
  "limit": 25,
  "offset": 0
}
```

#### Get Messages

**Important:** Messages are fetched for ALL children at once using `elevnr=0`. Each message includes an `Elevnr` field to identify which child it belongs to.

```typescript
GET /VoPostkasse;jsessionid={jsessionid}?finder=RESTFilter;mappeid=INB,elevnr=0&fields=Meldingid,Mottatt,Apnet,Emne,Lname,Fname,Epost,Tekst,PersonidMottaker,Elevnr,Elevnavn&onlyData=true&limit=50&offset=0&totalResults=true

// Note: elevnr=0 returns messages for ALL children
// Each message includes Elevnr field to identify the child

// Response
{
  "items": [
    {
      "Meldingid": 789,
      "Mottatt": "2024-12-15T10:00:00.000Z",
      "Apnet": "2024-12-15T11:00:00.000Z",  // When opened (null if unread)
      "Emne": "Message Subject",
      "Fname": "Teacher",
      "Lname": "Name",
      "Epost": "teacher@school.no",
      "Tekst": "<p>HTML message content...</p>",
      "PersonidMottaker": 12345,
      "Elevnr": 456,              // Which child this message is for
      "Elevnavn": "Child Name"
    }
  ],
  "totalResults": 100,
  "hasMore": true
}
```

#### Get Timetable

```typescript
GET /VoTimeplan_elev;jsessionid={jsessionid}?finder=RESTFilter;fylkeid={fylkeid},planperi={planperi},skoleid={skoleid},elevnr={elevnr},startDate=20241215,endDate=20241222&onlyData=true&limit=500

// Date format: YYYYMMDD (no dashes!)

// Response
{
  "items": [
    {
      "Id": "unique-id",
      "Dato": "20241216",
      "Timenr": 1,
      "Fradato": "2024-12-16T08:30:00.000Z",
      "Tildato": "2024-12-16T09:15:00.000Z",
      "Fag": "NOR",
      "Fagnavn": "Norsk",
      "Skoletype": "SD",         // SD = School Day
      "Romnr": "101",
      "Kode": "NOR101",
      "Faglaerer": "Teacher Name",
      "ProviderId": "provider1",
      "Fravaer": null,           // Absence info if any
      "Merknad": null,           // Notes
      "Egenmelding": "Nei",      // Self-reported: "Ja" or "Nei"
      "Dokumentert": "Nei",      // Documented: "Ja" or "Nei"
      "Tidssone": "Europe/Oslo",
      "Timetype": "TIME"
    }
  ]
}
```

#### Get Absences

```typescript
GET /VoFravaer_alt;jsessionid={jsessionid}?finder=RESTFilter;fylkeid={fylkeid},planperi={planperi},skoleid={skoleid},elevnr={elevnr}&onlyData=true&limit=500

// Response
{
  "items": [
    {
      "Id": "absence-id",
      "Sortering": 1,
      "Dato": "2024-12-10T00:00:00.000Z",
      "Timenr": 1,
      "StartKl": "08:30",
      "SluttKl": "09:15",
      "Minutter": 45,
      "Fag": "MAT",
      "Typefravaer": "D",        // D = day, T = time
      "RegistrertDok": null,
      "Dokumentasjonstypeid": null,
      "Dokumentasjonstypetekst": null,
      "Merknad": "Sick",
      "RegistrertEgenm": null,
      "RegistrertEgenmJaNei": "Nei",
      "RegistrertDokJaNei": "Nei"
    }
  ]
}
```

#### Get School Calendar

Uses a different base path (`iskole_elev` instead of `iskole_forelder`).

```typescript
GET https://iskole.net/iskole_elev/rest/v0/VoSkolerute_maaned;jsessionid={jsessionid}?finder=RESTFilter;fylkeid={fylkeid},planperi={planperi},skoleid={skoleid},maaned=12&onlyData=true&limit=50

// Response - returns WEEKLY structure, not daily!
{
  "items": [
    {
      "Dato": "20241223",        // First day of the week
      "Uke": "52",               // Week number
      "Mandag": "Juleferie",     // Monday label
      "Tirsdag": "Juleferie",    // Tuesday label
      "Onsdag": null,
      "Torsdag": null,
      "Fredag": null,
      "Lordag": null,
      "Sondag": null,
      "SkoletypeMandag": "FD",   // FD = Day Off
      "SkoletypeTirsdag": "FD",
      "SkoletypeOnsdag": "FD",
      "SkoletypeTorsdag": "FD",
      "SkoletypeFredag": "FD",
      "SkoletypeLordag": null,
      "SkoletypeSondag": null
    }
  ]
}

// Day type codes:
// SD = School Day
// FD = Free Day (day off)
// PD = Planning Day
```

### Types

```typescript
interface ISkoleChild {
  Id: number
  Fylkeid: string      // County ID - needed for all other requests
  Skoleid: string      // School ID - needed for all other requests
  Planperi: string     // School year (e.g., "2025-26")
  Elevnr: number       // Student number - needed for all other requests
  Elev: string         // Child name
  Klasse: string       // Class
  Skolenavn: string    // School name
  Bilde: string | null // Photo (base64)
  Logo: string | null  // School logo (base64)
  AntallMeldinger: number
}

interface ISkoleMessage {
  Meldingid: number
  Mottatt: string      // ISO timestamp
  Apnet: string | null // When opened
  Emne: string         // Subject
  Fname: string        // Sender first name
  Lname: string        // Sender last name
  Epost: string | null // Sender email
  Tekst: string        // HTML content
  PersonidMottaker: number
  Elevnr: number
  Elevnavn: string
}

interface ISkoleTimeplanEntry {
  Id: string
  Dato: string         // YYYYMMDD
  Timenr: number       // Period number
  Fradato: string      // Start time ISO
  Tildato: string      // End time ISO
  Fag: string          // Subject code
  Fagnavn: string      // Subject name
  Skoletype: string    // "SD", "FD", "PD"
  Romnr: string        // Room
  Kode: string
  Faglaerer: string    // Teacher
  ProviderId: string
  Fravaer: string | null
  Merknad: string | null
  Egenmelding: string  // "Ja" or "Nei"
  Dokumentert: string
  Tidssone: string
  Timetype: string     // "TIME"
}

interface ISkoleSchoolCalendarDay {
  Dato: string         // YYYYMMDD (first day of week)
  Uke: string          // Week number
  Mandag: string | null
  Tirsdag: string | null
  Onsdag: string | null
  Torsdag: string | null
  Fredag: string | null
  Lordag: string | null
  Sondag: string | null
  SkoletypeMandag: string | null  // "SD", "FD", "PD"
  SkoletypeTirsdag: string | null
  SkoletypeOnsdag: string | null
  SkoletypeTorsdag: string | null
  SkoletypeFredag: string | null
  SkoletypeLordag: string | null
  SkoletypeSondag: string | null
}
```

### Lessons Learned & Gotchas

#### 1. Password MUST be SHA256 hashed
Plain text passwords will fail silently or return cryptic errors.

```typescript
// WRONG
{ "password": "mypassword" }

// RIGHT
import { createHash } from 'crypto'
const hash = createHash('sha256').update('mypassword').digest('hex')
{ "password": hash }
```

#### 2. Response is JSON inside JSON
The API returns `{ "result": "[{...}]" }` - a JSON string inside the result field. You must parse twice:

```typescript
const response = await fetch(...)
const data = await response.json()
const results = JSON.parse(data.result)  // Parse the string!
const firstResult = results[0]
```

#### 3. error_text can be the string "null"
On success, `error_text` is literally the string `"null"`, not `null`. Check explicitly:

```typescript
const hasError = result.ret_code < 0 ||
  (result.error_text && result.error_text !== 'null')
```

#### 4. jsessionid goes IN the URL path
Not as a query parameter, not as a header - it's embedded in the path:

```typescript
// WRONG
GET /VoBarn?jsessionid=abc123

// WRONG
GET /VoBarn
Cookie: JSESSIONID=abc123

// RIGHT
GET /VoBarn;jsessionid=abc123?onlyData=true
```

#### 5. Messages don't need per-child context
Unlike timetable and absences, messages use `elevnr=0` to fetch all children's messages at once:

```typescript
// Messages: fetch all at once, filter by Elevnr in response
const messages = await getMessages(100, 0)  // limit, offset
for (const msg of messages) {
  const childElevnr = msg.Elevnr  // Identifies which child
}

// Timetable/Absences: still need per-child context
const children = await getChildren()
const child = children[0]
const timetable = await getTimetable(
  child.Elevnr, child.Fylkeid, child.Planperi, child.Skoleid,
  '20241215', '20241222'
)
```

#### 6. Date format is YYYYMMDD without dashes
```typescript
// WRONG
startDate=2024-12-15

// RIGHT
startDate=20241215
```

#### 7. School calendar uses different base path
Most endpoints use `iskole_forelder`, but school calendar uses `iskole_elev`:

```typescript
// Parent endpoints
https://iskole.net/iskole_forelder/rest/v0/VoBarn

// School calendar (student endpoint)
https://iskole.net/iskole_elev/rest/v0/VoSkolerute_maaned
```

#### 8. 2FA accounts won't work
If `tofaktor === "1"` in the validation response, the account requires 2FA which we can't support.

#### 9. Collect ALL cookies
The login flow sets multiple cookies across multiple requests. Use `getSetCookie()` (Node 18+) or parse the `set-cookie` header carefully.

---

## Kidplan API

Kidplan is a kindergarten communication platform using ASP.NET. **Simpler than MyKid** but uses Microsoft-specific patterns.

### Authentication

Kidplan uses a 2-step authentication:

```typescript
// Step 1: Get available kindergartens (credentials in URL - not great, but that's their API)
GET https://app.kidplan.com/Account/GetKinderGartenIds?username={email}&password={password}

// Response: KidplanKindergarten[]
[
  {
    "Id": 123,
    "Name": "Sunshine Kindergarten",
    "UserIsActive": true,
    "InactiveUserInformation": ""
  }
]

// Check UserIsActive! Inactive users can't login.

// Step 2: Login to specific kindergarten
POST https://app.kidplan.com/LogOn?kid={kindergartenId}
Content-Type: application/x-www-form-urlencoded

UserName={email}&Password={password}&RememberMe=true&RememberMe=false

// Yes, RememberMe appears twice - that's how the form works

// Look for .ASPXAUTH in Set-Cookie header - this is your session
```

### Endpoints

All endpoints require the `.ASPXAUTH` cookie.

#### Get Children

```typescript
POST /ChildPage/GetChildrenInfo/
Content-Type: application/json
Cookie: .ASPXAUTH={cookie}

// No body needed

// Response
{
  "ChildList": [
    {
      "ChildId": 456,
      "Firstname": "Child",
      "Lastname": "Name",
      "Name": "Child Name",
      "unitName": "Ladybugs",
      "PictureId": "guid-here",
      "Birthdate": "/Date(1677754800000)/",  // Microsoft JSON date!
      "StartDate": "/Date(...)/",
      "EndDate": "/Date(...)/",
      "MaxSleepTime": 120,
      "NoSleep": false,
      "Note": "Allergic to nuts",
      "ImagePath": "/some/path",
      "NextOfKins": [
        {
          "NokId": 789,
          "FirstName": "Parent",
          "LastName": "Name",
          "Name": "Parent Name",
          "Street": "Street 1",
          "PONumber": "0123",
          "PO": "Oslo",
          "Email": "parent@example.com",
          "Note": "",
          "VisibleToOtherNextOfKins": true,
          "CommitteeMember": false,
          "HasPermitAnswerRights": true,
          "KinTypeEnum": 2,
          "KinType": "Mor",
          "Phone": "+4712345678",
          "FormattedPhone": "123 45 678",
          "DefaultRegion": "NO"
        }
      ]
    }
  ]
}
```

#### Get Board Posts (Tavla)

```typescript
// First, set unit predicate (required before getting posts)
GET /Board/SetUnitPredicateListAsSingle/?unitId=-1
Cookie: .ASPXAUTH={cookie}

// Then get posts
POST /Board/GetBoardPosts/
Content-Type: application/json
Cookie: .ASPXAUTH={cookie}

{"groupId": -1}

// Response
{
  "KindergartenName": "Sunshine",
  "BoardPosts": [
    {
      "PostId": 123,
      "Title": "Weekly Update",
      "Content": "This week we...",
      "Created": "/Date(1702634400000)/",
      "UnitName": "Ladybugs",
      "AuthorName": "Teacher Name"
    }
  ],
  "LatestPictures": [
    {
      "PictureId": "abc-123.jpeg",
      "AlbumId": 45,
      "AlbumName": "December Activities",
      "Created": "/Date(1702634400000)/",
      "UnitName": "Ladybugs"
    }
  ],
  "MorePostsAvaliable": true,  // Note: typo is in their API
  "OldestItemDate": "/Date(...)/",
  "LastSeenDateTime": "/Date(...)/",
  "UserIsEmployee": false
}
```

#### Get Conversations

```typescript
GET /Conversation/GetConversations/?take=20&skip=0
Cookie: .ASPXAUTH={cookie}

// Response: KidplanConversation[]
[
  {
    "ConversationId": 123,
    "Updated": "/Date(...)/",
    "Participants": [
      { "Id": 1, "Name": "Teacher" },
      { "Id": 2, "Name": "Parent" }
    ],
    "ParticipantsAsString": "Teacher, Parent",
    "LastMessage": "Thanks for the update...",
    "LastMessageDate": "/Date(1702634400000)/",
    "MessageCount": 5
  }
]

// Get messages in conversation
GET /Conversation/GetMessages/?conversationId={id}&take=20&skip=0
Cookie: .ASPXAUTH={cookie}

// Response: KidplanMessage[]
[
  {
    "MessageId": 456,
    "ConversationId": 123,
    "SenderId": 1,
    "SenderName": "Teacher Name",
    "Body": "Hello, just wanted to let you know...",
    "Created": "/Date(1702634400000)/"
  }
]
```

#### Get Unread Count

```typescript
GET /conversation/GetUnreadMessageCount/
Cookie: .ASPXAUTH={cookie}

// Response: number
5
```

#### Get Daily Log

```typescript
POST /Information/GetStatusesFromChild/
Content-Type: application/json
Cookie: .ASPXAUTH={cookie}

{"_childId": 456, "year": 2024, "month": 12}

// Response
{
  "Children": [...],
  "Days": [
    {
      "Date": "/Date(...)/",
      "Status": "Present",
      "Sleep": "1h 30m",
      "Meals": "Good appetite",
      "Activities": "Played outside",
      "Notes": "Had a great day!"
    }
  ],
  "WeekNumbers": [49, 50, 51, 52]
}
```

#### Get Photos

Photos are served from a separate CDN.

```typescript
// Get latest photos page (HTML)
GET /bilder/nyeste-bilder
Cookie: .ASPXAUTH={cookie}

// Parse HTML for image URLs:
// https://img.kidplan.com/albumpicture/?id={uuid}.jpeg&token={token}

// Fetch photo (no cookies needed - token is auth)
GET https://img.kidplan.com/albumpicture/?id={id}&token={token}
```

### Types

```typescript
interface KidplanChild {
  ChildId: number
  Firstname: string
  Lastname: string
  Name: string
  unitName: string
  PictureId?: string
  Birthdate: string      // Microsoft JSON: /Date(1234567890000)/
  StartDate: string
  EndDate: string
  MaxSleepTime: number
  NoSleep: boolean
  Note?: string
  ImagePath?: string
  NextOfKins: KidplanNextOfKin[]
}

interface KidplanNextOfKin {
  NokId: number
  FirstName: string
  LastName: string
  Name: string
  Street?: string
  PONumber?: string
  PO?: string
  Email?: string
  Note?: string
  VisibleToOtherNextOfKins: boolean
  CommitteeMember: boolean
  HasPermitAnswerRights: boolean
  KinTypeEnum: number    // 1 = Far, 2 = Mor
  KinType: string        // "Far", "Mor", etc.
  Phone?: string
  FormattedPhone?: string
  DefaultRegion?: string
}

interface KidplanBoardPost {
  PostId: number
  Title: string
  Content: string
  Created: string        // Microsoft JSON date
  UnitName: string
  AuthorName: string
}

interface KidplanMessage {
  MessageId: number
  ConversationId: number
  SenderId: number
  SenderName: string
  Body: string
  Created: string
}

// Parse Microsoft JSON dates
function parseMicrosoftDate(dateStr: string): Date | null {
  const match = dateStr.match(/\/Date\((-?\d+)\)\//)
  if (match) {
    return new Date(parseInt(match[1]))
  }
  return null
}
```

### Lessons Learned & Gotchas

#### 1. Microsoft JSON date format
Dates come as `/Date(1234567890000)/` - that's milliseconds since epoch wrapped in a string:

```typescript
function parseMicrosoftDate(dateStr: string): Date | null {
  const match = dateStr.match(/\/Date\((-?\d+)\)\//)
  return match ? new Date(parseInt(match[1])) : null
}
```

#### 2. Must set unit predicate before getting board posts
Without calling `SetUnitPredicateListAsSingle` first, `GetBoardPosts` may return empty or wrong data.

#### 3. Photo tokens expire quickly
Get the photo URLs and download immediately. Don't store URLs for later - store the actual images.

#### 4. 302 redirect = session expired
If you get a 302 response, your session cookie is invalid. Re-authenticate.

#### 5. RememberMe appears twice in login form
The form sends `RememberMe=true&RememberMe=false`. This is how ASP.NET checkbox binding works.

#### 6. "MorePostsAvaliable" typo
Yes, it's misspelled in the API. Use it as-is:

```typescript
if (response.MorePostsAvaliable) {  // sic
  // fetch more
}
```

#### 7. Cookie extraction in serverless environments
Use `getSetCookie()` (Node 18+) or carefully parse the `set-cookie` header. The cookie may be split across multiple headers.

```typescript
// Modern approach (Node 18+)
const setCookies = response.headers.getSetCookie?.() || []

// Fallback
const singleCookie = response.headers.get('set-cookie')
```

---

## MyKid API

MyKid.no is a kindergarten communication platform. **Most complex authentication** with dual CSRF tokens and IP-locked photos.

### Authentication

MyKid requires a **3-step** authentication with CSRF token handling.

```typescript
// Step 1: Get login page for CSRF token
GET https://mykid.no/nb/logg_inn

// Extract CSRF from hidden input:
// <input type="hidden" name="_csrf_token" value="...">
const loginCsrf = html.match(/name="_csrf_token"\s+value="([^"]+)"/)?.[1]

// Collect cookies from response

// Step 2: POST login with AJAX headers (CRITICAL!)
POST https://mykid.no/forside/forside/login
Content-Type: application/x-www-form-urlencoded
Cookie: {collected cookies}
Accept: application/json              // REQUIRED - without this you get CSRF error!
X-Requested-With: XMLHttpRequest      // REQUIRED - identifies as AJAX!
Origin: https://mykid.no
Referer: https://mykid.no/nb/logg_inn

_csrf_token={loginCsrf}&pp=47&m={phone}&p={password}

// pp=47 is Norway country code
// m = mobile phone number
// p = password

// Response (if Accept header is correct)
{
  "status": "ok",
  "link": "/foreldre"
}

// Step 3: Get dashboard for NEW CSRF token (different from login!)
GET https://mykid.no/foreldre
Cookie: {updated cookies}

// Extract CSRF from META tag (not hidden input!):
// <meta name="_csrf_token" content="...">
const dashboardCsrf = html.match(/<meta\s+name="_csrf_token"\s+content="([^"]+)"/)?.[1]

// This dashboardCsrf is used for ALL subsequent requests
```

### Endpoints

All AJAX requests need these headers:
```typescript
headers: {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Cookie': cookies,
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://mykid.no/foreldre'
}
```

#### Get Children (via InfoBus Topics)

Children are discovered from real-time notification topics:

```typescript
GET /_ajax/infobus/get_topics?_csrf={csrf}

// Response: string[]
[
  "parent.kid.123456.update",
  "parent.kid.789012.update",
  "general.user.bell.update"
]

// Extract child IDs:
const childIds = topics
  .map(t => t.match(/parent\.kid\.(\d+)\.update/))
  .filter(Boolean)
  .map(m => parseInt(m[1]))
```

Names must be extracted from dashboard HTML or newsletter page.

#### Get Calendar Events

This endpoint returns **clean JSON** (rare for MyKid!):

```typescript
POST /_ajax/calendar/fetch_calendar_data
Content-Type: application/x-www-form-urlencoded

from=2024-12-01&to=2024-12-31&_csrf={csrf}

// Response: MyKidCalendarEvent[]
[
  {
    "id": "b_554975",
    "event_at": "2024-12-20",
    "event_until": null,
    "title": "Birthday: Emma",
    "description": null,
    "is_all_day": true,
    "isHolidayEvent": 0,
    "class": "birthday",
    "icon": "bursdag.png",
    "editable": false,
    "allow_delete": false,
    "fornavn": "Emma",        // First name (for birthdays)
    "sortorder": 1
  }
]
```

#### Get Unseen Counts

```typescript
POST /_ajax/nyhetsbrev/get_unseen_news
Content-Type: application/x-www-form-urlencoded

_csrf={csrf}

// Response
{
  "local": "3",      // Local newsletters
  "su": "1",         // SU (parent council)
  "category1": "2"   // Other categories
}
// Note: values are strings, not numbers
```

#### Get Newsletters

```typescript
// Get newsletter list (returns HTML!)
POST /_ajax/nyhetsbrev/list_news_letters
Content-Type: application/x-www-form-urlencoded

filter[page]=alle&_csrf={csrf}

// Parse HTML for newsletter IDs using these patterns:
// - onclick="showLocalNews(1977044)"
// - data-newsid="1977044"
// - hent_news_letter_local with 6-7 digit number

// Get newsletter content
POST /_ajax/nyhetsbrev/hent_news_letter_local
Content-Type: application/x-www-form-urlencoded

newsid={id}&_csrf={csrf}

// Returns HTML - parse for:
// - Title: <h2 class="newstitle">...</h2>
// - Date: dd.mm.yyyy pattern
// - Attachments: href="/...fetchimage/news_att/{id}/..."
```

#### Get Photos

Photos use **IP-locked JWT tokens** - the most complex part of this API.

```typescript
// Photos appear in dashboard and /foto gallery
GET /foto
Cookie: {session cookies}

// Parse HTML for photo URLs:
// https://media1.intutor.no/photo.php?t={jwt}

// JWT payload structure (decode but don't verify):
{
  "exp": 1702634400,     // Expiration timestamp
  "iat": 1702548000,     // Issued at
  "ip": "192.168.1.1",   // Client IP - TOKEN IS IP-LOCKED!
  "date": "2024-12-15",
  "companyId": "12345",
  "name": "12345_MYKID_abc123.jpg"  // Unique photo ID
}

// Download photo (JWT is sufficient, no cookies needed)
GET https://media1.intutor.no/photo.php?t={jwt}

// CRITICAL: Must download from same IP that got the JWT!
```

#### Get Photos for Specific Date

```typescript
POST /_ajax/dagenmin/show_myday_photos
Content-Type: application/x-www-form-urlencoded

date=2024-12-15+00:00:00&_csrf={csrf}

// Returns HTML with photo URLs
```

#### Get Conversations

```typescript
GET /_ajax/kommunikasjon/get_sms_conversation?_csrf={csrf}

// Returns HTML - parse for messages
```

### Types

```typescript
interface MyKidCalendarEvent {
  id: string              // e.g., "b_554975"
  event_at: string        // YYYY-MM-DD
  event_until: string | null
  title: string
  description: string | null
  is_all_day: boolean
  isHolidayEvent: number  // 0 or 1
  class: string           // 'birthday', 'event', etc.
  icon: string            // e.g., 'bursdag.png'
  editable: boolean
  allow_delete: boolean
  fornavn?: string        // First name (for birthdays)
  sortorder?: number
}

interface MyKidNewsletter {
  id: number
  title: string
  date: string            // "15.12.2024" (Norwegian format)
  content: string         // HTML
  attachments: {
    id: number
    filename: string
    url: string           // /_ajax/image/fetchimage/news_att/{id}/orig
  }[]
}

interface MyKidPhoto {
  url: string             // Full URL with JWT
  expiresAt: Date         // From JWT exp
  photoId: string         // From JWT name field
  companyId?: string
  date?: string
}

interface MyKidPhotoJwt {
  exp: number
  iat: number
  ip: string              // Client IP - token is locked to this!
  date: string
  companyId: string
  name: string            // Unique filename
}

// Parse Norwegian date (dd.mm.yyyy)
function parseNorwegianDate(dateStr: string): Date | null {
  const match = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (!match) return null
  const [, day, month, year] = match
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
}
```

### Lessons Learned & Gotchas

#### 1. TWO different CSRF tokens!
The login page CSRF (hidden input) is different from the dashboard CSRF (meta tag). You need BOTH:

```typescript
// Login page: <input type="hidden" name="_csrf_token" value="...">
const loginCsrf = html.match(/name="_csrf_token"\s+value="([^"]+)"/)?.[1]

// Dashboard: <meta name="_csrf_token" content="...">
const dashboardCsrf = html.match(/<meta\s+name="_csrf_token"\s+content="([^"]+)"/)?.[1]
```

#### 2. Login REQUIRES specific headers
Without these headers, you get a CSRF error even with valid credentials:

```typescript
// REQUIRED headers for login POST
Accept: 'application/json',
'X-Requested-With': 'XMLHttpRequest'
```

#### 3. Photo JWTs are IP-locked!
The JWT contains the client IP. Photos MUST be downloaded from the same IP that authenticated. This means:

```typescript
// In your sync job:
await login(phone, password)
const photos = await getPhotoUrls()
for (const photo of photos) {
  // Download NOW while we have the same IP
  const buffer = await downloadPhoto(photo.url)
  await uploadToStorage(buffer)  // Store permanently
}
```

You cannot save photo URLs for later - they'll fail from a different IP/server.

#### 4. Most endpoints return HTML, not JSON
Only the calendar returns clean JSON. Everything else is HTML that needs parsing:

```typescript
// Newsletter list - HTML with onclick handlers
// Newsletter content - HTML article
// Photos - HTML with img tags
// Conversations - HTML message bubbles
```

#### 5. Phone number is the login identifier
No email - use the mobile phone number:

```typescript
// pp = country code prefix (47 for Norway)
// m = mobile number
_csrf_token={csrf}&pp=47&m=12345678&p={password}
```

#### 6. Child names are hard to extract
Children are identified by ID from InfoBus topics, but names must be scraped from HTML using multiple fallback patterns:

```typescript
const patterns = [
  /kid_avatar\/\d+\/[^>]*>\s*<span[^>]*class="dep-name"[^>]*>\s*([^<]+)/,
  /bytt_barn\/\d+\/[^"]*"[^>]*>\s*([^<]+)/,
  /data-(?:id|kid)=["']\d+["'][^>]*>\s*([^<]+)/
]
```

#### 7. Unseen counts are strings
The API returns numbers as strings:

```typescript
const counts = await getUnseenCounts()
const localCount = parseInt(counts.local)  // Convert!
```

#### 8. Date format in photo requests
Include the time component even for a date:

```typescript
// WRONG
date=2024-12-15

// RIGHT
date=2024-12-15+00:00:00
```

---

## Common Patterns

### Session Management

All services use session-based authentication that can expire. Recommended pattern:

```typescript
class IntegrationClient {
  private credentials: { username: string; password: string }

  async withSession<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (this.isSessionExpired(error)) {
        await this.login(this.credentials.username, this.credentials.password)
        return await operation()  // Retry once
      }
      throw error
    }
  }

  private isSessionExpired(error: unknown): boolean {
    return error instanceof AuthError ||
           (error instanceof Error && error.message.includes('401'))
  }
}
```

### Date Handling

Each service uses different date formats - **this will bite you**:

| Service | Format | Example | Parser |
|---------|--------|---------|--------|
| Spond | ISO 8601 | `2024-12-15T10:00:00.000Z` | `new Date(str)` |
| iSkole | YYYYMMDD | `20241215` | Custom parser |
| Kidplan | Microsoft JSON | `/Date(1702634400000)/` | Regex + parseInt |
| MyKid | Norwegian | `15.12.2024` | Regex + custom |

```typescript
// Universal date parser
function parseDate(dateStr: string, service: string): Date | null {
  if (!dateStr) return null

  // Microsoft JSON: /Date(1234567890000)/
  const msMatch = dateStr.match(/\/Date\((-?\d+)\)\//)
  if (msMatch) return new Date(parseInt(msMatch[1]))

  // Norwegian: dd.mm.yyyy
  const noMatch = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (noMatch) {
    const [, d, m, y] = noMatch
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
  }

  // iSkole: YYYYMMDD
  if (/^\d{8}$/.test(dateStr)) {
    return new Date(
      parseInt(dateStr.slice(0, 4)),
      parseInt(dateStr.slice(4, 6)) - 1,
      parseInt(dateStr.slice(6, 8))
    )
  }

  // ISO fallback
  return new Date(dateStr)
}
```

### Cookie Handling in Node.js

Different runtimes handle cookies differently:

```typescript
function extractCookies(response: Response): string[] {
  // Modern Node.js 18+
  const getSetCookie = (response.headers as any).getSetCookie
  if (typeof getSetCookie === 'function') {
    return getSetCookie() || []
  }

  // Fallback
  const single = response.headers.get('set-cookie')
  return single ? [single] : []
}

function parseCookieValue(cookieStr: string, name: string): string | null {
  // Handle comma-separated cookies (but not date commas like "Mon, 18 Dec")
  const parts = cookieStr.split(/,(?=\s*[^;]+=)/)
  for (const part of parts) {
    if (part.includes(`${name}=`)) {
      return part.trim().split(';')[0]
    }
  }
  return null
}
```

### Rate Limiting

None of these APIs document rate limits. Be conservative:

```typescript
const DELAYS = {
  spond: 100,      // Fastest - well-built API
  iskole: 200,     // Medium - Oracle backend
  kidplan: 150,    // Medium - ASP.NET
  mykid: 300       // Slowest - complex CSRF handling
}

async function rateLimitedFetch(url: string, service: keyof typeof DELAYS) {
  await sleep(DELAYS[service])
  return fetch(url)
}
```

---

## Error Handling

### Service-Specific Error Classes

Each service has its own error classes:

```typescript
// Spond
class SpondError extends Error { statusCode?: number; response?: unknown }
class SpondAuthError extends SpondError { }

// iSkole
class ISkoleError extends Error { code?: string; statusCode?: number }
class ISkoleAuthError extends ISkoleError { }
class ISkoleSessionExpiredError extends ISkoleError { }

// Kidplan
class KidplanError extends Error { statusCode?: number; response?: unknown }
class KidplanAuthError extends KidplanError { }

// MyKid
class MyKidError extends Error { statusCode?: number; responseBody?: string }
class MyKidAuthError extends MyKidError { }
class MyKidCsrfError extends MyKidError { }
```

### HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 401 | Unauthorized | Re-authenticate |
| 403 | Forbidden/CSRF | Re-fetch CSRF token (MyKid), re-authenticate |
| 302 | Redirect | Session expired, re-authenticate |
| 429 | Rate limited | Wait and retry with exponential backoff |
| 500+ | Server error | Retry with backoff, max 3 attempts |

### Debugging Tips

1. **Enable debug logging**: All clients support `debug: true` option
2. **Log request/response**: Helps identify format mismatches
3. **Check cookies**: Session issues are usually cookie problems
4. **Verify CSRF**: MyKid CSRF errors mean wrong token or missing headers

---

## Security Considerations

1. **Credential Storage**: Never store passwords in plain text. Use encryption at rest. Consider using a secrets manager.

2. **Session Tokens**: Treat as sensitive. Don't log them. Rotate when possible.

3. **Photo URLs**: MyKid JWTs contain IP addresses. Never expose URLs publicly.

4. **National IDs**: iSkole uses fødselsnummer (national ID). Handle with extreme care per GDPR. Consider tokenization.

5. **Rate Limiting**: Be a good citizen. Add delays. Sync during off-peak hours (early morning).

6. **Error Messages**: Don't expose detailed API errors to end users. Log internally.

7. **Token Expiration**: Implement proper session refresh. Don't rely on long-lived tokens.

---

## Document Extraction System

The app includes an AI-powered document extraction system that processes PDFs, images, and web pages to extract calendar events and create suggestions.

### Architecture

```
Manual URL Sources                Integration Attachments
       │                                    │
       ▼                                    ▼
external_source_urls               Integration Sync (MyKid, etc.)
       │                                    │
       ▼                                    ▼
┌──────────────────────────────────────────────────────────┐
│                   external_documents                      │
│  (stores document metadata, storage paths, extracted text)│
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌─────────────────────┐
              │  AI Vision Model    │
              │  (configurable in   │
              │   admin settings)   │
              └─────────────────────┘
                          │
                          ▼
              ┌─────────────────────┐
              │ external_suggestions│
              │  (pending review)   │
              └─────────────────────┘
                          │
                          ▼
              User reviews and approves
                          │
                          ▼
              ┌─────────────────────┐
              │  child_tasks or     │
              │  member_events      │
              └─────────────────────┘
```

### Document Sources

| Source | Status | Description |
|--------|--------|-------------|
| Manual URLs (calendar pages, PDFs) | **Implemented** | Users add URLs in settings |
| MyKid newsletter attachments | **Implemented** | Auto-downloaded during sync |
| iSkole letters (VoBrev) | **Not Yet** | Endpoint available but not integrated |
| iSkole message attachments | **Not Yet** | VoVedleggForMelding endpoint available |
| Spond post attachments | **Not Yet** | Field exists but usually empty |
| Kidplan files (GetFileList) | **Not Yet** | Endpoint available |

### AI Extraction Service

**File:** `src/lib/integrations/document-extraction.ts`

```typescript
// For HTML pages (school calendars)
extractEventsFromHtml(html, context) → ExtractedEvent[]

// For PDFs (sent as base64 to vision model)
extractEventsFromPdf(pdfBase64, context) → { events: ExtractedEvent[] }

// For images (screenshots, calendar photos)
extractEventsFromImage(imageBase64, mimeType, context) → ExtractedEvent[]
```

### Vision Model Configuration

The AI model for document extraction is configurable via admin settings:
- **Setting key:** `openrouter_vision_model`
- **Default:** `google/gemini-2.0-flash-001`
- **Selection:** Models with vision capability (detected via `architecture.input_modalities.includes('image')`)

### Database Tables

```sql
-- Manual calendar sources
external_source_urls (
  id, household_id, url, display_name, url_type,
  auto_sync, sync_frequency_days, last_sync_at, last_sync_status, child_id
)

-- Documents from all sources
external_documents (
  id, household_id, integration_id, source_url_id,
  external_id, source_type, source_url, title, filename,
  mime_type, storage_path, file_size, extracted_text,
  ai_processed, ai_processed_at, child_id
)

-- Extracted events become suggestions
external_suggestions (
  id, household_id, source_document_id, -- links to external_documents
  suggested_type, suggested_date, suggested_title, ...
)
```

---

## Implementation Status

### Per-Service Feature Matrix

| Feature | Spond | iSkole | Kidplan | MyKid |
|---------|-------|--------|---------|-------|
| Authentication | ✅ | ✅ | ✅ | ✅ |
| Calendar/Events | ✅ | ✅ | - | ✅ |
| Messages | ✅ | ✅ | ✅ | ✅ |
| Photos | - | - | ✅ | ✅ |
| Timetable | - | ✅ | - | - |
| Absences | - | ✅ | - | - |
| School Calendar | - | ✅ | - | - |
| PDF Attachments | ❌ | ❌ | ❌ | ✅ |
| AI Message Extraction | ✅ | ✅ | ✅ | ✅ |

**Legend:** ✅ Implemented | ❌ Not yet (endpoint exists) | - Not available

### Pending Enhancements

1. **iSkole Letters (VoBrev)**
   - Endpoint: `GET /rest/v0/VoBrev;jsessionid={session}?finder=...`
   - Contains official school letters which may have important dates

2. **iSkole Message Attachments (VoVedleggForMelding)**
   - Endpoint: `GET /rest/v0/VoVedleggForMelding;jsessionid={session}?meldingid={id}`
   - Attachments to school messages (PDFs, images)

3. **Spond Post/Event Attachments**
   - Field: `attachments[]` on posts and sponds
   - Usually empty in current data, but structure exists

4. **Kidplan Files (GetFileList)**
   - Endpoint: `POST /ChildPage/GetFileList`
   - Child-related documents

---

## Changelog

- **2024-12-22**: Added document extraction system, vision model configuration
- **2024-12-22**: Added implementation status matrix
- **2024-12-22**: Initial documentation
- **2024-12-22**: Added lessons learned, fixed inaccuracies from code review, added missing endpoints
