import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserHousehold } from '@/lib/supabase/household'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS, isDemoRequest, checkDemoRateLimit } from '@/lib/rate-limit'
import { extractJSON } from '@/lib/json-extract'
import { formatDateISO } from '@/lib/utils'
import { sanitizePromptInput, sanitizePromptArray } from '@/lib/sanitize'
import { ACTION_PARSE_SCHEMA, SEARCH_SUMMARY_SCHEMA, MEAL_SUGGESTION_SCHEMA } from '@/lib/ai-schemas'
import { getModel, getModelFromEnv, STRUCTURED_OUTPUT_PROVIDER_OPTIONS } from '@/lib/ai-models'
import { validateMealSuggestions, type FamilyContext } from '@/lib/ai-validation'
import { z } from 'zod'
import type { MealSuggestion } from '@/lib/types'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

// Request schema
const parseActionSchema = z.object({
  input: z.string().max(500).optional().default(''),
  image: z.string().optional(), // Base64 data URI for image analysis
  context: z.object({
    today: z.string(),
    children: z.array(z.object({
      id: z.string(),
      name: z.string(),
    })),
    members: z.array(z.object({
      id: z.string(),
      name: z.string(),
      isCurrentUser: z.boolean(),
    })),
  }),
}).refine(
  data => data.input.trim().length > 0 || data.image,
  { message: 'Må ha enten tekst eller bilde' }
)

// Mode detection patterns
const SEARCH_PREFIXES = ['?', '??']
const SEARCH_QUESTION_WORDS = /^(hva|når|hvor|hvem|hvorfor|hvordan|finnes|har vi|har jeg|er det|sa |skrev )/i
// More specific pattern for meal suggestions - must include suggestion-related words
// "forslag", "foreslå", or phrases like "hva skal vi ha til middag"
// Excludes simple "middag" which could be in "endre middag" or "fjern middag"
const MEAL_SUGGEST_KEYWORDS = /\b(forslag|foreslå|middagsforslag|hva skal vi (ha|spise)|foreslå mat)\b/i

type RequestMode = 'action' | 'search' | 'suggest'

// Helper to get Norwegian day name from date string
function getDayName(dateStr: string): string {
  const days = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
  const date = new Date(dateStr + 'T12:00:00') // Use noon to avoid timezone issues
  return days[date.getDay()]
}

// Helper to get tomorrow's date
function getTomorrow(todayStr: string): string {
  const today = new Date(todayStr + 'T12:00:00')
  today.setDate(today.getDate() + 1)
  return today.toISOString().split('T')[0]
}

// Helper to get the next occurrence of a weekday (0=Sunday, 5=Friday, 6=Saturday)
// "fra og med i dag" - includes today if today is that weekday
function getNextWeekday(todayStr: string, targetDay: number): string {
  const today = new Date(todayStr + 'T12:00:00')
  const todayDay = today.getDay()
  let daysToAdd = targetDay - todayDay
  // If already passed this week, go to next week
  if (daysToAdd < 0) daysToAdd += 7
  const target = new Date(today)
  target.setDate(today.getDate() + daysToAdd)
  return target.toISOString().split('T')[0]
}

// Helper to generate a date lookup table for the LLM
// Supports Norwegian, Swedish, and English weekday names
function getWeekdayDates(todayStr: string): string {
  // Weekday names in Norwegian, Swedish, and English (index 0=Sunday)
  const daysNb = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
  const daysSv = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag']
  const daysEn = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

  const today = new Date(todayStr + 'T12:00:00')
  const todayDay = today.getDay()

  const result: string[] = []

  // Calculate dates for each weekday
  for (let i = 0; i < 7; i++) {
    let daysFromToday = i - todayDay
    if (daysFromToday < 0) daysFromToday += 7

    const targetDate = new Date(today)
    targetDate.setDate(today.getDate() + daysFromToday)
    const dateStr = targetDate.toISOString().split('T')[0]

    // Show all language variants for this date
    const names = `"${daysNb[i]}"/"${daysSv[i]}"/"${daysEn[i]}"`
    if (daysFromToday === 0) {
      result.push(`- ${names} = ${dateStr} (i dag/idag/today)`)
    } else if (daysFromToday === 1) {
      result.push(`- ${names} = ${dateStr} (i morgen/imorgon/tomorrow)`)
    } else {
      result.push(`- ${names} = ${dateStr}`)
    }
  }

  // Also add "neste/nästa/next [weekday]" for clarity
  result.push('')
  result.push('For "neste/nästa/next [weekday]" (always 7+ days ahead):')
  for (let i = 1; i <= 5; i++) { // Mon-Fri only
    const targetDate = new Date(today)
    let daysFromToday = i - todayDay
    if (daysFromToday <= 0) daysFromToday += 7
    daysFromToday += 7
    targetDate.setDate(today.getDate() + daysFromToday)
    const dateStr = targetDate.toISOString().split('T')[0]
    result.push(`- "neste/nästa/next ${daysNb[i]}" = ${dateStr}`)
  }

  return result.join('\n')
}

function detectMode(input: string, hasImage: boolean): RequestMode {
  // Image analysis defaults to action mode
  if (hasImage) return 'action'

  const trimmed = input.trim()

  // Check for search prefixes (explicit search with ? or ??)
  for (const prefix of SEARCH_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return 'search'
    }
  }

  // Check for meal suggestion keywords BEFORE question words
  // This ensures "hva skal vi ha til middag" triggers suggest, not search
  if (MEAL_SUGGEST_KEYWORDS.test(trimmed)) {
    return 'suggest'
  }

  // Check for question words (only if not matching suggest pattern)
  if (SEARCH_QUESTION_WORDS.test(trimmed)) {
    return 'search'
  }

  return 'action'
}

// Response types
export type ActionType = 'meal' | 'child_task' | 'member_event' | 'pickup' | 'shopping_item' | 'household_event' | 'wishlist_item' | 'navigate'

export type ActionOperation = 'add' | 'modify' | 'delete' | 'complete' | 'edit'

export interface ParsedAction {
  type: ActionType
  operation: ActionOperation
  data: Record<string, unknown>
  display: {
    title: string
    subtitle: string
    icon: string
  }
  confidence: number
  needsClarification?: {
    field: string
    question: string
    options: Array<{
      label: string
      value: string | null
      resultType?: ActionType
    }>
  }
}

// Search result types
export interface SearchSource {
  type: 'message' | 'task' | 'event' | 'recipe' | 'meal'
  title: string
  excerpt: string
  date?: string
  id: string
  childName?: string
}

export interface SearchResponse {
  mode: 'search'
  answer: string
  sources: SearchSource[]
}

export interface SuggestResponse {
  mode: 'suggest'
  suggestions: MealSuggestion[]
}

export interface ActionResponse {
  mode: 'action'
  actions: ParsedAction[]
}

export type ParseActionResponse =
  | ActionResponse
  | SearchResponse
  | SuggestResponse
  | { error: string }

export async function POST(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    // Check if this is a demo mode request
    const isDemo = isDemoRequest(request)

    // Parse request body early (needed for both demo and production)
    const body = await request.json()
    const validation = parseActionSchema.safeParse(body)
    if (!validation.success) {
      return ApiErrors.validation('Ugyldig forespørsel')
    }
    const { input, image, context } = validation.data
    const hasImage = Boolean(image)

    // Detect request mode
    const mode = detectMode(input, hasImage)

    // Demo mode: use global rate limit and skip auth
    if (isDemo) {
      const demoRateLimit = await checkDemoRateLimit('aiParseReminders')
      if (demoRateLimit.limited) {
        return NextResponse.json(
          { error: `Demo-modus har nådd grensen. Prøv igjen om ${Math.ceil(demoRateLimit.retryAfter / 60)} minutter.` },
          { status: 429, headers: { 'Retry-After': String(demoRateLimit.retryAfter) } }
        )
      }

      // Demo mode: handle all modes with demo context
      return handleDemoMode(mode, input, image, context, hasImage)
    }

    // Production mode: require authentication
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return ApiErrors.unauthorized()
    }

    // Check rate limit (reuse aiParseReminders limit)
    const rateLimitKey = createRateLimitKey(user.id, 'aiParseReminders')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.aiParseReminders)
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `For mange forespørsler. Prøv igjen om ${rateLimit.retryAfter} sekunder.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Get household for all modes
    const { data: household, error: householdError } = await getUserHousehold(supabase)
    if (householdError || !household) {
      return ApiErrors.noHousehold()
    }

    // Handle search mode
    if (mode === 'search') {
      return handleSearchMode(supabase, input, household.id)
    }

    // Handle suggest mode
    if (mode === 'suggest') {
      return handleSuggestMode(supabase, input, household)
    }

    // --- ACTION MODE ---
    // Get model from app_settings with env fallback
    const modelType = hasImage ? 'vision' : 'text'
    const model = await getModel(supabase, modelType)

    const currentMember = context.members.find(m => m.isCurrentUser)

    // Build the prompt
    const systemPrompt = buildSystemPrompt(context)
    const userPrompt = hasImage
      ? buildVisionUserPrompt(input, image!, context, currentMember?.name)
      : buildUserPrompt(input, context, currentMember?.name)

    // Call OpenRouter API
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return ApiErrors.configError({ internalMessage: 'OPENROUTER_API_KEY not configured' })
    }

    // Build messages based on whether we have an image
    const messages = hasImage
      ? [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: image! } },
            ],
          },
        ]
      : [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ]

    // Set timeout for API call (15 seconds)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    let response: Response
    let retryWithoutSchema = false

    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
          'X-Title': 'Familjen',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: 2000,
          response_format: ACTION_PARSE_SCHEMA,
          ...STRUCTURED_OUTPUT_PROVIDER_OPTIONS,
        }),
        signal: controller.signal,
      })

      // If structured output fails for vision, retry without it
      if (!response.ok && hasImage && response.status === 400) {
        console.log('Vision request with structured output failed, retrying without schema...')
        retryWithoutSchema = true
      }
    } catch (fetchError) {
      clearTimeout(timeoutId)
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return ApiErrors.timeout({ internalMessage: 'Parse action request timed out' })
      }
      throw fetchError
    }

    // Retry vision request without structured output
    if (retryWithoutSchema) {
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
            'X-Title': 'Familjen',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.2,
            max_tokens: 2000,
            // No response_format - let the AI respond naturally
            // The prompt already instructs it to return JSON
          }),
          signal: controller.signal,
        })
      } catch (fetchError) {
        clearTimeout(timeoutId)
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          return ApiErrors.timeout({ internalMessage: 'Parse action retry request timed out' })
        }
        throw fetchError
      }
    }

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Could not read error body')
      return ApiErrors.internal({ internalMessage: `OpenRouter error: ${response.status} - ${errorBody}` })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return ApiErrors.internal({ internalMessage: 'Empty AI response in parse action' })
    }

    // Parse the JSON response using robust extraction
    interface RawAction {
      type: string
      operation?: string
      data?: Record<string, unknown>
      display?: { title?: string; subtitle?: string; icon?: string }
      confidence?: number
      needs_clarification?: ParsedAction['needsClarification']
    }

    const parsed = extractJSON<{ actions?: RawAction[] }>(content)
    if (!parsed) {
      // Log more details for debugging, especially for vision requests
      console.error('Failed to extract JSON from AI response:', {
        contentLength: content?.length,
        hasImage,
        model,
        // Log first 500 chars to understand what the AI returned
        contentPreview: content?.substring(0, 500),
      })
      // For vision requests, return empty actions instead of error (more graceful)
      if (hasImage) {
        return NextResponse.json({
          mode: 'action',
          actions: [],
        } as ActionResponse)
      }
      return ApiErrors.internal({ internalMessage: 'Failed to parse AI response' })
    }

    const actions: ParsedAction[] = (parsed.actions || []).map((a) => ({
      type: a.type as ActionType,
      operation: (a.operation || 'add') as ActionOperation,
      data: a.data || {},
      display: {
        title: a.display?.title || '',
        subtitle: a.display?.subtitle || '',
        icon: a.display?.icon || '📝',
      },
      confidence: typeof a.confidence === 'number' ? a.confidence : 0.5,
      needsClarification: a.needs_clarification || undefined,
    }))

    return NextResponse.json({ mode: 'action', actions } as ActionResponse)
  } catch (error) {
    return handleApiError(error, 'parse action')
  }
}

function buildSystemPrompt(context: z.infer<typeof parseActionSchema>['context']): string {
  return `Du er en assistent for en norsk familieplanleggingsapp. Din oppgave er å tolke brukerens naturlige språk og returnere strukturerte handlinger.

OPERASJONER:
- "add" - Legg til ny (standard for de fleste handlinger)
- "modify" - Endre eksisterende (brukes KUN for pickup - hvem som henter)
- "edit" - Rediger eksisterende element (endre tid, dato, tittel, etc.)
- "delete" - Fjern/slett eksisterende (KREVER BEKREFTELSE fra bruker)
- "complete" - Marker som ferdig/kjøpt (KUN for child_task og shopping_item)

STØTTEDE OPERASJONER PER TYPE:
| Type            | add | modify | edit | delete | complete |
|-----------------|-----|--------|------|--------|----------|
| meal            | ✓   | -      | ✓    | ✓      | -        |
| shopping_item   | ✓   | -      | ✓    | ✓      | ✓        |
| child_task      | ✓   | -      | ✓    | ✓      | ✓        |
| member_event    | ✓   | -      | ✓    | ✓      | -        |
| pickup          | -   | ✓      | -    | ✓      | -        |
| household_event | ✓   | -      | ✓    | ✓      | -        |
| wishlist_item   | ✓   | -      | ✓    | ✓      | -        |
| navigate        | ✓   | -      | -    | -      | -        |

VIKTIG:
- Bruk ALDRI "complete" for meal, member_event eller pickup!
- Bruk "modify" KUN for pickup (endre hvem som henter)
- Bruk "edit" for å endre egenskaper på eksisterende elementer

HANDLINGSTYPER:

1. "meal" - Middag/måltid (til middagsplan)
   - Brukes når: "taco fredag", "pizza i morgen", "laks på lørdag" (NB: bare når det skal på MIDDAGSPLANEN)
   - operation: "add" (ny middag), "delete" (fjern middag)
   - Data: { date, meal_name }

2. "shopping_item" - Handlelistevare
   - Brukes når: "kjøp melk", "legg til brød på handlelista", "vi trenger såpe"
   - VIKTIG: Hvis brukeren sier "handleliste/handlelista/handle", bruk ALLTID denne typen
   - Matvarer som skal KJØPES (ikke planlegges som middag) = shopping_item
   - operation: "add" (ny vare), "delete" (fjern vare), "complete" (kjøpt/avhuket)
   - list_type: "produce" (dagligvarer/mat) eller "other" (andre butikker/spesialvarer)
   - Data: { item_name, quantity?, list_type }

   VELG list_type:
   - "produce": matvarer, dagligvarer, husholdning (melk, brød, såpe, toalettpapir)
   - "other": spesialbutikker, byggevarer, apotek, elektronikk (skruer, medisin, kabler)
   - Hvis usikker, sett needs_clarification med valg mellom listene

3. "child_task" - Oppgave for barn
   - Brukes når: "Storm tannlege tirsdag", "Ylva må ha med gymtøy", "barnehagen stengt fredag"
   - operation: "add" (ny oppgave), "edit" (endre oppgave), "delete" (slett oppgave), "complete" (ferdig/gjort)
   - task_type: "bring" (ta med noe), "appointment" (tannlege, lege, møte), "reminder" (påminnelse), "activity" (aktivitet, kurs, trening), "closure" (stengt, fri, ferie), "other" (annet)
   - Data for add: { date, time?, title, task_type, child_id?, child_name? }
   - Data for edit: { original_title, new_title?, new_date?, new_time?, child_id? }
   - VIKTIG: child_id er PÅKREVD for add. Hvis barn ikke er spesifisert, sett needs_clarification med barneliste

4. "member_event" - Hendelse for voksen
   - Brukes når: "jeg er i Bergen onsdag", "pappa på jobbtur", "mamma på kurs"
   - operation: "add" (ny hendelse), "edit" (endre hendelse), "delete" (avlys/slett hendelse)
   - event_type: Velg basert på innhold:
     - "work": jobb, jobbtur, jobbmøte, konferanse, arbeid, kunde, prosjekt
     - "travel": reise, reiser, fly, tog, ferie, tur, weekend, utland
     - "family": familie, besøk, bursdag, selskap, bryllup, dåp
     - "other": kurs, trening, aktivitet, lege, tannlege, frisør, møte (ikke jobb)
   - Data for add: { date, end_date?, title, event_type, member_id?, member_name? }
   - Data for edit: { original_title, new_title?, new_date?, new_end_date?, new_event_type?, member_id? }

5. "household_event" - Familiehendelse (gjelder hele familien)
   - Brukes når: "hyttetur neste helg", "familiedag lørdag", "besøk av besteforeldre", "vi drar på ferie"
   - VIKTIG: Bruk dette når hendelsen gjelder HELE familien, ikke bare én person
   - operation: "add" (ny familiehendelse), "edit" (endre), "delete" (slett/avlys)
   - Data for add: { date, end_date?, title, time?, location? }
   - Data for edit: { original_title, new_title?, new_date?, new_end_date?, new_time?, new_location? }
   - Eksempler på familiehendelser:
     - "hyttetur fredag til søndag" → date=fredag, end_date=søndag
     - "familiedag på lørdag" → date=lørdag
     - "ferie neste uke" → date=mandag, end_date=søndag

6. "pickup" - Endring av henting
   - Brukes når: "jeg henter Storm i morgen", "pappa henter begge på fredag"
   - operation: "modify" (endre hvem som henter), "delete" (ingen henter / avlys henting)
   - Data: { date, child_id?, child_name?, picker_id?, picker_name? }

7. "wishlist_item" - Ønske på ønskeliste
   - Brukes når: "legg lego til Storms ønskeliste", "nintendo switch til jul", "sykkel på bursdag", "ønskeliste"
   - VIKTIG: ALLTID krev spesifisering av hvilke(t) barn/person ønsket gjelder (needs_clarification)
   - operation: "add" (nytt ønske), "edit" (endre ønske), "delete" (slett ønske)
   - occasion: "birthday" (bursdag), "christmas" (jul), "general" (generelt/uspesifisert)
   - Data for add: { item_name, child_id?, child_name?, member_id?, member_name?, occasion?, priority?, price?, link?, description? }
   - Data for edit: { original_name, new_name?, new_occasion?, new_priority?, child_id? }
   - Data for delete: { item_name, child_id?, child_name?, member_id?, member_name? }
   - priority: 0-5 (0=ingen prioritet, 5=veldig viktig)
   - VIKTIG: Hvis barn/person ikke er spesifisert, MÅ du sette needs_clarification med liste over barn+voksne
   - Eksempler:
     - "legg lego til Storms ønskeliste" → child_name=Storm, item_name=lego
     - "nintendo switch til jul for Emma" → child_name=Emma, item_name=nintendo switch, occasion=christmas
     - "jeg ønsker meg en sykkel til bursdag" → needs_clarification for member_id (hvem er "jeg"?)

8. "navigate" - Navigasjon til ønskeliste
   - Brukes når: "vis ønskelisten til Storm", "hva ønsker Emma seg?", "gå til ønskelister", "åpne ønskelista"
   - operation: "add" (navigasjon er alltid "add")
   - destination: "wishlist" (ønskeliste-siden på handleliste)
   - Data: { destination: "wishlist", child_id?, child_name?, member_id?, member_name? }
   - Hvis person ikke er spesifisert, navigerer til ønskelisteoversikten
   - Eksempler:
     - "vis ønskelisten til Storm" → destination=wishlist, child_name=Storm
     - "gå til ønskelister" → destination=wishlist (ingen person)

VIKTIG FOR SHOPPING vs MEAL:
- "legg laks til handlelista" = shopping_item (skal KJØPES)
- "laks til middag fredag" = meal (skal PLANLEGGES som middag)
- Når brukeren eksplisitt sier "handleliste/handlelista" = ALLTID shopping_item

SLETT-OPERASJONER (operation: "delete"):
Nøkkelord: "fjern", "slett", "avlys", "dropp", "ikke", "ta bort"
- "fjern taco fra fredag" → meal, delete, date=fredag
- "slett tannlege tirsdag" → child_task, delete, title=tannlege, date=tirsdag
- "fjern melk fra handlelista" → shopping_item, delete, item_name=melk
- "avlys jobbtur onsdag" → member_event, delete, title=jobbtur, date=onsdag
- "ingen henter Storm fredag" → pickup, delete, child_name=Storm, date=fredag

FERDIG-OPERASJONER (operation: "complete"):
Nøkkelord: "ferdig", "gjort", "kjøpt", "har med", "ok", "check", "huket av"
- "ferdig med gymtøy" → child_task, complete, title=gymtøy
- "Storm har med sekk" → child_task, complete, child_name=Storm
- "kjøpt melk" → shopping_item, complete, item_name=melk
- "melk ok" → shopping_item, complete, item_name=melk

REDIGER-OPERASJONER (operation: "edit"):
Nøkkelord: "endre", "flytt", "oppdater", "til kl", "i stedet for", "bytt"
- "endre tannlege til kl 14" → child_task, edit, original_title=tannlege, new_time=14:00
- "flytt middag til lørdag" → meal, edit, new_date=lørdag (flytter dagens middag)
- "flytt tannlege til onsdag" → child_task, edit, original_title=tannlege, new_date=onsdag
- "endre jobbtur til torsdag-fredag" → member_event, edit, original_title=jobbtur, new_date=torsdag, new_end_date=fredag
- "endre Storm sin tannlege" → child_task, edit, original_title=tannlege, child_name=Storm

VIKTIG FOR EDIT:
- Bruk original_title for å finne elementet som skal redigeres
- Inkluder child_name/member_name hvis nevnt for å hjelpe med å finne riktig element
- Sett bare de feltene som skal endres (new_title, new_date, new_time, etc.)
- Koden vil søke etter treff og spørre brukeren hvis flere elementer matcher

REGLER:

1. I dag er ${context.today} (${getDayName(context.today)})
2. Hvis "jeg" brukes, referer til nåværende bruker
3. Hvis barn/person ikke kan identifiseres sikkert, sett needs_clarification

DATOER FOR UKEDAGER (BRUK DISSE - IKKE REGN SELV):
${getWeekdayDates(context.today)}

EKSEMPLER PÅ DATO-TOLKNING:
- "taco fredag" → date="${getNextWeekday(context.today, 5)}"
- "pizza lørdag" → date="${getNextWeekday(context.today, 6)}"
- "i morgen" → date="${getTomorrow(context.today)}"

BARN I FAMILIEN:
${context.children.map(c => `- ${c.name} (id: ${c.id})`).join('\n')}

VOKSNE I FAMILIEN:
${context.members.map(m => `- ${m.name} (id: ${m.id})${m.isCurrentUser ? ' [deg]' : ''}`).join('\n')}

SVAR FORMAT (JSON):
{
  "actions": [
    {
      "type": "meal|shopping_item|child_task|member_event|household_event|pickup",
      "operation": "add|modify|edit|delete|complete",
      "data": { ... },
      "display": {
        "title": "Kort beskrivelse",
        "subtitle": "Dato/tid info",
        "icon": "🍕|📅|✈️|🚗"
      },
      "confidence": 0.0-1.0,
      "needs_clarification": null | {
        "field": "child_id|member_id|picker_id",
        "question": "Spørsmål på norsk",
        "options": [
          { "label": "Visningsnavn", "value": "uuid", "result_type": "child_task" }
        ]
      }
    }
  ]
}

IKONER:
- meal: 🍕🌮🍝🍗🐟
- shopping_item/produce: 🛒🥛🍞🧴
- shopping_item/other: 🔧💊🔌
- child_task/bring: 🎒
- child_task/appointment: 🏥🦷
- child_task/reminder: 📌⚽🏠
- child_task/other: 📝
- member_event: ✈️💼🎓
- household_event: 🏠🏕️🎄👨‍👩‍👧‍👦
- pickup: 🚗
- wishlist_item: 🎁🎄🎂
- navigate: 📍🔗

FOR DELETE-OPERASJONER: Bruk 🗑️ først, så relevant ikon (f.eks. "🗑️🍕" for slett middag)
FOR COMPLETE-OPERASJONER: Bruk ✅ først, så relevant ikon (f.eks. "✅🛒" for kjøpt vare)
FOR EDIT-OPERASJONER: Bruk ✏️ først, så relevant ikon (f.eks. "✏️🦷" for endre tannlege-tid)

NEEDS_CLARIFICATION FOR SHOPPING:
Hvis du er usikker på hvilken liste, bruk dette format:
{
  "needs_clarification": {
    "field": "list_type",
    "question": "Hvilken liste skal varen på?",
    "options": [
      { "label": "Dagligvarer", "value": "produce" },
      { "label": "Andre butikker", "value": "other" }
    ]
  }
}

NEEDS_CLARIFICATION FOR CHILD_TASK:
Når barn ikke er spesifisert for child_task (add), MÅ du sette needs_clarification:
{
  "needs_clarification": {
    "field": "child_id",
    "question": "Hvilke barn gjelder dette?",
    "options": [
      // Liste over alle barn fra konteksten
    ]
  }
}

NEEDS_CLARIFICATION FOR PICKUP:
Når barn ikke er spesifisert for pickup, MÅ du sette needs_clarification:
{
  "needs_clarification": {
    "field": "child_id",
    "question": "Hvem skal hentes?",
    "options": [
      // Liste over alle barn fra konteksten
    ]
  }
}

NEEDS_CLARIFICATION FOR WISHLIST_ITEM:
VIKTIG: Ønskeliste-elementer MÅ ALLTID spesifisere hvem ønsket er for.
Hvis barn/person ikke er spesifisert, MÅ du sette needs_clarification:
{
  "needs_clarification": {
    "field": "person_id",
    "question": "Hvem sin ønskeliste?",
    "options": [
      // Liste over alle barn OG voksne fra konteksten
      // { "label": "Storm", "value": "child_uuid", "result_type": "wishlist_item" },
      // { "label": "Mamma", "value": "member_uuid", "result_type": "wishlist_item" }
    ]
  }
}

VIKTIG:
- Returner BARE gyldig JSON
- Sett operation="modify" for pickup (endrer alltid eksisterende hentinger)
- Sett needs_clarification hvis du er usikker på hvem handlingen gjelder
- confidence bør være høy (0.8+) kun når du er sikker

CONFIDENCE-NIVÅER:
- 0.9-1.0: Helt tydelig hva brukeren vil (f.eks. "taco på fredag")
- 0.7-0.9: Klar intensjon men noe usikkerhet (f.eks. "middag i morgen" - usikkert hvilken rett)
- 0.5-0.7: Delvis forståelig, trenger kanskje avklaring
- 0.3-0.5: Uklar input, gjetter på betydning
- 0.0-0.3: Meningsløs/uforståelig input (f.eks. "abc123", "asdf", tilfeldig tekst)

FOR UFORSTÅELIG INPUT:
Hvis input ikke gir mening som en familieplanleggingshandling (f.eks. tilfeldige bokstaver, tall, kode, eller tekst som ikke relaterer til middager, oppgaver, henting, ønskelister, etc.):
- Returner tom actions-array: { "actions": [] }
- ELLER returner handling med confidence < 0.3`
}

function buildUserPrompt(
  input: string,
  context: z.infer<typeof parseActionSchema>['context'],
  currentUserName?: string
): string {
  // Sanitize user input to prevent prompt injection
  const safeInput = sanitizePromptInput(input, 500)
  const safeName = currentUserName ? sanitizePromptInput(currentUserName, 50) : 'ukjent'

  return `Tolk følgende og returner handlinger:

<user_input>
${safeInput}
</user_input>

Kontekst:
- I dag: ${context.today} (${getDayName(context.today)})
- Nåværende bruker: ${safeName}
- Barn: ${context.children.map(c => c.name).join(', ') || 'ingen'}
- Voksne: ${context.members.map(m => m.name).join(', ') || 'ingen'}`
}

function buildVisionUserPrompt(
  input: string,
  _image: string,
  context: z.infer<typeof parseActionSchema>['context'],
  currentUserName?: string
): string {
  // Sanitize user input to prevent prompt injection
  const safeInput = sanitizePromptInput(input, 500)
  const safeName = currentUserName ? sanitizePromptInput(currentUserName, 50) : 'ukjent'

  const baseContext = `
Kontekst:
- I dag: ${context.today} (${getDayName(context.today)})
- Nåværende bruker: ${safeName}
- Barn: ${context.children.map(c => c.name).join(', ') || 'ingen'}
- Voksne: ${context.members.map(m => m.name).join(', ') || 'ingen'}`

  const childrenOptions = context.children.map(c => `{ "label": "${c.name}", "value": "${c.id}" }`).join(', ')
  const allPersonOptions = [...context.children.map(c => `{ "label": "${c.name}", "value": "${c.id}" }`), ...context.members.map(m => `{ "label": "${m.name}", "value": "${m.id}" }`)].join(', ')

  // If user provided additional text context, include it as a strong directive
  const userNote = safeInput
    ? `\n\n<user_instruction>
${safeInput}
</user_instruction>
Brukeren har gitt denne instruksjonen for hvordan bildet skal tolkes.`
    : ''

  return `Analyser dette bildet og tolk innholdet til en familieplanleggingshandling.
${userNote}

${baseContext}

Bruk din intelligens til å forstå hva bildet viser og returner passende handling(er).

Eksempler på hva bilder kan inneholde:
- Bursdagsinvitasjon → child_task (appointment) med dato, tid, sted
- Produkt/leke/gave → wishlist_item (MÅ ha needs_clarification for person_id)
- Meny/handleliste → shopping_item(s)
- Mat/oppskrift → meal
- Kalender/påminnelse → child_task eller member_event

VIKTIG:
- Barn: [${childrenOptions}]
- Alle personer (for wishlist): [${allPersonOptions}]
- For wishlist_item: ALLTID sett needs_clarification med person_id
- For child_task uten spesifisert barn: sett needs_clarification med child_id
- Returner BARE gyldig JSON: { "actions": [...] }
- confidence 0.8+ kun hvis sikker, ellers lavere
- Hvis bildet er uklart/irrelevant: { "actions": [] }`
}

// ============================================================================
// SEARCH MODE HANDLER
// ============================================================================

interface SearchableData {
  tasks: Array<{ id: string; title: string; date: string; child_name?: string }>
  events: Array<{ id: string; title: string; date: string; member_name?: string }>
  recipes: Array<{ id: string; name: string; description?: string }>
  meals: Array<{ id: string; date: string; meal_name: string }>
  messages: Array<{ id: string; title: string; body: string; date: string; source: string }>
}

/**
 * Handle demo mode requests - uses real AI with demo context
 * This allows demo mode to find real issues in production AI code
 */
async function handleDemoMode(
  mode: RequestMode,
  input: string,
  image: string | undefined,
  context: z.infer<typeof parseActionSchema>['context'],
  hasImage: boolean
): Promise<Response> {
  // Fetch model from app_settings (same as production)
  // Demo uses same model as production to ensure consistent behavior
  const supabase = await createClient()
  const modelType = hasImage ? 'vision' : 'text'
  const model = await getModel(supabase, modelType)

  // For search mode in demo, return mock search results
  // (no database to query in demo mode)
  if (mode === 'search') {
    const searchQuery = input.replace(/^\?+\s*/, '').trim()
    return NextResponse.json({
      mode: 'search',
      answer: `Demo-modus: Søk etter "${searchQuery}" ville søkt i meldinger, oppgaver og hendelser fra barnehage og skole.`,
      sources: [
        {
          type: 'message' as const,
          title: 'Eksempel melding',
          excerpt: 'Dette er et eksempel på en melding fra barnehagen.',
          date: formatDateISO(new Date()),
          id: 'demo-msg-1',
        }
      ],
    } as SearchResponse)
  }

  // For suggest mode in demo, use real AI for meal suggestions
  if (mode === 'suggest') {
    // Generate week start date
    const today = new Date()
    const weekStart = formatDateISO(today)

    // Demo context for meal suggestions
    const demoMealContext = {
      allergies: ['gluten', 'nøtter'],
      childrenAges: [6, 4],
      weekContext: 'Demo-uke - foreslå familievennlige retter',
      existingMeals: [],
      recipes: [
        { id: 'demo-1', name: 'Pasta Bolognese', is_favorite: true },
        { id: 'demo-2', name: 'Fiskegrateng', is_favorite: false },
      ],
      recentMealNames: ['Taco', 'Pizza'],
    }

    // Build suggestion prompt
    const contextStr = JSON.stringify({
      weekStart,
      allergies: demoMealContext.allergies,
      childrenAges: demoMealContext.childrenAges,
      recipes: demoMealContext.recipes.map(r => ({ id: r.id, name: r.name })),
      favoriteRecipes: demoMealContext.recipes.filter(r => r.is_favorite),
      recentMealNames: demoMealContext.recentMealNames,
      existingMeals: demoMealContext.existingMeals,
      weekContext: demoMealContext.weekContext,
      allAllergies: demoMealContext.allergies,
    }, null, 2)

    const suggestPrompt = `Du er en kreativ matplanlegger for en norsk familie. Foreslå middager for uken.

KONTEKST:
${contextStr}

Foreslå 3-5 middager som passer familien. Unngå allergier og ta hensyn til barnas alder.
Returner JSON: { "suggestions": [{ "day": "YYYY-MM-DD", "name": "Rett", "description": "Kort beskrivelse", "ingredients": [{ "item": "ingrediens", "amount": "mengde" }] }] }`

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://familjen.eu',
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: suggestPrompt }],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      })

      if (!response.ok) {
        console.error('Demo suggest API error:', response.status)
        return ApiErrors.serviceUnavailable({ internalMessage: 'Demo suggest API error' })
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content || ''
      const parsed = extractJSON<{ suggestions?: MealSuggestion[] }>(content)

      if (!parsed?.suggestions) {
        return NextResponse.json({
          mode: 'suggest',
          suggestions: [],
        } as SuggestResponse)
      }

      return NextResponse.json({
        mode: 'suggest',
        suggestions: parsed.suggestions,
      } as SuggestResponse)
    } catch (error) {
      return handleApiError(error, 'demo suggest')
    }
  }

  // Action mode: use real AI to parse natural language
  const currentMember = context.members.find(m => m.isCurrentUser)
  const systemPrompt = buildSystemPrompt(context)
  const userPrompt = hasImage
    ? buildVisionUserPrompt(input, image!, context, currentMember?.name)
    : buildUserPrompt(input, context, currentMember?.name)

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      hasImage
        ? {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: image! } },
            ],
          }
        : { role: 'user', content: userPrompt },
    ]

    let response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://familjen.eu',
      },
      body: JSON.stringify({
        model: model,
        messages,
        temperature: 0.3,
        max_tokens: 2000,
        response_format: ACTION_PARSE_SCHEMA,
        ...STRUCTURED_OUTPUT_PROVIDER_OPTIONS,
      }),
    })

    // If structured output fails for vision, retry without it
    if (!response.ok && hasImage && response.status === 400) {
      console.log('Demo vision request with structured output failed, retrying without schema...')
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://familjen.eu',
        },
        body: JSON.stringify({
          model: model,
          messages,
          temperature: 0.3,
          max_tokens: 2000,
          // No response_format - let the AI respond naturally
        }),
      })
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Demo action API error:', { status: response.status, model, hasImage, error: errorText })
      return ApiErrors.serviceUnavailable({ internalMessage: 'Demo action API error' })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({
        mode: 'action',
        actions: [],
      } as ActionResponse)
    }

    const parsed = extractJSON<{ actions?: ParsedAction[] }>(content)
    if (!parsed?.actions || !Array.isArray(parsed.actions)) {
      // Log for debugging
      console.log('Demo vision JSON extraction failed:', { contentLength: content?.length, contentPreview: content?.substring(0, 200) })
      return NextResponse.json({
        mode: 'action',
        actions: [],
      } as ActionResponse)
    }

    return NextResponse.json({
      mode: 'action',
      actions: parsed.actions,
    } as ActionResponse)
  } catch (error) {
    return handleApiError(error, 'demo action')
  }
}

async function handleSearchMode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: string,
  householdId: string
): Promise<Response> {
  // Remove search prefix if present
  let searchQuery = input.trim()
  for (const prefix of SEARCH_PREFIXES) {
    if (searchQuery.startsWith(prefix)) {
      searchQuery = searchQuery.slice(prefix.length).trim()
      break
    }
  }

  // Sanitize search query to prevent prompt injection
  const safeSearchQuery = sanitizePromptInput(searchQuery, 200)

  // Extract keywords for database search
  const keywords = safeSearchQuery.toLowerCase().split(/\s+/).filter(k => k.length > 2)

  // Query all searchable data in parallel
  const today = new Date()
  const threeMonthsAgo = new Date(today)
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const threeMonthsAhead = new Date(today)
  threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3)

  const [tasksResult, eventsResult, recipesResult, mealsResult, messagesResult] = await Promise.all([
    // Child tasks
    supabase
      .from('child_tasks')
      .select('id, title, date, child:children(name)')
      .eq('household_id', householdId)
      .gte('date', formatDateISO(threeMonthsAgo))
      .lte('date', formatDateISO(threeMonthsAhead))
      .order('date', { ascending: false })
      .limit(50),

    // Member events + household events
    supabase
      .from('member_events')
      .select('id, title, date, member:household_members(name)')
      .eq('household_id', householdId)
      .gte('date', formatDateISO(threeMonthsAgo))
      .lte('date', formatDateISO(threeMonthsAhead))
      .order('date', { ascending: false })
      .limit(30),

    // Recipes
    supabase
      .from('recipes')
      .select('id, name, description')
      .eq('household_id', householdId)
      .limit(50),

    // Meals
    supabase
      .from('meals')
      .select('id, date, custom_meal, recipe:recipes(name)')
      .eq('household_id', householdId)
      .gte('date', formatDateISO(threeMonthsAgo))
      .lte('date', formatDateISO(threeMonthsAhead))
      .order('date', { ascending: false })
      .limit(30),

    // External messages (from integrations) - join through integration to filter by household
    supabase
      .from('external_messages')
      .select('id, title, body, message_date, integration:external_integrations!inner(service, household_id)')
      .eq('external_integrations.household_id', householdId)
      .order('message_date', { ascending: false })
      .limit(50),
  ])

  // Process and filter results by keywords
  const searchableData: SearchableData = {
    tasks: (tasksResult.data || [])
      .filter(t => keywords.some(k => t.title.toLowerCase().includes(k)))
      .map(t => ({
        id: t.id,
        title: t.title,
        date: t.date,
        child_name: (t.child as unknown as { name: string } | null)?.name,
      })),
    events: (eventsResult.data || [])
      .filter(e => keywords.some(k => e.title.toLowerCase().includes(k)))
      .map(e => ({
        id: e.id,
        title: e.title,
        date: e.date,
        member_name: (e.member as unknown as { name: string } | null)?.name,
      })),
    recipes: (recipesResult.data || [])
      .filter(r => keywords.some(k =>
        r.name.toLowerCase().includes(k) ||
        (r.description?.toLowerCase().includes(k) ?? false)
      )),
    meals: (mealsResult.data || [])
      .filter(m => {
        const mealName = (m.recipe as unknown as { name: string } | null)?.name || m.custom_meal || ''
        return keywords.some(k => mealName.toLowerCase().includes(k))
      })
      .map(m => ({
        id: m.id,
        date: m.date,
        meal_name: (m.recipe as unknown as { name: string } | null)?.name || m.custom_meal || '',
      })),
    messages: (messagesResult.data || [])
      .filter(msg =>
        keywords.some(k =>
          msg.title?.toLowerCase().includes(k) ||
          msg.body?.toLowerCase().includes(k)
        )
      )
      .map(msg => ({
        id: msg.id,
        title: msg.title || 'Melding',
        body: msg.body?.substring(0, 200) || '',
        date: msg.message_date,
        source: (msg.integration as unknown as { service: string } | null)?.service || 'ukjent',
      })),
  }

  // Build sources array
  const sources: SearchSource[] = [
    ...searchableData.tasks.slice(0, 5).map(t => ({
      type: 'task' as const,
      id: t.id,
      title: t.title,
      excerpt: t.child_name ? `${t.child_name} - ${t.date}` : t.date,
      date: t.date,
      childName: t.child_name,
    })),
    ...searchableData.events.slice(0, 5).map(e => ({
      type: 'event' as const,
      id: e.id,
      title: e.title,
      excerpt: e.member_name ? `${e.member_name} - ${e.date}` : e.date,
      date: e.date,
    })),
    ...searchableData.recipes.slice(0, 3).map(r => ({
      type: 'recipe' as const,
      id: r.id,
      title: r.name,
      excerpt: r.description?.substring(0, 100) || 'Oppskrift i kokebok',
    })),
    ...searchableData.meals.slice(0, 5).map(m => ({
      type: 'meal' as const,
      id: m.id,
      title: m.meal_name,
      excerpt: `Planlagt ${m.date}`,
      date: m.date,
    })),
    ...searchableData.messages.slice(0, 5).map(msg => ({
      type: 'message' as const,
      id: msg.id,
      title: msg.title,
      excerpt: `${msg.source}: ${msg.body.substring(0, 100)}...`,
      date: msg.date,
    })),
  ]

  // If we found results, use AI to summarize/answer
  if (sources.length > 0) {
    const model = await getModel(supabase, 'text')
    const apiKey = process.env.OPENROUTER_API_KEY

    if (!apiKey) {
      return NextResponse.json({
        mode: 'search',
        answer: `Fant ${sources.length} resultater for "${safeSearchQuery}"`,
        sources,
      } as SearchResponse)
    }

    // Call AI to summarize
    const summaryPrompt = `Brukeren søker etter:
<search_query>
${safeSearchQuery}
</search_query>

Følgende data ble funnet:
${sources.map(s => `- ${s.type}: ${s.title} (${s.excerpt})`).join('\n')}

Gi et kort, hjelpsomt svar på norsk basert på resultatene. Hvis noe spesifikt ble spurt om (som en dato eller en person), svar direkte på det. Hold svaret under 100 ord. Returner som JSON med "summary" felt.`

    // Set timeout for search summary (10 seconds - faster for simpler task)
    const searchController = new AbortController()
    const searchTimeoutId = setTimeout(() => searchController.abort(), 10000)

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
          'X-Title': 'Familjen',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Du er en hjelpsom assistent for en familieplanleggingsapp. Svar kort og konsist på norsk.' },
            { role: 'user', content: summaryPrompt },
          ],
          temperature: 0.3,
          max_tokens: 300,
          response_format: SEARCH_SUMMARY_SCHEMA,
        }),
        signal: searchController.signal,
      })

      clearTimeout(searchTimeoutId)

      if (response.ok) {
        const data = await response.json()
        const content = data.choices?.[0]?.message?.content
        const parsed = content ? extractJSON<{ summary: string }>(content) : null
        const answer = parsed?.summary || `Fant ${sources.length} resultater`

        return NextResponse.json({
          mode: 'search',
          answer,
          sources,
        } as SearchResponse)
      }
    } catch (error) {
      clearTimeout(searchTimeoutId)
      console.error('Search AI summary error:', error)
    }

    // Fallback without AI summary
    return NextResponse.json({
      mode: 'search',
      answer: `Fant ${sources.length} resultater for "${safeSearchQuery}"`,
      sources,
    } as SearchResponse)
  }

  // No results found
  return NextResponse.json({
    mode: 'search',
    answer: `Fant ingen resultater for "${safeSearchQuery}". Prøv å søke med andre ord.`,
    sources: [],
  } as SearchResponse)
}

// ============================================================================
// SUGGEST MODE HANDLER (Meal Suggestions)
// ============================================================================

interface HouseholdData {
  id: string
  name: string | null
  ai_meal_context?: string | null
  share_names_with_ai?: boolean
}

async function handleSuggestMode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: string,
  household: HouseholdData
): Promise<Response> {
  // Get current week dates
  const today = new Date()
  const dayOfWeek = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  const weekStart = formatDateISO(monday)

  const weekEnd = new Date(monday)
  weekEnd.setDate(monday.getDate() + 6)
  const weekEndStr = formatDateISO(weekEnd)

  // Get recent meals to avoid repetition
  const twoWeeksAgo = new Date(monday)
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

  const [childrenResult, membersResult, recipesResult, recentMealsResult, existingMealsResult] = await Promise.all([
    supabase.from('children').select('name, birth_date, allergies').eq('household_id', household.id),
    supabase.from('household_members').select('name, birth_date, allergies, is_parent').eq('household_id', household.id).eq('is_parent', true),
    supabase.from('recipes').select('id, name, is_favorite, is_quick, is_kid_friendly').eq('household_id', household.id),
    supabase.from('meals').select('date, custom_meal, recipe:recipes(name)').eq('household_id', household.id).gte('date', formatDateISO(twoWeeksAgo)).lt('date', weekStart).order('date', { ascending: false }),
    supabase.from('meals').select('date, custom_meal, recipe:recipes(name)').eq('household_id', household.id).gte('date', weekStart).lte('date', weekEndStr),
  ])

  // Collect and sanitize allergies (to prevent prompt injection)
  const allAllergiesRaw: string[] = []
  if (childrenResult.data) {
    childrenResult.data.forEach(c => {
      ((c.allergies as string[]) || []).forEach(a => allAllergiesRaw.push(a.toLowerCase()))
    })
  }
  if (membersResult.data) {
    membersResult.data.forEach(m => {
      ((m.allergies as string[]) || []).forEach(a => allAllergiesRaw.push(a.toLowerCase()))
    })
  }
  const allAllergies = sanitizePromptArray([...new Set(allAllergiesRaw)])

  // Determine which days need suggestions (weekdays without meals)
  const existingMealsMap = new Map<string, string>()
  if (existingMealsResult.data) {
    existingMealsResult.data.forEach(m => {
      const mealName = (m.recipe as unknown as { name: string } | null)?.name || m.custom_meal || ''
      if (mealName) {
        existingMealsMap.set(m.date, mealName)
      }
    })
  }

  const daysNeedingSuggestions: { date: string; dayName: string }[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    const dateStr = formatDateISO(date)
    const dayOfWeek = date.getDay()

    // Skip weekends (Saturday = 6, Sunday = 0)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue

    // Skip days that already have meals
    if (existingMealsMap.has(dateStr)) continue

    const dayNames = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
    daysNeedingSuggestions.push({ date: dateStr, dayName: dayNames[dayOfWeek] })
  }

  // If all days have meals, suggest for next week or just acknowledge
  if (daysNeedingSuggestions.length === 0) {
    return NextResponse.json({
      mode: 'suggest',
      suggestions: [],
    } as SuggestResponse)
  }

  // Build context for AI
  const recentMealNames = (recentMealsResult.data || [])
    .map(m => (m.recipe as unknown as { name: string } | null)?.name || m.custom_meal)
    .filter(Boolean) as string[]

  const favoriteRecipes = (recipesResult.data || []).filter(r => r.is_favorite).map(r => r.name)

  // Get model from settings with env fallback
  const model = await getModel(supabase, 'text')
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    return ApiErrors.configError({ internalMessage: 'OPENROUTER_API_KEY not configured for suggest mode' })
  }

  // Sanitize user inputs
  const safeContext = household.ai_meal_context ? sanitizePromptInput(household.ai_meal_context, 500) : ''
  const userRequest = input.replace(MEAL_SUGGEST_KEYWORDS, '').trim()
  const safeUserRequest = userRequest ? sanitizePromptInput(userRequest, 200) : ''

  // Build the prompt
  const prompt = `Foreslå middager for følgende dager:
${daysNeedingSuggestions.map(d => `- ${d.dayName} (${d.date})`).join('\n')}

${allAllergies.length > 0 ? `**VIKTIG - Allergier (UNNGÅ disse):** ${allAllergies.join(', ')}` : ''}

${favoriteRecipes.length > 0 ? `**Familiens favoritter:** ${favoriteRecipes.slice(0, 5).join(', ')}` : ''}

${recentMealNames.length > 0 ? `**Nylige middager (unngå gjentakelse):** ${recentMealNames.slice(0, 7).join(', ')}` : ''}

${safeContext ? `**Familiens preferanser:** ${safeContext}` : ''}

${safeUserRequest ? `**Brukerens ønske:** ${safeUserRequest}` : ''}

Regler:
- Enkle retter med få ingredienser
- Barnevennlige og næringsrike
- Varier mellom kylling, fisk, kjøtt, vegetar
- Returner JSON: { "suggestions": [{ "day": "YYYY-MM-DD", "name": "...", "description": "kort beskrivelse", "ingredients": [{"item": "...", "amount": "..."}], "is_quick": true/false, "is_kid_friendly": true/false }] }`

  // Set timeout for meal suggestions (15 seconds)
  const suggestController = new AbortController()
  const suggestTimeoutId = setTimeout(() => suggestController.abort(), 15000)

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        'X-Title': 'Familjen',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Du er en hjelpsom assistent for norsk familieplanlegging. Du foreslår enkle, barnevennlige middager.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 1500,
        response_format: MEAL_SUGGESTION_SCHEMA,
      }),
      signal: suggestController.signal,
    })

    clearTimeout(suggestTimeoutId)

    if (!response.ok) {
      console.error('Suggest AI error:', response.status)
      return ApiErrors.internal({ internalMessage: `Suggest AI error: ${response.status}` })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return ApiErrors.internal({ internalMessage: 'Empty AI response in suggest mode' })
    }

    const parsed = extractJSON<{ suggestions?: MealSuggestion[] }>(content)
    if (!parsed) {
      console.error('Failed to parse suggest response')
      return ApiErrors.internal({ internalMessage: 'Failed to parse suggest response' })
    }

    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []

    // Build family context for AI validation
    const childrenAges = (childrenResult.data || [])
      .filter(c => c.birth_date)
      .map(c => {
        const birth = new Date(c.birth_date!)
        const today = new Date()
        let age = today.getFullYear() - birth.getFullYear()
        const monthDiff = today.getMonth() - birth.getMonth()
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--
        return { name: c.name, age }
      })

    const parentCount = (membersResult.data || []).length

    const familyContext: FamilyContext = {
      allergies: allAllergies,
      childrenAges,
      parentCount,
      shareNamesWithAi: household.share_names_with_ai ?? true,
    }

    // Validate suggestions using AI (same as main suggest endpoint)
    const validation = await validateMealSuggestions(suggestions, familyContext, model)

    // Log any issues
    if (validation.issues.length > 0) {
      console.log('[Parse-Action Suggest] Validation issues:', validation.issues.map(i => `${i.mealName}: ${i.reason}`).join(', '))
    }

    return NextResponse.json({
      mode: 'suggest',
      suggestions: validation.validMeals,
    } as SuggestResponse)
  } catch (error) {
    clearTimeout(suggestTimeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      return ApiErrors.timeout({ internalMessage: 'Suggest request timed out' })
    }
    return handleApiError(error, 'suggest mode')
  }
}
