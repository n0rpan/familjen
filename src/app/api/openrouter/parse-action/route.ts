import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserHousehold } from '@/lib/supabase/household'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { extractJSON } from '@/lib/json-extract'
import { formatDateISO } from '@/lib/utils'
import { z } from 'zod'
import type { MealSuggestion } from '@/lib/types'

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
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }

    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 })
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

    // Parse request body
    const body = await request.json()
    const validation = parseActionSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 })
    }
    const { input, image, context } = validation.data
    const hasImage = Boolean(image)

    // Detect request mode
    const mode = detectMode(input, hasImage)

    // Get household for all modes
    const { data: household, error: householdError } = await getUserHousehold(supabase)
    if (householdError || !household) {
      return NextResponse.json({ error: 'Kunne ikke finne husstand' }, { status: 404 })
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
    // Fetch model from app_settings (text or vision based on input)
    const modelKey = hasImage ? 'openrouter_vision_model' : 'openrouter_model'
    const { data: modelSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', modelKey)
      .single()

    const defaultModel = hasImage ? 'google/gemini-2.0-flash-001' : 'google/gemini-2.5-flash-lite'
    const model = modelSetting?.value || defaultModel

    const currentMember = context.members.find(m => m.isCurrentUser)

    // Build the prompt
    const systemPrompt = buildSystemPrompt(context)
    const userPrompt = hasImage
      ? buildVisionUserPrompt(input, image!, context, currentMember?.name)
      : buildUserPrompt(input, context, currentMember?.name)

    // Call OpenRouter API
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenRouter API-nøkkel ikke konfigurert' }, { status: 500 })
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
        messages,
        temperature: 0.2,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      console.error('OpenRouter error:', { status: response.status })
      return NextResponse.json({ error: 'Kunne ikke tolke tekst' }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: 'Tomt svar fra AI' }, { status: 500 })
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
      console.error('Failed to extract JSON from AI response:', { contentLength: content?.length })
      return NextResponse.json({ error: 'Kunne ikke tolke AI-svar' }, { status: 500 })
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
    console.error('Parse action error:', error)
    return NextResponse.json({ error: 'En feil oppstod' }, { status: 500 })
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

1. I dag er ${context.today}
2. "i morgen" = dagen etter i dag
3. "på mandag/tirsdag/..." = neste forekomst av den ukedagen
4. Hvis "jeg" brukes, referer til nåværende bruker
5. Hvis barn/person ikke kan identifiseres sikkert, sett needs_clarification

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
- confidence bør være høy (0.8+) kun når du er sikker`
}

function buildUserPrompt(
  input: string,
  context: z.infer<typeof parseActionSchema>['context'],
  currentUserName?: string
): string {
  return `Tolk følgende og returner handlinger:

"${input}"

Kontekst:
- I dag: ${context.today}
- Nåværende bruker: ${currentUserName || 'ukjent'}
- Barn: ${context.children.map(c => c.name).join(', ') || 'ingen'}
- Voksne: ${context.members.map(m => m.name).join(', ') || 'ingen'}`
}

function buildVisionUserPrompt(
  input: string,
  _image: string,
  context: z.infer<typeof parseActionSchema>['context'],
  currentUserName?: string
): string {
  const baseContext = `
Kontekst:
- I dag: ${context.today}
- Nåværende bruker: ${currentUserName || 'ukjent'}
- Barn: ${context.children.map(c => c.name).join(', ') || 'ingen'}
- Voksne: ${context.members.map(m => m.name).join(', ') || 'ingen'}`

  const childrenOptions = context.children.map(c => `{ "label": "${c.name}", "value": "${c.id}" }`).join(', ')
  const allPersonOptions = [...context.children.map(c => `{ "label": "${c.name}", "value": "${c.id}" }`), ...context.members.map(m => `{ "label": "${m.name}", "value": "${m.id}" }`)].join(', ')

  // If user provided additional text context, include it as a strong directive
  const userNote = input.trim()
    ? `\n\nBRUKERENS INSTRUKSJON (VIKTIG - følg denne!): "${input}"
Brukeren har gitt denne instruksjonen for hvordan bildet skal tolkes. Prioriter brukerens instruksjon over automatisk tolkning.`
    : ''

  return `Analyser dette bildet og bestem hva det viser.
${userNote}

${baseContext}

MULIGE BILDETYPER (analyser og bestem automatisk):

1. INVITASJON / HENDELSE
   - Finn: Dato, klokkeslett, sted, hva slags hendelse
   - Barn-hendelser: child_task med task_type="appointment"
   - Voksen-hendelser: member_event
   - VIKTIG: Sett needs_clarification for child_id/member_id

2. OPPGAVE / PÅMINNELSE
   - Finn: Oppgave, dato, hvem det gjelder
   - Returner: child_task med passende task_type (bring, reminder, closure, etc.)

3. PRODUKT / GAVE (for ønskeliste)
   - Finn: Produktnavn, beskrivelse, ca. pris
   - Returner: wishlist_item med operation="add"
   - VIKTIG: wishlist_item MÅ ALLTID ha needs_clarification for person_id

4. HANDLELISTE / KVITTERING
   - Finn: Varer/produkter
   - Handleliste: shopping_item med operation="add"
   - Kvittering: shopping_item med operation="complete"

5. MIDDAGSPLAN / MAT
   - Finn: Rett, dato
   - Returner: meal

6. ANNET
   - Prøv å tolk innholdet og returner passende handling

VIKTIG:
- Barn til valg (for needs_clarification): [${childrenOptions}]
- Alle personer (for wishlist): [${allPersonOptions}]
- Returner BARE gyldig JSON med actions-array
- Sett høy confidence (0.8+) kun hvis du er sikker på tolkningen
- Hvis usikker, returner lav confidence (< 0.5)`
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

  // Extract keywords for database search
  const keywords = searchQuery.toLowerCase().split(/\s+/).filter(k => k.length > 2)

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

    // External messages (from integrations)
    supabase
      .from('external_messages')
      .select('id, title, body, message_date, integration:external_integrations(service)')
      .eq('household_id', householdId)
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
    const { data: modelSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'openrouter_model')
      .single()

    const model = modelSetting?.value || 'google/gemini-2.5-flash-lite'
    const apiKey = process.env.OPENROUTER_API_KEY

    if (!apiKey) {
      return NextResponse.json({
        mode: 'search',
        answer: `Fant ${sources.length} resultater for "${searchQuery}"`,
        sources,
      } as SearchResponse)
    }

    // Call AI to summarize
    const summaryPrompt = `Brukeren søker etter: "${searchQuery}"

Følgende data ble funnet:
${sources.map(s => `- ${s.type}: ${s.title} (${s.excerpt})`).join('\n')}

Gi et kort, hjelpsomt svar på norsk basert på resultatene. Hvis noe spesifikt ble spurt om (som en dato eller en person), svar direkte på det. Hold svaret under 100 ord.`

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
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const answer = data.choices?.[0]?.message?.content || `Fant ${sources.length} resultater`

        return NextResponse.json({
          mode: 'search',
          answer,
          sources,
        } as SearchResponse)
      }
    } catch (error) {
      console.error('Search AI summary error:', error)
    }

    // Fallback without AI summary
    return NextResponse.json({
      mode: 'search',
      answer: `Fant ${sources.length} resultater for "${searchQuery}"`,
      sources,
    } as SearchResponse)
  }

  // No results found
  return NextResponse.json({
    mode: 'search',
    answer: `Fant ingen resultater for "${searchQuery}". Prøv å søke med andre ord.`,
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

  // Collect allergies
  const allAllergies = new Set<string>()
  if (childrenResult.data) {
    childrenResult.data.forEach(c => {
      ((c.allergies as string[]) || []).forEach(a => allAllergies.add(a.toLowerCase()))
    })
  }
  if (membersResult.data) {
    membersResult.data.forEach(m => {
      ((m.allergies as string[]) || []).forEach(a => allAllergies.add(a.toLowerCase()))
    })
  }

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

  // Get model from settings
  const { data: modelSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'openrouter_model')
    .single()

  const model = modelSetting?.value || 'google/gemini-2.5-flash-lite'
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    return NextResponse.json({ error: 'OpenRouter API-nøkkel ikke konfigurert' }, { status: 500 })
  }

  // Build the prompt
  const prompt = `Foreslå middager for følgende dager:
${daysNeedingSuggestions.map(d => `- ${d.dayName} (${d.date})`).join('\n')}

${Array.from(allAllergies).length > 0 ? `**VIKTIG - Allergier (UNNGÅ disse):** ${Array.from(allAllergies).join(', ')}` : ''}

${favoriteRecipes.length > 0 ? `**Familiens favoritter:** ${favoriteRecipes.slice(0, 5).join(', ')}` : ''}

${recentMealNames.length > 0 ? `**Nylige middager (unngå gjentakelse):** ${recentMealNames.slice(0, 7).join(', ')}` : ''}

${household.ai_meal_context ? `**Familiens preferanser:** ${household.ai_meal_context}` : ''}

${input.replace(MEAL_SUGGEST_KEYWORDS, '').trim() ? `**Brukerens ønske:** ${input.replace(MEAL_SUGGEST_KEYWORDS, '').trim()}` : ''}

Regler:
- Enkle retter med få ingredienser
- Barnevennlige og næringsrike
- Varier mellom kylling, fisk, kjøtt, vegetar
- Returner JSON: { "suggestions": [{ "day": "YYYY-MM-DD", "name": "...", "description": "...", "ingredients": [{"item": "...", "amount": "..."}] }] }`

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
          { role: 'system', content: 'Du er en hjelpsom assistent for norsk familieplanlegging. Du foreslår enkle, barnevennlige middager. Svar ALLTID med gyldig JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 1500,
      }),
    })

    if (!response.ok) {
      console.error('Suggest AI error:', response.status)
      return NextResponse.json({ error: 'Kunne ikke få middagsforslag' }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: 'Tomt svar fra AI' }, { status: 500 })
    }

    const parsed = extractJSON<{ suggestions?: MealSuggestion[] }>(content)
    if (!parsed) {
      console.error('Failed to parse suggest response')
      return NextResponse.json({ error: 'Kunne ikke tolke middagsforslag' }, { status: 500 })
    }

    let suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []

    // Filter out allergens
    if (allAllergies.size > 0) {
      suggestions = suggestions.filter(meal => {
        const mealText = [
          meal.name.toLowerCase(),
          meal.description?.toLowerCase() || '',
          ...meal.ingredients.map(i => i.item.toLowerCase()),
        ].join(' ')

        for (const allergy of Array.from(allAllergies)) {
          if (mealText.includes(allergy)) {
            // Check for false positives
            const falsePositives = [
              { pattern: /kokos\s*melk/i, allergy: 'melk' },
              { pattern: /melkefri/i, allergy: 'melk' },
              { pattern: /nøttefri/i, allergy: 'nøtt' },
            ]

            let isFalsePositive = false
            for (const fp of falsePositives) {
              if (fp.allergy === allergy && fp.pattern.test(mealText)) {
                isFalsePositive = true
                break
              }
            }

            if (!isFalsePositive) {
              console.warn(`[Allergen Filter] Removing "${meal.name}" - contains "${allergy}"`)
              return false
            }
          }
        }
        return true
      })
    }

    return NextResponse.json({
      mode: 'suggest',
      suggestions,
    } as SuggestResponse)
  } catch (error) {
    console.error('Suggest error:', error)
    return NextResponse.json({ error: 'En feil oppstod ved middagsforslag' }, { status: 500 })
  }
}
