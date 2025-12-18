# iSkole Integration Research

## Executive Summary

iSkole is a Norwegian school administration system by Barman Hanssen AS, providing access to schedules, grades, absences, and communication for staff, students, and parents. Unlike Spond, **there is no public API** - integration requires reverse engineering their web application.

**Key Findings:**
- Oracle JET frontend with ADF backend using REST/JSON APIs internally
- Session-based authentication (JSESSIONID cookies)
- Parent login uses fødselsnummer (national ID) + password
- Now also supports passkeys as alternative authentication
- Data available: timetables, absences, tests/exams, grades, messages

---

## API Findings from HAR Analysis

### Authentication Flow

**Step 1: Validate Credentials**
```
POST https://iskole.net/iskole_forelder/rest/v0/VoValidateUserCredentials
Content-Type: application/vnd.oracle.adf.action+json

{
  "name": "validateUserCredentials",
  "parameters": [
    {"username": "XXXXXXXXXXX"},      // Fødselsnummer (11 digits)
    {"password": "sha256_hash_here"}  // Password is SHA256 hashed client-side!
  ]
}

Response (success):
{
  "result": "[{
    \"ret_code\": 12345678,           // Person ID (positive = success)
    \"navn\": \"Parent Name\",
    \"tofaktor\": \"0\",              // 2FA required: 0=no, 1=yes
    \"error_text\": \"null\"
  }]"
}

Response (failure):
{ "result": "[{ \"ret_code\": -666, \"error_text\": \"Feil passord!...\" }]" }
```

**Step 2: Establish Session**
```
POST https://iskole.net/iskole_forelder/login/login/{personId}
Content-Type: multipart/form-data

FormData:
  - password: {sha256_hash}
  - tofaktorkode: (empty)

Response: [{ "jsessionid": "null" }]  // Sets server-side session
```

**Step 3: Get Session Token**
```
POST https://iskole.net/iskole_forelder/rest/v0/VoUserData
Content-Type: application/vnd.oracle.adf.action+json

{"name": "validateJsessionId"}

Response (success):
{
  "result": "[{
    \"fullname\": \"Parent Name\",
    \"personid\": \"12345678\",
    \"security_level\": \"1\",
    \"antall_barn\": \"1\",
    \"jsessionid\": \"abc123...\"
  }]"
}
```

**Step 4: Use Session**
All subsequent requests include jsessionid in URL path:
```
GET https://iskole.net/iskole_forelder/rest/v0/VoBarn;jsessionid=XXX?...
```

### Discovered REST Endpoints

| Endpoint | Description | Key Parameters |
|----------|-------------|----------------|
| `VoBarn` | List children | `fields=Id,Fylkeid,Skoleid,Planperi,Elevnr,Elev,Klasse,Skolenavn` |
| `VoMeny` | Available menu items | `fylkeid,planperi,skoleid,elevnr` |
| `VoTimeplan_elev` | Timetable (date range) | `startDate,endDate,elevnr` |
| `VoTimeplan_elev_dato` | Timetable (single day) | `dato,elevnr` |
| `VoFravaer_alt` | All absences | `elevnr` |
| `VoFravaer_timer_alle_fag` | Absence by subject | `termin,elevnr` |
| `VoFravaer_totaloversikt` | Absence summary | `elevnr` |
| `VoFravaer_VM` | Absence VM stats | `elevnr` |
| `VoPostkasse` | Messages (inbox) | `mappeid=INB,elevnr` |
| `VoBrev` | Official letters | `elevnr` |
| `VoBulleteng` | Bulletin board | `elevnr` |
| `VoAnsattliste_m_rolle` | Teachers/staff list | `elevnr` |
| `VoElevpersonalia` | Student personal info | `elevnr` |
| `VoSoskenTilElev` | Siblings | `elevnr` |
| `VoUkeplan` | Weekly plans | `elevnr,fremtidige` |
| `VoArsplan` | Year plans | `elevnr` |
| `VoEgenmelding_dag` | Self-reported day absence | `elevnr` |
| `VoEgenmelding_time` | Self-reported hour absence | `elevnr` |
| `VoVedleggForMelding` | Message attachments | `meldingid` |
| `VoAarUke` | School weeks | `fylkeid,planperi,skoleid` |
| `VoSkolerute_maaned` | School calendar month | `maaned` |

### Common Query Parameters

```
finder=RESTFilter;fylkeid=XX,planperi=YYYY-YY,skoleid=XXX,elevnr=XXXXXXXX
onlyData=true
limit=100
offset=0
totalResults=true
fields=Field1,Field2,Field3
orderBy=Field1,Field2
```

### Response Format

Standard Oracle ADF REST collection response:
```json
{
  "items": [...],
  "totalResults": 42,
  "count": 20,
  "hasMore": true,
  "limit": 20,
  "offset": 0,
  "links": [
    { "rel": "self", "href": "...", "name": "VoBarn", "kind": "collection" }
  ]
}
```

### Key Identifiers

| Field | Meaning | Example |
|-------|---------|---------|
| `fylkeid` | County ID | `02` (Akershus/Viken) |
| `skoleid` | School ID | `XXX` |
| `planperi` | School year | `2025-26` |
| `elevnr` | Student number | `XXXXXXXX` |

---

## Complete Response Structures (from HAR)

### VoBarn (Children List)
```json
{
  "Id": 1,
  "Fylkeid": "02",
  "Skoleid": "XXX",
  "Planperi": "2025-26",
  "Elevnr": 12345678,
  "Elev": "Child Name",
  "Klasse": "1A",
  "Skolenavn": "School Name",
  "Bilde": null,
  "Logo": "base64...",
  "AntallMeldinger": 0
}
```

### VoTimeplan_elev (Timetable - Date Range)
```json
{
  "Id": "1",
  "Dato": "20251215",
  "Timenr": 12345678,
  "Fradato": "2025-12-15T08:30:00+00:00",
  "Tildato": "2025-12-15T10:30:00+00:00",
  "Fag": "Subject Code",
  "Fagnavn": "Subject Name",
  "Skoletype": "SD",
  "Romnr": "101",
  "Kode": "999999",
  "Faglaerer": "Teacher Name",
  "ProviderId": "timeplan",
  "Fravaer": null,
  "Merknad": null,
  "Egenmelding": "Nei",
  "Dokumentert": "Udokumentert",
  "Tidssone": "1",
  "Timetype": "TIME"
}
```

### VoTimeplan_elev_dato (Timetable - Single Day)
```json
{
  "Id": 1,
  "Timenr": 12345678,
  "Fag": "Subject Code",
  "StartKl": "0830",
  "SluttKl": "1030"
}
```

### VoPostkasse (Messages Inbox)
```json
{
  "Meldingid": 123456,
  "Mottatt": "2025-12-11T15:32:14+01:00",
  "Apnet": "2025-12-11T17:28:08+01:00",
  "Emne": "Message Subject",
  "Lname": "Sender Last Name",
  "Fname": "Sender First Name",
  "Epost": "sender@school.no",
  "Tekst": "<p>Message content...</p>",
  "PersonidMottaker": 12345678,
  "Elevnr": 12345678,
  "Elevnavn": "Child Name"
}
```

### VoFravaer_alt (All Absences)
```json
{
  "Id": "1d",
  "Sortering": 1,
  "Dato": "2025-11-19T00:00:00+01:00",
  "Timenr": -1,
  "StartKl": null,
  "SluttKl": null,
  "Minutter": 0,
  "Fag": "Dagfravær",
  "Typefravaer": "D",
  "RegistrertDok": "2025-11-26T17:50:21+01:00",
  "Dokumentasjonstypeid": 1,
  "Dokumentasjonstypetekst": "Helse - egenmeldt",
  "Merknad": "Absence reason...",
  "RegistrertEgenm": "2025-11-19T07:18:39+01:00",
  "RegistrertEgenmJaNei": "Ja",
  "RegistrertDokJaNei": "Ja"
}
```

### VoFravaer_totaloversikt (Absence Summary)
```json
{
  "Id": 1,
  "Aruke": "2025-36",
  "Starttidpos": "2020-01-07T09:45:00.000+01:00",
  "Slutttidpos": "2020-01-07T10:30:00.000+01:00",
  "Dato": "02.09.2025",
  "Starttid": "09:45",
  "Slutttid": "10:30",
  "Minutter": 45,
  "Fag": "Subject Code",
  "Kode": "999999",
  "Typefravaer": "D",
  "Dagfravaer": "D",
  "Merknad": "Absence reason...",
  "Dokumentert": "2025-09-12T23:30:51+02:00",
  "Dokumentasjonstypeid": 1,
  "Dokumentasjonstypetekst": "Helse - egenmeldt",
  "Egenmelding": "2025-09-02T07:22:53+02:00"
}
```

### VoFravaer_timer_alle_fag (Absence by Subject)
```json
{
  "Fag": "Subject Code",
  "Stkode": "XX",
  "KlTrinn": "1",
  "KlId": "A",
  "KNavn": "Subject",
  "GruppeNr": " ",
  "Tptimer": 315.8,
  "Fravaer": 10.8,
  "Navn": "Subject Name",
  "Kode": "999999",
  "Omfang": 0
}
```

### VoFravaer_VM (Absence Statistics)
```json
{
  "Dager": 4,
  "Timer": 4,
  "Gdager": 0
}
```

### VoEgenmelding_dag (Self-Reported Day Absence)
```json
{
  "Dato": "2025-10-08T00:00:00+02:00",
  "Ansidato": "20251008",
  "Registrert": "2025-10-08T07:17:31+02:00",
  "Behandlet": null,
  "Melding": "Self-report message...",
  "Typefravaer": null,
  "Docid": null,
  "Merknad": null,
  "Filename": null,
  "Contenttype": null,
  "DokumentertRegistrert": null,
  "DokumentertEgenmelding": "F"
}
```

### VoElevpersonalia (Student Personal Info)
```json
{
  "Elevnr": 12345678,
  "Klasse": "1A",
  "Lname": "Last Name",
  "Fname": "First Name",
  "Birthdate": "2019-10-24T00:00:00+02:00",
  "Myndig": 0,
  "Startdato": "2025-08-01T00:00:00+02:00",
  "Sluttdato": "2026-07-31T00:00:00+02:00",
  "Mobile": null,
  "Epost": null,
  "Skyss": "Nei",
  "Epostskole": "school@email.no",
  "Kurskode": "GSGSK0----",
  "Kursnavn": "Grunnskole",
  "Kontaktlaerer": "Teacher Name",
  "Gender": "M",
  "Fname1": "Parent1 First",
  "Lname1": "Parent1 Last",
  "Gate1": "...",
  "Postnr1": "...",
  "Poststed1": "...",
  "Mobil1": "...",
  "Epost1": "...",
  "Fname2": "Parent2 First",
  "Lname2": "Parent2 Last"
}
```

### VoAnsattliste_m_rolle (Teachers/Staff)
```json
{
  "Id": "a8",
  "Rolle": "Kontaktlærer",
  "Sortering": 1,
  "Personid": 12345678,
  "Lname": "Last Name",
  "Fname": "First Name"
}
```

### VoAarUke (School Weeks)
```json
{
  "Aruke": "202533",
  "Uke": "2025-33 (13.aug - 15.aug)",
  "Dag1": "2025-08-13T00:00:00+02:00",
  "SisteDag": "2025-08-15T00:00:00+02:00"
}
```

### VoSkolerute_maaned (School Calendar Month)
```json
{
  "Dato": "20250801",
  "Uke": "31",
  "Mandag": null,
  "Tirsdag": null,
  "Onsdag": null,
  "Torsdag": null,
  "Fredag": "1",
  "Lordag": "2",
  "Sondag": "3",
  "SkoletypeMandag": null,
  "SkoletypeTirsdag": null,
  "SkoletypeOnsdag": null,
  "SkoletypeTorsdag": null,
  "SkoletypeFredag": "FD",
  "SkoletypeLordag": "FD",
  "SkoletypeSondag": "FD"
}
```

School type codes:
- `SD` = Skoledag (School day)
- `FD` = Fridag (Day off)
- `PD` = Planleggingsdag (Planning day)

### VoArsplan (Year Plans)
```json
{
  "Fag": "Subject Code",
  "Kode": "999999",
  "Fagnavn": "Subject Name",
  "Plan": null
}
```

### VoMeny (Menu Items)
```json
{
  "Menyid": "22000",
  "Foreldreid": 22000,
  "Kommando": "dashboard",
  "Menynavn": "Info",
  "Niva": 0,
  "Ikon": "fas fa-info-circle oj-typography-subheading-md",
  "Antall": null
}
```

---

## All Discovered Endpoints

Complete list from HAR analysis:

| Endpoint | Purpose |
|----------|---------|
| `VoAarUke` | School weeks for year |
| `VoAnsattliste_m_rolle` | Teachers/staff with roles |
| `VoArsplan` | Year plans by subject |
| `VoBarn` | List children |
| `VoBrev` | Official letters |
| `VoBulleteng` | Bulletin board |
| `VoChat` | Chat messages |
| `VoEgenmelding_dag` | Self-reported day absences |
| `VoEgenmelding_time` | Self-reported hour absences |
| `VoElevmappe` | Student folder/documents |
| `VoElevpersonalia` | Student personal info |
| `VoFravaer_VM` | Absence statistics |
| `VoFravaer_alt` | All absences |
| `VoFravaer_innen_klagefrist` | Absences within complaint period |
| `VoFravaer_timer_alle_fag` | Absence hours by subject |
| `VoFravaer_timer_udok` | Undocumented absence hours |
| `VoFravaer_timer_udok_over_10` | Undocumented absences over 10% |
| `VoFravaer_totaloversikt` | Absence summary |
| `VoKjente_feil` | Known errors/bugs |
| `VoMeny` | Available menu items |
| `VoPostkasse` | Messages inbox |
| `VoSkoleruteTelling` | School calendar count |
| `VoSkolerute_maaned` | School calendar by month |
| `VoSoskenTilElev` | Siblings |
| `VoTimeplan_elev` | Timetable (date range) |
| `VoTimeplan_elev_dato` | Timetable (single day) |
| `VoUkeplan` | Weekly plans |
| `VoUkeplan_fag` | Weekly plans by subject |
| `VoUkeplanerUke` | Weekly planners |
| `VoUserData` | User data/authentication |
| `VoValidateUserCredentials` | Login validation |
| `VoVedleggForMelding` | Message attachments |

---

### Important: Password Hashing

The password is **SHA256 hashed client-side** before sending. This means we need to:
1. Hash the raw password with SHA256
2. Send the hex-encoded hash in the API call

```typescript
import { createHash } from 'crypto'

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}
```

---

## Platform Overview

### What is iSkole?

iSkole is a comprehensive school administration tool for Norwegian primary and secondary schools, in use since 1984 (started as a timetable tool).

**Scale:** 2+ million logins per school year from staff, students, and parents.

**Users:**
- School administrators
- Teachers
- Students
- Parents (of children under 18)

### Parent Portal Features

Parents can access:
| Feature | Description |
|---------|-------------|
| **Timeplan** (Timetable) | Weekly schedule with subjects and teachers |
| **Fravær** (Absences) | Attendance records, absence history |
| **Prøver** (Tests) | Upcoming and past test information |
| **Karakterer** (Grades) | Subject grades and assessments |
| **Meldinger** (Messages) | Communication with teachers/school |
| **Brev** (Letters) | Official school communications |

### Access URLs

| Role | URL |
|------|-----|
| Parent login | https://iskole.net/forelder |
| Student login | https://iskole.net/elev |
| Documentation | https://dokumentasjon.iskole.net |
| Support | https://support.iskole.net |

---

## Technical Architecture

### Technology Stack

Based on job postings and technical reviews:

| Layer | Technology |
|-------|------------|
| Frontend | Oracle JET (JavaScript Extension Toolkit) |
| Frontend Languages | JavaScript/TypeScript, HTML, CSS |
| Backend | Oracle ADF (Application Development Framework) |
| Backend Language | Java |
| Database | Oracle (700+ ViewObjects, 7 Root ApplicationModules) |
| API Style | REST with JSON |
| Session Management | JSESSIONID cookies |

### Authentication Methods

**Primary (Parents):**
1. Username: Fødselsnummer (11-digit Norwegian national ID)
2. Password: Received via email after registration with school-provided code

**Alternative:**
- Passkeys (newer, device-based biometric authentication)

**Note:** Parents cannot use Feide (students and staff can use Feide).

### Session Handling

The actual flow discovered from HAR analysis:

```
1. POST VoValidateUserCredentials with SHA256-hashed password
   → Returns ret_code (personId) on success

2. POST /login/login/{personId} with password hash in form data
   → Establishes server-side session

3. POST VoUserData with {"name":"validateJsessionId"}
   → Returns jsessionid token

4. All subsequent requests use jsessionid in URL path:
   GET /rest/v0/VoBarn;jsessionid=XXX?...
```

---

## Comparison with Spond Integration

| Aspect | Spond | iSkole |
|--------|-------|--------|
| API Status | Unofficial but documented | No API, reverse engineering required |
| Authentication | Email + Password → Bearer token | Fødselsnummer + Password → Session cookie |
| API Style | REST with JSON | REST with JSON |
| Session Duration | Token-based (longer lived) | Cookie-based (shorter, may timeout) |
| Rate Limiting | 3 attempts, then backoff | Unknown |
| Community Libraries | [Olen/Spond](https://github.com/Olen/Spond) (Python) | None found |
| Data Available | Events, messages, groups | Timetable, grades, absences, tests, messages |

### Sync Strategy Alignment

Following the existing Spond pattern:

```
external_integrations (service = 'iskole')
  └─ external_integration_children (child_id → iskole child ID)
       └─ external_events (school events, tests)
       └─ external_messages (school communications)
       └─ NEW: external_timetable (daily schedule)
       └─ NEW: external_school_calendar (holidays)
```

---

## Data Mapping

### Relevant Data for Family App

| iSkole Data | Family App Use |
|-------------|----------------|
| Timetable | Display in week view, know when school day ends (for pickup) |
| School Calendar | Show holidays, know when school is closed |
| Tests/Exams | Create child_tasks as reminders |
| Absences | Information for parents |
| Grades | Information display |
| Messages | Extract action items (like Spond AI extraction) |

### Proposed New Tables

```sql
-- iSkole-specific: Timetable entries
CREATE TABLE external_timetable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES external_integrations(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  external_id TEXT,
  day_of_week INT, -- 1=Monday, 7=Sunday
  period INT,
  start_time TIME,
  end_time TIME,
  subject TEXT,
  teacher TEXT,
  room TEXT,
  week_from DATE,
  week_to DATE,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(integration_id, child_id, day_of_week, period, week_from)
);

-- School calendar (holidays)
CREATE TABLE external_school_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES external_integrations(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  day_type TEXT, -- 'SD' (school), 'FD' (off), 'PD' (planning)
  school_year TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(integration_id, date)
);
```

---

## Security Considerations

### Credential Storage

Same as Spond:
- Encrypt fødselsnummer + password in `credentials_encrypted`
- Use SECURITY DEFINER functions to decrypt only during sync
- Never expose credentials to frontend

### Privacy

Fødselsnummer is sensitive personal data (Norwegian equivalent of SSN):
- Must comply with GDPR
- Consider if storing is necessary (could use session only?)
- Document data handling in privacy policy

### Session Security

- Session cookies should be HttpOnly
- Use secure connection only (HTTPS)
- Handle session expiry gracefully
- Don't log sensitive data

---

## Risks and Unknowns

| Risk | Mitigation |
|------|------------|
| iSkole changes their API | Version detection, graceful degradation |
| Rate limiting/blocking | Respect limits, add delays, retry logic |
| Passkey-only future | May need to support passkey auth |
| Per-school differences | Different schools may have different configs |
| Legal concerns | This is for personal data access, not scraping |
| Session timeout | Implement re-auth in sync flow |

---

## Status: PoC Complete - Ready for Full Implementation

The HAR analysis and proof-of-concept are complete. All key endpoints verified working.

### Verified Working Endpoints (PoC Tested)

| Endpoint | Path | Purpose | Status |
|----------|------|---------|--------|
| VoValidateUserCredentials | iskole_forelder | Login validation | ✅ |
| login/login/{personId} | iskole_forelder | Session establishment | ✅ |
| VoUserData | iskole_forelder | Get jsessionid | ✅ |
| VoBarn | iskole_forelder | List children | ✅ |
| VoTimeplan_elev | iskole_forelder | Timetable | ✅ |
| VoPostkasse | iskole_forelder | Messages inbox | ✅ |
| VoFravaer_alt | iskole_forelder | Absences | ✅ |
| VoSkolerute_maaned | **iskole_elev** | School calendar | ✅ |

### Key Implementation Notes

1. **Authentication Flow**:
   - POST VoValidateUserCredentials (SHA256 hashed password)
   - POST login/login/{personId} (form data with password hash)
   - POST VoUserData with `{"name":"validateJsessionId"}`
   - Returns jsessionid for subsequent requests

2. **Request Headers**:
   - `Accept: application/json, text/javascript, */*; q=0.01`
   - Cookies collected between requests

3. **Date Formats**:
   - Dates in finder use `YYYYMMDD` format (e.g., `20251215`)
   - Month in skolerute uses `MM` format (e.g., `12`)

4. **Path Note**:
   - Most endpoints: `iskole_forelder`
   - School calendar: `iskole_elev` (same session works)

**To proceed with full implementation:**
1. Build TypeScript client following Spond pattern
2. Add to external_integrations table (service='iskole')
3. Create sync API routes
4. Add UI settings for credentials

---

## Resources

- [iSkole Parent Documentation](https://dokumentasjon.iskole.net/docs/forelder/)
- [iSkole Student Documentation](https://dokumentasjon.iskole.net/docs/elev/)
- [Barman Hanssen (Vendor)](https://barman-hanssen.no/)
- [Oracle ADF REST Framework](https://docs.oracle.com/middleware/12211/adf/develop/GUID-589F3905-5A8D-402D-B2D2-3BEEB2D7DDD4.htm)
- [Oracle JET Documentation](https://docs.oracle.com/en/middleware/developer-tools/jet/15/develop/)
- [Spond Client (Reference)](https://github.com/Olen/Spond)
