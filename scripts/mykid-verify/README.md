# MyKid.no API Verification Scripts

Scripts to verify the MyKid.no API endpoints documented in `docs/mykid-integration-research.md`.

## Prerequisites

- Node.js 18+
- npm/npx

## Scripts

### 1. quick-test.ts - Login Verification

Quick test to verify login works with interactive prompts.

```bash
npx tsx scripts/mykid-verify/quick-test.ts
```

**Output:** Confirms login success, shows cookies and CSRF.

### 2. working-test.ts - Endpoint Verification

Tests all 9 verified endpoints after login.

```bash
npx tsx scripts/mykid-verify/working-test.ts
```

**Output:** Table of endpoints with status, response type (JSON/HTML), and size.

### 3. analyze-data.ts - Data Structure Analysis

Detailed analysis of data structures: photos, calendar events, newsletters, messages.

```bash
npx tsx scripts/mykid-verify/analyze-data.ts
```

**Output:**
- Photo URLs with JWT analysis
- Child IDs from InfoBus topics
- Calendar event JSON structure
- Newsletter patterns

### 4. test-photos.ts - Photo System Verification

Tests photo fetching from CDN, including IP-lock analysis.

```bash
npx tsx scripts/mykid-verify/test-photos.ts
```

**Output:**
- JWT payload analysis (exp, ip, name, etc.)
- Thumbnail and full-size photo downloads
- Avatar fetch with/without cookies
- Saved test images to /tmp/

## Verified Results (2025-12-18)

| Aspect | Status | Notes |
|--------|--------|-------|
| Login | VERIFIED | 3-step: GET /nb/logg_inn, POST /forside/forside/login, GET /foreldre |
| CSRF | VERIFIED | Login page: hidden input. Dashboard: meta tag. They're DIFFERENT! |
| AJAX Headers | VERIFIED | Must include `Accept: application/json` + `X-Requested-With: XMLHttpRequest` |
| Endpoints | VERIFIED | 9/9 working with proper CSRF |
| Calendar | VERIFIED | JSON endpoint with clean event structure |
| Photos | VERIFIED | JWT tokens include IP, but CDN works without cookies |
| Avatars | VERIFIED | Work without session cookies (surprising!) |

## Key Findings

1. **Dual CSRF tokens** - Login page and dashboard have DIFFERENT tokens
2. **AJAX headers required** - Login fails without `Accept: application/json`
3. **Photos work server-side** - If login + download happen in same request (same IP)
4. **Calendar is JSON** - Clean structured data, easy to parse
5. **Newsletters are HTML** - Need regex parsing for IDs and content

## Files Saved During Testing

- `/tmp/mykid-photo-thumb.jpg` - Thumbnail test
- `/tmp/mykid-photo-full.jpg` - Full size test
- `/tmp/mykid-avatar.jpg` - Child avatar
- `/tmp/mykid-dashboard.html` - Dashboard HTML
- `/tmp/mykid-newsletters.html` - Newsletter list HTML
- `/tmp/mykid-messages.html` - Messages HTML
