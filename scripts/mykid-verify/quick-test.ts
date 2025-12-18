/**
 * Quick MyKid login test - avoids shell escaping issues
 *
 * Usage: npx tsx scripts/mykid-verify/quick-test.ts
 * Then enter phone and password when prompted
 */

import * as readline from 'readline'

const BASE_URL = 'https://mykid.no'

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

async function main() {
  // Get credentials interactively to avoid shell escaping
  const phone = await prompt('Phone number: ')
  const password = await prompt('Password: ')

  console.log('\n=== Testing MyKid Login ===')
  console.log(`Phone: ${phone}`)
  console.log(`Password: ${'*'.repeat(password.length)}`)

  // Step 1: Get login page + CSRF
  console.log('\n1. Fetching login page...')
  const pageResp = await fetch(`${BASE_URL}/nb/logg_inn`)
  const html = await pageResp.text()

  // Extract CSRF
  const csrfMatch = html.match(/name="_csrf_token"\s+value="([^"]+)"/)
  const csrf = csrfMatch?.[1]

  if (!csrf) {
    console.log('ERROR: Could not find CSRF token')
    return
  }
  console.log(`   CSRF: ${csrf.substring(0, 20)}...`)

  // Get cookies
  const cookies: string[] = []
  const setCookies = (pageResp.headers as any).getSetCookie?.() || []
  for (const c of setCookies) {
    const match = c.match(/^([^=]+=[^;]+)/)
    if (match) cookies.push(match[1])
  }
  console.log(`   Cookies: ${cookies.length} received`)

  // Step 2: Login via AJAX
  console.log('\n2. Attempting login...')

  const formData = new URLSearchParams()
  formData.append('_csrf_token', csrf)
  formData.append('pp', '47')
  formData.append('m', phone)
  formData.append('p', password)

  const loginResp = await fetch(`${BASE_URL}/forside/forside/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies.join('; '),
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${BASE_URL}/nb/logg_inn`,
      'Origin': BASE_URL,
    },
    body: formData.toString(),
  })

  const body = await loginResp.text()
  console.log(`   Response: ${body}`)

  try {
    const json = JSON.parse(body)
    if (json.status === 'ok') {
      console.log('\n✓ LOGIN SUCCESSFUL!')
      console.log(`  Redirect to: ${json.link}`)

      // Get new cookies after login
      const newCookies = (loginResp.headers as any).getSetCookie?.() || []
      console.log(`  New cookies: ${newCookies.length}`)

    } else {
      console.log('\n✗ LOGIN FAILED')
      console.log(`  Message: ${json.message}`)
    }
  } catch {
    console.log('\n✗ ERROR: Unexpected response (not JSON)')
  }
}

main().catch(console.error)
