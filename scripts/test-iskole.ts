/**
 * iSkole API Proof of Concept
 *
 * Usage: npx tsx scripts/test-iskole.ts <fødselsnummer> <password>
 */

import { createHash } from 'crypto'

const BASE_URL = 'https://iskole.net/iskole_forelder'

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

interface LoginResult {
  ret_code: number
  navn: string
  tofaktor: string
  error_text: string
}

interface SessionResult {
  fullname: string
  personid: string
  security_level: string
  antall_barn: string
  jsessionid: string
}

interface Child {
  Id: number
  Fylkeid: string
  Skoleid: string
  Planperi: string
  Elevnr: number
  Elev: string
  Klasse: string
  Skolenavn: string
  AntallMeldinger: number
}

// Store cookies between requests
let cookieJar: string[] = []

function extractCookies(response: Response): void {
  const setCookies = response.headers.getSetCookie()
  for (const cookie of setCookies) {
    const name = cookie.split('=')[0]
    // Remove old version of this cookie
    cookieJar = cookieJar.filter(c => !c.startsWith(name + '='))
    cookieJar.push(cookie.split(';')[0])
  }
}

function getCookieHeader(): string {
  return cookieJar.join('; ')
}

async function validateCredentials(username: string, passwordHash: string): Promise<LoginResult> {
  const response = await fetch(`${BASE_URL}/rest/v0/VoValidateUserCredentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.oracle.adf.action+json',
      'Accept': 'application/json',
      ...(cookieJar.length > 0 ? { 'Cookie': getCookieHeader() } : {})
    },
    body: JSON.stringify({
      name: 'validateUserCredentials',
      parameters: [
        { username },
        { password: passwordHash }
      ]
    })
  })

  extractCookies(response)
  const data = await response.json()
  return JSON.parse(data.result)[0] as LoginResult
}

async function loginStep(personId: string, passwordHash: string): Promise<void> {
  // This is the intermediate login step from the HAR
  const formData = new FormData()
  formData.append('password', passwordHash)
  formData.append('tofaktorkode', '')

  const response = await fetch(`${BASE_URL}/login/login/${personId}`, {
    method: 'POST',
    headers: {
      ...(cookieJar.length > 0 ? { 'Cookie': getCookieHeader() } : {})
    },
    body: formData
  })

  extractCookies(response)
  const text = await response.text()
  console.log(`  Login step response: ${text}`)
}

async function getSession(): Promise<SessionResult> {
  const response = await fetch(`${BASE_URL}/rest/v0/VoUserData`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.oracle.adf.action+json',
      'Accept': 'application/json',
      ...(cookieJar.length > 0 ? { 'Cookie': getCookieHeader() } : {})
    },
    body: JSON.stringify({
      name: 'validateJsessionId'
    })
  })

  extractCookies(response)
  const data = await response.json()
  return JSON.parse(data.result)[0] as SessionResult
}

async function getChildren(sessionId: string): Promise<Child[]> {
  const url = `${BASE_URL}/rest/v0/VoBarn;jsessionid=${sessionId}?fields=Id,Fylkeid,Skoleid,Planperi,Elevnr,Elev,Klasse,Skolenavn,AntallMeldinger&onlyData=true&limit=5&totalResults=true`
  console.log(`  Fetching: ${url.slice(0, 80)}...`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      ...(cookieJar.length > 0 ? { 'Cookie': getCookieHeader() } : {})
    }
  })

  console.log(`  Response status: ${response.status}`)
  const text = await response.text()
  console.log(`  Response preview: ${text.slice(0, 100)}...`)

  try {
    const data = JSON.parse(text)
    return data.items as Child[]
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`)
  }
}

interface TimetableEntry {
  Id: string
  Dato: string
  Fradato: string
  Tildato: string
  Fag: string
  Fagnavn: string
  Romnr: string
  Faglaerer: string
}

async function getTimetable(
  sessionId: string,
  fylkeid: string,
  planperi: string,
  skoleid: string,
  elevnr: number,
  startDate: string,  // YYYY-MM-DD format
  endDate: string     // YYYY-MM-DD format
): Promise<TimetableEntry[]> {
  // Convert dates to YYYYMMDD format
  const startDateFormatted = startDate.replace(/-/g, '')
  const endDateFormatted = endDate.replace(/-/g, '')

  // Dates go inside the finder parameter
  const finder = `RESTFilter;fylkeid=${fylkeid},planperi=${planperi},skoleid=${skoleid},startDate=${startDateFormatted},endDate=${endDateFormatted},elevnr=${elevnr}`
  const url = `${BASE_URL}/rest/v0/VoTimeplan_elev;jsessionid=${sessionId}?finder=${encodeURIComponent(finder)}&onlyData=true&limit=1000&totalResults=true`

  console.log(`  Fetching: ${url.slice(0, 120)}...`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      ...(cookieJar.length > 0 ? { 'Cookie': getCookieHeader() } : {})
    }
  })

  console.log(`  Response status: ${response.status}`)
  const text = await response.text()

  try {
    const data = JSON.parse(text)
    return data.items as TimetableEntry[]
  } catch {
    console.log(`  Response preview: ${text.slice(0, 150)}...`)
    throw new Error(`Invalid JSON`)
  }
}

interface Message {
  Meldingid: number
  Mottatt: string
  Apnet: string | null
  Emne: string
  Lname: string
  Fname: string
  Epost: string
  Tekst: string
  Elevnr: number
  Elevnavn: string
}

async function getMessages(sessionId: string): Promise<Message[]> {
  // elevnr=0 gets all messages
  const finder = `RESTFilter;mappeid=INB,elevnr=0`
  const url = `${BASE_URL}/rest/v0/VoPostkasse;jsessionid=${sessionId}?finder=${encodeURIComponent(finder)}&fields=Meldingid,Mottatt,Apnet,Emne,Lname,Fname,Epost,Tekst,Elevnr,Elevnavn&onlyData=true&limit=10&offset=0&totalResults=true`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      ...(cookieJar.length > 0 ? { 'Cookie': getCookieHeader() } : {})
    }
  })

  const data = await response.json()
  return data.items as Message[]
}

interface Absence {
  Id: string
  Dato: string
  Fag: string
  Typefravaer: string
  Merknad: string | null
  Dokumentasjonstypetekst: string | null
}

async function getAbsences(sessionId: string, elevnr: number): Promise<Absence[]> {
  const finder = `RESTFilter;elevnr=${elevnr}`
  const url = `${BASE_URL}/rest/v0/VoFravaer_alt;jsessionid=${sessionId}?finder=${encodeURIComponent(finder)}&onlyData=true&limit=100&totalResults=true`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      ...(cookieJar.length > 0 ? { 'Cookie': getCookieHeader() } : {})
    }
  })

  const data = await response.json()
  return data.items as Absence[]
}

interface SchoolCalendarDay {
  Dato: string
  Uke: string
  Mandag: string | null
  Tirsdag: string | null
  Onsdag: string | null
  Torsdag: string | null
  Fredag: string | null
  Lordag: string | null
  Sondag: string | null
  SkoletypeMandag: string | null
  SkoletypeTirsdag: string | null
  SkoletypeOnsdag: string | null
  SkoletypeTorsdag: string | null
  SkoletypeFredag: string | null
  SkoletypeLordag: string | null
  SkoletypeSondag: string | null
}

async function getSchoolCalendar(
  sessionId: string,
  fylkeid: string,
  planperi: string,
  skoleid: string,
  month: number  // 1-12
): Promise<SchoolCalendarDay[]> {
  const finder = `RESTFilter;fylkeid=${fylkeid},planperi=${planperi},skoleid=${skoleid},maaned=${month.toString().padStart(2, '0')}`
  // HAR shows iskole_elev path works for this endpoint
  const url = `https://iskole.net/iskole_elev/rest/v0/VoSkolerute_maaned;jsessionid=${sessionId}?finder=${encodeURIComponent(finder)}&onlyData=true`

  console.log(`  Fetching: ${url.slice(0, 100)}...`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      ...(cookieJar.length > 0 ? { 'Cookie': getCookieHeader() } : {})
    }
  })

  console.log(`  Response status: ${response.status}`)
  const text = await response.text()

  if (!text) {
    console.log('  Empty response')
    return []
  }

  try {
    const data = JSON.parse(text)
    return data.items as SchoolCalendarDay[]
  } catch {
    console.log(`  Response preview: ${text.slice(0, 150)}...`)
    return []
  }
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/test-iskole.ts <fødselsnummer> <password>')
    process.exit(1)
  }

  const [username, password] = args
  const passwordHash = hashPassword(password)

  console.log('=== iSkole API PoC ===\n')
  console.log(`Username: ${username.slice(0, 6)}*****`)
  console.log(`Password hash: ${passwordHash.slice(0, 16)}...`)

  // Step 1: Validate credentials
  console.log('\n--- Step 1: Validate Credentials ---')
  let personId: string
  try {
    const loginResult = await validateCredentials(username, passwordHash)

    if (loginResult.ret_code < 0) {
      console.error(`Login failed: ${loginResult.error_text}`)
      process.exit(1)
    }

    personId = String(loginResult.ret_code)
    console.log(`Login OK! Name: ${loginResult.navn}`)
    console.log(`Person ID: ${personId}`)
    console.log(`2FA required: ${loginResult.tofaktor === '1' ? 'Yes' : 'No'}`)
    console.log(`Cookies collected: ${cookieJar.length}`)
  } catch (error) {
    console.error('Validation request failed:', error)
    process.exit(1)
  }

  // Step 2: Login step (establish session)
  console.log('\n--- Step 2: Login Step ---')
  try {
    await loginStep(personId, passwordHash)
    console.log(`Cookies after login step: ${cookieJar.length}`)
  } catch (error) {
    console.error('Login step failed:', error)
    // Continue anyway - might not be needed
  }

  // Step 3: Get session
  console.log('\n--- Step 3: Get Session ---')
  let session: SessionResult
  try {
    session = await getSession()
    console.log(`Session ID: ${session.jsessionid.slice(0, 20)}...`)
    console.log(`Full name: ${session.fullname}`)
    console.log(`Person ID: ${session.personid}`)
    console.log(`Number of children: ${session.antall_barn}`)
  } catch (error) {
    console.error('Session request failed:', error)
    process.exit(1)
  }

  // Step 4: Get children
  console.log('\n--- Step 4: Get Children ---')
  let children: Child[]
  try {
    children = await getChildren(session.jsessionid)
    console.log(`Found ${children.length} child(ren):`)
    for (const child of children) {
      console.log(`  - ${child.Elev} (${child.Klasse}) at ${child.Skolenavn}`)
      console.log(`    Elevnr: ${child.Elevnr}, Fylke: ${child.Fylkeid}, Skole: ${child.Skoleid}`)
    }
  } catch (error) {
    console.error('Children request failed:', error)
    process.exit(1)
  }

  // Step 5: Get timetable for first child
  if (children.length > 0) {
    console.log('\n--- Step 5: Get Timetable (this week) ---')
    const child = children[0]

    // Calculate this week's dates
    const today = new Date()
    const monday = new Date(today)
    monday.setDate(today.getDate() - today.getDay() + 1)
    const friday = new Date(monday)
    friday.setDate(monday.getDate() + 4)

    const startDate = monday.toISOString().split('T')[0]
    const endDate = friday.toISOString().split('T')[0]

    console.log(`Fetching timetable for ${child.Elev} from ${startDate} to ${endDate}`)

    try {
      const timetable = await getTimetable(
        session.jsessionid,
        child.Fylkeid,
        child.Planperi,
        child.Skoleid,
        child.Elevnr,
        startDate,
        endDate
      )

      console.log(`Found ${timetable.length} timetable entries:`)

      // Group by date
      const byDate = new Map<string, TimetableEntry[]>()
      for (const entry of timetable) {
        const date = entry.Dato
        if (!byDate.has(date)) byDate.set(date, [])
        byDate.get(date)!.push(entry)
      }

      for (const [date, entries] of byDate) {
        console.log(`\n  ${date}:`)
        for (const entry of entries.slice(0, 3)) {
          const start = entry.Fradato.split('T')[1]?.slice(0, 5) || '??:??'
          const end = entry.Tildato.split('T')[1]?.slice(0, 5) || '??:??'
          console.log(`    ${start}-${end}: ${entry.Fagnavn?.trim() || entry.Fag} (${entry.Faglaerer || 'N/A'})`)
        }
        if (entries.length > 3) {
          console.log(`    ... and ${entries.length - 3} more`)
        }
      }
    } catch (error) {
      console.error('Timetable request failed:', error)
    }
  }

  // Step 6: Get messages
  console.log('\n--- Step 6: Get Messages ---')
  try {
    const messages = await getMessages(session.jsessionid)
    console.log(`Found ${messages.length} messages (showing last 5):`)
    for (const msg of messages.slice(0, 5)) {
      const date = new Date(msg.Mottatt).toLocaleDateString('no-NO')
      const read = msg.Apnet ? '✓' : '○'
      console.log(`  ${read} [${date}] ${msg.Emne} - from ${msg.Fname} ${msg.Lname}`)
    }
  } catch (error) {
    console.error('Messages request failed:', error)
  }

  // Step 7: Get absences
  if (children.length > 0) {
    console.log('\n--- Step 7: Get Absences ---')
    try {
      const absences = await getAbsences(session.jsessionid, children[0].Elevnr)
      console.log(`Found ${absences.length} absence records:`)
      for (const absence of absences.slice(0, 5)) {
        const date = new Date(absence.Dato).toLocaleDateString('no-NO')
        const type = absence.Typefravaer === 'D' ? 'Day' : 'Hour'
        console.log(`  [${date}] ${type}: ${absence.Fag} - ${absence.Dokumentasjonstypetekst || 'Undocumented'}`)
      }
    } catch (error) {
      console.error('Absences request failed:', error)
    }
  }

  // Step 8: Get school calendar (skolerute)
  if (children.length > 0) {
    console.log('\n--- Step 8: Get School Calendar (December) ---')
    const child = children[0]
    try {
      const calendar = await getSchoolCalendar(
        session.jsessionid,
        child.Fylkeid,
        child.Planperi,
        child.Skoleid,
        12  // December
      )
      console.log(`Found ${calendar.length} weeks in December:`)

      // School type legend
      const typeMap: Record<string, string> = {
        'SD': 'School',
        'FD': 'Off',
        'PD': 'Planning'
      }

      for (const week of calendar) {
        const types = [
          week.SkoletypeMandag,
          week.SkoletypeTirsdag,
          week.SkoletypeOnsdag,
          week.SkoletypeTorsdag,
          week.SkoletypeFredag
        ].map(t => t ? typeMap[t] || t : '-')

        console.log(`  Week ${week.Uke}: Mon=${types[0]}, Tue=${types[1]}, Wed=${types[2]}, Thu=${types[3]}, Fri=${types[4]}`)
      }
    } catch (error) {
      console.error('School calendar request failed:', error)
    }
  }

  console.log('\n=== PoC Complete ===')
}

main()
