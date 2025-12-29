/**
 * Working MyKid API test - with correct CSRF extraction
 */

import * as readline from 'readline'

const BASE_URL = 'https://mykid.no'

async function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(r => { rl.question(q, a => { rl.close(); r(a) }) })
}

async function main() {
  const phone = await prompt('Phone: ')
  const password = await prompt('Password: ')

  const cookies: Map<string, string> = new Map()

  function updateCookies(headers: Headers) {
    try {
      const all = (headers as any).getSetCookie?.() || []
      for (const c of all) {
        const m = c.match(/^([^=]+)=([^;]*)/)
        if (m) cookies.set(m[1], m[2])
      }
    } catch {}
  }

  function getCookies(): string {
    return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
  }

  console.log('\n═══════════════════════════════════════════')
  console.log('       MyKid API Verification')
  console.log('═══════════════════════════════════════════\n')

  // Step 1: Login
  console.log('── Step 1: Login ──')
  const page1 = await fetch(`${BASE_URL}/nb/logg_inn`)
  updateCookies(page1.headers)
  const loginHtml = await page1.text()
  const loginCsrf = loginHtml.match(/name="_csrf_token"\s+value="([^"]+)"/)?.[1] || ''

  const form = new URLSearchParams()
  form.append('_csrf_token', loginCsrf)
  form.append('pp', '47')
  form.append('m', phone)
  form.append('p', password)

  const login = await fetch(`${BASE_URL}/forside/forside/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': getCookies(),
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: form.toString(),
  })
  updateCookies(login.headers)

  const loginJson = JSON.parse(await login.text())
  if (loginJson.status !== 'ok') {
    console.log(`✗ Login failed: ${loginJson.message}`)
    return
  }
  console.log('✓ Login successful')

  // Step 2: Get dashboard and extract CSRF from meta tag
  console.log('\n── Step 2: Get Dashboard ──')
  const dashboard = await fetch(`${BASE_URL}/foreldre`, {
    headers: { 'Cookie': getCookies() },
  })
  updateCookies(dashboard.headers)

  const dashHtml = await dashboard.text()
  console.log(`✓ Dashboard: ${dashHtml.length} bytes`)

  // Extract CSRF from meta tag: <meta name="_csrf_token" content="...">
  const csrfMatch = dashHtml.match(/<meta name="_csrf_token" content="([^"]+)"/)
  const csrf = csrfMatch?.[1] || ''

  if (!csrf) {
    console.log('✗ Could not find CSRF token in dashboard')
    return
  }
  console.log(`✓ CSRF: ${csrf.substring(0, 20)}...`)

  // Step 3: Test endpoints
  console.log('\n── Step 3: Test Endpoints ──\n')

  const today = new Date().toISOString().split('T')[0]

  const endpoints = [
    { name: 'Unseen News', method: 'POST' as const, url: `/_ajax/nyhetsbrev/get_unseen_news`, body: `_csrf=${csrf}` },
    { name: 'Calendar Week', method: 'GET' as const, url: `/_ajax/calendar/fetch_calendar_week?_csrf=${csrf}` },
    { name: 'My Day', method: 'POST' as const, url: `/_ajax/dagenmin/show_myday`, body: `date=${encodeURIComponent(today + '+00:00:00')}&_csrf=${csrf}` },
    { name: 'My Day Photos', method: 'POST' as const, url: `/_ajax/dagenmin/show_myday_photos`, body: `date=${encodeURIComponent(today + '+00:00:00')}&_csrf=${csrf}` },
    { name: 'Newsletter List', method: 'POST' as const, url: `/_ajax/nyhetsbrev/list_news_letters`, body: `filter[page]=alle&_csrf=${csrf}` },
    { name: 'Messages', method: 'POST' as const, url: `/_ajax/kommunikasjon/fetch_messages`, body: `user_id=intern_melding&_csrf=${csrf}` },
    { name: 'Calendar Month', method: 'POST' as const, url: `/_ajax/calendar/fetch_calendar_data`, body: `from=${today}&to=${new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0]}&_csrf=${csrf}` },
    { name: 'Attendance', method: 'POST' as const, url: `/_ajax/kalender/fetch_attendance_status`, body: `date=${today}&_csrf=${csrf}` },
    { name: 'InfoBus Topics', method: 'GET' as const, url: `/_ajax/infobus/get_topics?_csrf=${csrf}` },
  ]

  const results: Array<{name: string, status: number, size: number, type: string, photos: number, snippet: string}> = []

  for (const ep of endpoints) {
    const resp = await fetch(`${BASE_URL}${ep.url}`, {
      method: ep.method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': getCookies(),
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${BASE_URL}/foreldre`,
      },
      body: ep.method === 'POST' ? ep.body : undefined,
    })

    const text = await resp.text()
    const contentType = resp.headers.get('content-type') || ''
    const isJson = contentType.includes('json') || text.startsWith('{') || text.startsWith('[')
    const isHtml = text.startsWith('<') || text.includes('<!DOCTYPE')

    // Find photo URLs
    const photoUrls = text.match(/https:\/\/media\d*\.intutor\.no\/photo\.php\?t=[^"'\s&]+/g) || []

    results.push({
      name: ep.name,
      status: resp.status,
      size: text.length,
      type: isJson ? 'JSON' : isHtml ? 'HTML' : 'TEXT',
      photos: photoUrls.length,
      snippet: text.substring(0, 100).replace(/\n/g, ' '),
    })

    const icon = resp.status === 200 ? '✓' : '✗'
    const photoInfo = photoUrls.length > 0 ? ` [${photoUrls.length} photos]` : ''
    console.log(`${icon} ${ep.name.padEnd(18)} ${resp.status} ${results[results.length-1].type.padEnd(4)} ${text.length.toString().padStart(6)} bytes${photoInfo}`)

    // If we found photos, analyze JWT
    if (photoUrls.length > 0) {
      const url = photoUrls[0]
      const token = new URL(url).searchParams.get('t')
      if (token) {
        try {
          const payload = token.split('.')[1]
          const decoded = JSON.parse(Buffer.from(payload.replace(/-/g,'+').replace(/_/g,'/') + '==', 'base64').toString())
          console.log(`   JWT: exp=${new Date(decoded.exp * 1000).toISOString()}, ip=${decoded.ip || 'none'}`)
        } catch {}
      }
    }

    await new Promise(r => setTimeout(r, 100))
  }

  // Summary
  console.log('\n── Summary ──')
  const working = results.filter(r => r.status === 200)
  const withPhotos = results.filter(r => r.photos > 0)
  console.log(`Working: ${working.length}/${results.length}`)
  console.log(`With photos: ${withPhotos.length}`)
  console.log(`Total photos found: ${results.reduce((a, r) => a + r.photos, 0)}`)

  // Show snippets of successful responses
  console.log('\n── Response Snippets ──')
  for (const r of working.slice(0, 5)) {
    console.log(`\n${r.name}:`)
    console.log(`  ${r.snippet}...`)
  }
}

main().catch(console.error)
