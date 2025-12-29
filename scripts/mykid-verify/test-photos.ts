/**
 * Test photo fetching - with and without cookies
 */

import * as readline from 'readline'
import * as fs from 'fs'

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

  // Get dashboard to find photo URLs
  const dashboard = await fetch(`${BASE_URL}/foreldre`, { headers: { 'Cookie': getCookies() } })
  updateCookies(dashboard.headers)
  const dashHtml = await dashboard.text()
  const csrf = dashHtml.match(/<meta name="_csrf_token" content="([^"]+)"/)?.[1] || ''

  // Find photo URLs
  const photoUrls = dashHtml.match(/https:\/\/media\d*\.intutor\.no\/photo\.php\?t=[^"'\s&]+/g) || []

  if (photoUrls.length === 0) {
    console.log('No photos found in dashboard')

    // Try newsletter list
    console.log('\nChecking newsletters for photos...')
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

    // Save for inspection
    fs.writeFileSync('/tmp/mykid-newsletters.html', newsHtml)
    console.log(`Saved ${newsHtml.length} bytes to /tmp/mykid-newsletters.html`)

    // Find any news IDs
    const newsIds = newsHtml.match(/onclick="[^"]*showLocalNews\((\d+)\)/g) || []
    console.log(`Found ${newsIds.length} showLocalNews calls`)

    // Try different newsletter patterns
    const newsPatterns = [
      newsHtml.match(/data-newsid="(\d+)"/g),
      newsHtml.match(/newsid="(\d+)"/g),
      newsHtml.match(/news_id="(\d+)"/g),
      newsHtml.match(/\bshowLocalNews\((\d+)\)/g),
    ].filter(Boolean)

    if (newsPatterns.some(p => p && p.length > 0)) {
      console.log('\nFound newsletter patterns:')
      newsPatterns.forEach((p, i) => p && console.log(`  Pattern ${i}: ${p.slice(0,3).join(', ')}`))
    }

    return
  }

  console.log(`Found ${photoUrls.length} photo(s) in dashboard\n`)

  // Test first photo
  const photoUrl = photoUrls[0]
  const tokenMatch = photoUrl.match(/t=([^&"'\s]+)/)
  if (!tokenMatch) {
    console.log('Could not extract token from URL')
    return
  }

  const token = tokenMatch[1]

  // Decode JWT
  console.log('═══════════════════════════════════════════')
  console.log('       JWT Analysis')
  console.log('═══════════════════════════════════════════\n')

  try {
    const payload = token.split('.')[1]
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g,'+').replace(/_/g,'/') + '==', 'base64').toString())
    console.log('JWT Payload:')
    console.log(`  exp: ${new Date(decoded.exp * 1000).toISOString()} (in ${Math.round((decoded.exp * 1000 - Date.now()) / 60000)} min)`)
    console.log(`  iat: ${new Date(decoded.iat * 1000).toISOString()}`)
    console.log(`  ip: ${decoded.ip || 'none'}`)
    console.log(`  name: ${decoded.name}`)
    console.log(`  date: ${decoded.date}`)
    console.log(`  companyId: ${decoded.companyId}`)

    // The IP in JWT
    if (decoded.ip) {
      console.log(`\n⚠️  Token is IP-locked to: ${decoded.ip}`)
      console.log('   This may prevent server-side fetching in production!')
    }
  } catch (e) {
    console.log(`JWT decode error: ${e}`)
  }

  // Test photo fetch WITHOUT cookies (just JWT)
  console.log('\n═══════════════════════════════════════════')
  console.log('       Photo Fetch Test')
  console.log('═══════════════════════════════════════════\n')

  // Thumbnail (with &thumb)
  const thumbUrl = photoUrl + '&thumb'
  console.log('1. Fetching THUMBNAIL without cookies...')
  console.log(`   URL: ${thumbUrl.substring(0, 60)}...`)

  const thumbResp = await fetch(thumbUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })

  console.log(`   Status: ${thumbResp.status}`)
  console.log(`   Content-Type: ${thumbResp.headers.get('content-type')}`)
  console.log(`   Content-Length: ${thumbResp.headers.get('content-length')}`)

  if (thumbResp.status === 200 && thumbResp.headers.get('content-type')?.includes('image')) {
    const thumbData = await thumbResp.arrayBuffer()
    fs.writeFileSync('/tmp/mykid-photo-thumb.jpg', Buffer.from(thumbData))
    console.log(`   ✓ Saved to /tmp/mykid-photo-thumb.jpg (${thumbData.byteLength} bytes)`)
  } else {
    const body = await thumbResp.text()
    console.log(`   Body: ${body.substring(0, 100)}`)
  }

  // Full size (without &thumb)
  console.log('\n2. Fetching FULL SIZE without cookies...')
  const fullResp = await fetch(photoUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })

  console.log(`   Status: ${fullResp.status}`)
  console.log(`   Content-Type: ${fullResp.headers.get('content-type')}`)
  console.log(`   Content-Length: ${fullResp.headers.get('content-length')}`)

  if (fullResp.status === 200 && fullResp.headers.get('content-type')?.includes('image')) {
    const fullData = await fullResp.arrayBuffer()
    fs.writeFileSync('/tmp/mykid-photo-full.jpg', Buffer.from(fullData))
    console.log(`   ✓ Saved to /tmp/mykid-photo-full.jpg (${fullData.byteLength} bytes)`)
  } else {
    const body = await fullResp.text()
    console.log(`   Body: ${body.substring(0, 100)}`)
  }

  // Child avatar (requires session)
  console.log('\n3. Fetching child avatar WITH cookies...')
  const avatarResp = await fetch(`${BASE_URL}/_ajax/image/fetchimage/kid_avatar/123456/200`, {
    headers: { 'Cookie': getCookies() },
  })

  console.log(`   Status: ${avatarResp.status}`)
  console.log(`   Content-Type: ${avatarResp.headers.get('content-type')}`)

  if (avatarResp.status === 200 && avatarResp.headers.get('content-type')?.includes('image')) {
    const avatarData = await avatarResp.arrayBuffer()
    fs.writeFileSync('/tmp/mykid-avatar.jpg', Buffer.from(avatarData))
    console.log(`   ✓ Saved to /tmp/mykid-avatar.jpg (${avatarData.byteLength} bytes)`)
  }

  // Test avatar WITHOUT cookies
  console.log('\n4. Fetching child avatar WITHOUT cookies...')
  const avatarNoAuth = await fetch(`${BASE_URL}/_ajax/image/fetchimage/kid_avatar/123456/200`)

  console.log(`   Status: ${avatarNoAuth.status}`)
  if (avatarNoAuth.status !== 200) {
    console.log('   ✗ Avatar requires authentication')
  }

  console.log('\n═══════════════════════════════════════════')
  console.log('       Summary')
  console.log('═══════════════════════════════════════════')
  console.log('\nPhoto system:')
  console.log('  - Photos served from media1.intutor.no CDN')
  console.log('  - JWT tokens are IP-locked (serverless challenge!)')
  console.log('  - Token includes: exp, iat, ip, name, date, companyId')
  console.log('  - Avatars require session cookies')
}

main().catch(console.error)
