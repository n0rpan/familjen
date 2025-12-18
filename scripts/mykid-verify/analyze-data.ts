/**
 * Analyze MyKid data structure
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

  // Login
  console.log('Logging in...')
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
    console.log(`Login failed: ${loginJson.message}`)
    return
  }
  console.log('✓ Logged in\n')

  // Get dashboard
  const dashboard = await fetch(`${BASE_URL}/foreldre`, { headers: { 'Cookie': getCookies() } })
  updateCookies(dashboard.headers)
  const dashHtml = await dashboard.text()
  const csrf = dashHtml.match(/<meta name="_csrf_token" content="([^"]+)"/)?.[1] || ''

  // 1. Check for photos in dashboard HTML
  console.log('═══════════════════════════════════════════')
  console.log('       Photos in Dashboard')
  console.log('═══════════════════════════════════════════\n')

  const photoUrls = dashHtml.match(/https:\/\/media\d*\.intutor\.no\/photo\.php\?t=[^"'\s&]+/g) || []
  console.log(`Found ${photoUrls.length} photo URLs in dashboard`)

  if (photoUrls.length > 0) {
    console.log('\nFirst 3 photos:')
    for (const url of photoUrls.slice(0, 3)) {
      console.log(`  ${url.substring(0, 80)}...`)
      // Decode JWT
      const token = new URL(url).searchParams.get('t')
      if (token) {
        try {
          const payload = token.split('.')[1]
          const decoded = JSON.parse(Buffer.from(payload.replace(/-/g,'+').replace(/_/g,'/') + '==', 'base64').toString())
          console.log(`    JWT: exp=${new Date(decoded.exp * 1000).toISOString()}, ip=${decoded.ip || 'none'}, name=${decoded.name}`)
        } catch (e) { console.log(`    JWT decode failed: ${e}`) }
      }
    }
  }

  // Check for other image patterns
  const kidAvatars = dashHtml.match(/\/_ajax\/image\/fetchimage\/kid_avatar\/\d+\/\w+/g) || []
  console.log(`\nChild avatars: ${kidAvatars.length}`)
  kidAvatars.slice(0, 3).forEach(u => console.log(`  ${u}`))

  // 2. InfoBus Topics (for real-time)
  console.log('\n═══════════════════════════════════════════')
  console.log('       InfoBus Topics (Real-time)')
  console.log('═══════════════════════════════════════════\n')

  const topicsResp = await fetch(`${BASE_URL}/_ajax/infobus/get_topics?_csrf=${csrf}`, {
    headers: { 'Cookie': getCookies(), 'X-Requested-With': 'XMLHttpRequest' },
  })
  const topics = JSON.parse(await topicsResp.text())
  console.log('Topics:')
  topics.forEach((t: string) => console.log(`  ${t}`))

  // Extract child IDs from topics
  const childIds = topics.map((t: string) => t.match(/\.kid\.(\d+)\./)?.[1]).filter(Boolean)
  console.log(`\nChild IDs: ${[...new Set(childIds)].join(', ')}`)

  // 3. Calendar data structure
  console.log('\n═══════════════════════════════════════════')
  console.log('       Calendar Data')
  console.log('═══════════════════════════════════════════\n')

  const today = new Date().toISOString().split('T')[0]
  const nextMonth = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0]

  const calResp = await fetch(`${BASE_URL}/_ajax/calendar/fetch_calendar_data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': getCookies(),
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: `from=${today}&to=${nextMonth}&_csrf=${csrf}`,
  })

  const calData = JSON.parse(await calResp.text())
  console.log('Calendar structure:', Object.keys(calData))

  // Show first few events
  if (Array.isArray(calData)) {
    console.log(`\nTotal events: ${calData.length}`)
    console.log('\nFirst 3 events:')
    calData.slice(0, 3).forEach((e: any, i: number) => {
      console.log(`\n  Event ${i + 1}:`)
      console.log(`    ${JSON.stringify(e, null, 2).split('\n').join('\n    ')}`)
    })
  } else if (typeof calData === 'object') {
    console.log('\nCalendar object:')
    console.log(JSON.stringify(calData, null, 2).substring(0, 500))
  }

  // 4. Newsletter structure
  console.log('\n═══════════════════════════════════════════')
  console.log('       Newsletter Structure')
  console.log('═══════════════════════════════════════════\n')

  const newsResp = await fetch(`${BASE_URL}/_ajax/nyhetsbrev/list_news_letters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': getCookies(),
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: `filter[page]=alle&_csrf=${csrf}`,
  })

  const newsHtml = await newsResp.text()

  // Extract newsletter IDs
  const newsIds = newsHtml.match(/news_letter_id="(\d+)"/g) || []
  console.log(`Found ${newsIds.length} newsletters`)

  // Look for photos in newsletters
  const newsPhotos = newsHtml.match(/https:\/\/media\d*\.intutor\.no\/[^"'\s]+/g) || []
  console.log(`Photos in newsletters: ${newsPhotos.length}`)

  // Extract a newsletter ID to fetch full content
  const firstNewsId = newsHtml.match(/news_letter_id="(\d+)"/)?.[1]
  if (firstNewsId) {
    console.log(`\nFetching newsletter ${firstNewsId}...`)

    const fullNews = await fetch(`${BASE_URL}/_ajax/nyhetsbrev/hent_news_letter_local`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': getCookies(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: `newsid=${firstNewsId}&_csrf=${csrf}`,
    })

    const fullNewsHtml = await fullNews.text()
    console.log(`Newsletter content: ${fullNewsHtml.length} bytes`)

    // Photos in this newsletter
    const thisNewsPhotos = fullNewsHtml.match(/https:\/\/media\d*\.intutor\.no\/[^"'\s]+/g) || []
    console.log(`Photos in this newsletter: ${thisNewsPhotos.length}`)

    if (thisNewsPhotos.length > 0) {
      console.log('\nFirst photo:')
      const url = thisNewsPhotos[0]
      console.log(`  ${url}`)

      // Decode JWT
      const tokenMatch = url.match(/[?&]t=([^&"'\s]+)/)
      if (tokenMatch) {
        try {
          const payload = tokenMatch[1].split('.')[1]
          const decoded = JSON.parse(Buffer.from(payload.replace(/-/g,'+').replace(/_/g,'/') + '==', 'base64').toString())
          console.log(`  JWT payload:`, decoded)
        } catch (e) { console.log(`  JWT decode failed: ${e}`) }
      }
    }
  }

  // 5. Messages structure
  console.log('\n═══════════════════════════════════════════')
  console.log('       Messages Structure')
  console.log('═══════════════════════════════════════════\n')

  const msgResp = await fetch(`${BASE_URL}/_ajax/kommunikasjon/fetch_messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': getCookies(),
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: `user_id=intern_melding&_csrf=${csrf}`,
  })

  const msgHtml = await msgResp.text()
  console.log(`Messages response: ${msgHtml.length} bytes`)

  // Look for message patterns
  const msgIds = msgHtml.match(/message_id="(\d+)"/g) || []
  console.log(`Found ${msgIds.length} message IDs`)

  // Look for conversation patterns
  const convIds = msgHtml.match(/conversation_id="(\d+)"/g) || []
  console.log(`Found ${convIds.length} conversation IDs`)

  // Save raw HTML for inspection
  const fs = await import('fs')
  fs.writeFileSync('/tmp/mykid-messages.html', msgHtml)
  console.log('\nMessages HTML saved to /tmp/mykid-messages.html')
}

main().catch(console.error)
