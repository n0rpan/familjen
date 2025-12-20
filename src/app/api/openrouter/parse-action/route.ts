import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserHousehold } from '@/lib/supabase/household'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { extractJSON } from '@/lib/json-extract'
import { z } from 'zod'

// Request schema
const parseActionSchema = z.object({
  input: z.string().min(1).max(500),
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
})

// Response types
export type ActionType = 'meal' | 'child_task' | 'member_event' | 'pickup' | 'shopping_item'

export interface ParsedAction {
  type: ActionType
  operation: 'add' | 'modify'
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

export interface ParseActionResponse {
  actions: ParsedAction[]
  error?: string
}

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
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.aiParseReminders)
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
    const { input, context } = validation.data

    // Fetch model from app_settings
    const { data: modelSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'openrouter_model')
      .single()

    const model = modelSetting?.value || 'google/gemini-2.5-flash-lite'

    // Get household for current user context
    const { data: household } = await getUserHousehold(supabase)
    const currentMember = context.members.find(m => m.isCurrentUser)

    // Build the prompt
    const systemPrompt = buildSystemPrompt(context)
    const userPrompt = buildUserPrompt(input, context, currentMember?.name)

    // Call OpenRouter API
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenRouter API-nøkkel ikke konfigurert' }, { status: 500 })
    }

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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
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
      operation: (a.operation || 'add') as 'add' | 'modify',
      data: a.data || {},
      display: {
        title: a.display?.title || '',
        subtitle: a.display?.subtitle || '',
        icon: a.display?.icon || '📝',
      },
      confidence: typeof a.confidence === 'number' ? a.confidence : 0.5,
      needsClarification: a.needs_clarification || undefined,
    }))

    return NextResponse.json({ actions } as ParseActionResponse)
  } catch (error) {
    console.error('Parse action error:', error)
    return NextResponse.json({ error: 'En feil oppstod' }, { status: 500 })
  }
}

function buildSystemPrompt(context: z.infer<typeof parseActionSchema>['context']): string {
  return `Du er en assistent for en norsk familieplanleggingsapp. Din oppgave er å tolke brukerens naturlige språk og returnere strukturerte handlinger.

HANDLINGSTYPER:

1. "meal" - Middag/måltid (til middagsplan)
   - Brukes når: "taco fredag", "pizza i morgen", "laks på lørdag" (NB: bare når det skal på MIDDAGSPLANEN)
   - Data: { date, meal_name }

2. "shopping_item" - Handlelistevare
   - Brukes når: "kjøp melk", "legg til brød på handlelista", "vi trenger såpe"
   - VIKTIG: Hvis brukeren sier "handleliste/handlelista/handle", bruk ALLTID denne typen
   - Matvarer som skal KJØPES (ikke planlegges som middag) = shopping_item
   - list_type: "produce" (dagligvarer/mat) eller "other" (andre butikker/spesialvarer)
   - Data: { item_name, quantity?, list_type }

   VELG list_type:
   - "produce": matvarer, dagligvarer, husholdning (melk, brød, såpe, toalettpapir)
   - "other": spesialbutikker, byggevarer, apotek, elektronikk (skruer, medisin, kabler)
   - Hvis usikker, sett needs_clarification med valg mellom listene

3. "child_task" - Oppgave for barn
   - Brukes når: "Storm tannlege tirsdag", "Ylva må ha med gymtøy", "barnehagen stengt fredag"
   - task_type: "bring" (ta med noe), "appointment" (tannlege, lege, møte), "reminder" (påminnelse, stengt, aktivitet), "other" (annet)
   - Data: { date, time?, title, task_type, child_id?, child_name? }

4. "member_event" - Hendelse for voksen
   - Brukes når: "jeg er i Bergen onsdag", "pappa på jobbtur", "mamma på kurs"
   - Data: { date, end_date?, title, member_id?, member_name? }

5. "pickup" - Endring av henting
   - Brukes når: "jeg henter Storm i morgen", "pappa henter begge på fredag"
   - operation: "modify" (alltid for pickup - endrer eksisterende)
   - Data: { date, child_id?, child_name?, picker_id?, picker_name? }

VIKTIG FOR SHOPPING vs MEAL:
- "legg laks til handlelista" = shopping_item (skal KJØPES)
- "laks til middag fredag" = meal (skal PLANLEGGES som middag)
- Når brukeren eksplisitt sier "handleliste/handlelista" = ALLTID shopping_item

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
      "type": "meal|shopping_item|child_task|member_event|pickup",
      "operation": "add|modify",
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
- pickup: 🚗

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
