import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserHousehold } from '@/lib/supabase/household'
import { aiParseRemindersSchema, validateRequest } from '@/lib/schemas'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import type { ParsedReminder } from '@/lib/schemas'
import type { ChildTaskType } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 })
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'aiParseReminders')
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.aiParseReminders)
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `For mange forespørsler. Prøv igjen om ${rateLimit.retryAfter} sekunder.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Validate request body
    const validation = await validateRequest(request, aiParseRemindersSchema)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { input, childIds, defaultDate } = validation.data

    // Fetch model from app_settings
    const { data: modelSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'openrouter_model')
      .single()

    const model = modelSetting?.value || 'anthropic/claude-3.5-sonnet'

    // Fetch household data (using safe multi-row handler)
    const { data: household, error: householdError } = await getUserHousehold(supabase)

    if (householdError || !household) {
      return NextResponse.json({ error: 'Kunne ikke finne husstand' }, { status: 404 })
    }

    // Fetch children for context (for name matching)
    const childrenQuery = supabase
      .from('children')
      .select('id, name')
      .eq('household_id', household.id)

    // Optionally filter to specific children
    if (childIds && childIds.length > 0) {
      childrenQuery.in('id', childIds)
    }

    const { data: children } = await childrenQuery

    // Build the prompt with context
    const today = defaultDate || new Date().toISOString().split('T')[0]
    const childContext = children && children.length > 0
      ? `\n\nBarn i familien:\n${children.map(c => `- ${c.name} (id: ${c.id})`).join('\n')}`
      : ''

    const prompt = buildPrompt(input, today, childContext)

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
          {
            role: 'system',
            content: `Du er en hjelpsom assistent som tolker norske påminnelser for en familieplanleggingsapp.

Din oppgave er å analysere naturlig norsk tekst og trekke ut strukturert informasjon om påminnelser.

TASK TYPES (velg mest passende):
- "bring": Når noe skal tas med (gymtøy, matpakke, skift, utstyr)
- "appointment": Avtaler (lege, tannlege, foreldremøte)
- "activity": Aktiviteter (fotball, svømming, bursdagsfest, kurs)
- "closure": Stengt/fri (barnehagen stengt, planleggingsdag, ferie)
- "reminder": Generelle påminnelser
- "other": Annet som ikke passer kategoriene over

DATOER (i dag er ${today}):
- "i morgen" = dagen etter i dag
- "på mandag/tirsdag/..." = neste forekomst av den ukedagen
- "neste uke" = mandag neste uke
- Relative datoer tolkes fra dagens dato

VIKTIGE REGLER:
1. Hvis et barnenavn nevnes, koble påminnelsen til det barnet
2. Sett confidence høyt (0.8-1.0) for tydelige påminnelser, lavere (0.5-0.7) for uklare
3. Returner ALLTID gyldig JSON
4. Dato må være på formatet YYYY-MM-DD
5. Tid må være på formatet HH:MM (24-timers)

Svar ALLTID i dette JSON-formatet:
{
  "reminders": [
    {
      "title": "Kort tittel på påminnelsen",
      "date": "YYYY-MM-DD eller null",
      "time": "HH:MM eller null",
      "task_type": "bring|appointment|activity|closure|reminder|other",
      "child_name": "Barnenavn eller null",
      "child_id": "UUID fra listen eller null",
      "notes": "Ekstra detaljer eller null",
      "confidence": 0.0-1.0
    }
  ]
}`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower for more deterministic parsing
        max_tokens: 1500,
      }),
    })

    if (!response.ok) {
      console.error('OpenRouter error:', { status: response.status, statusText: response.statusText })
      return NextResponse.json({ error: 'Kunne ikke tolke påminnelse' }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: 'Tomt svar fra AI' }, { status: 500 })
    }

    // Parse the JSON response
    try {
      // Extract JSON from potential markdown code blocks
      let jsonContent = content
      if (content.includes('```json')) {
        jsonContent = content.split('```json')[1].split('```')[0].trim()
      } else if (content.includes('```')) {
        jsonContent = content.split('```')[1].split('```')[0].trim()
      }

      const parsed = JSON.parse(jsonContent)
      const reminders: ParsedReminder[] = (parsed.reminders || []).map((r: {
        title: string
        date: string | null
        time: string | null
        task_type: string
        child_name: string | null
        child_id: string | null
        notes: string | null
        confidence: number
      }) => ({
        title: r.title || '',
        date: r.date || null,
        time: r.time || null,
        task_type: validateTaskType(r.task_type),
        child_name: r.child_name || null,
        child_id: r.child_id || null,
        notes: r.notes || null,
        confidence: typeof r.confidence === 'number' ? Math.min(1, Math.max(0, r.confidence)) : 0.5,
      }))

      return NextResponse.json({ reminders })
    } catch (parseError) {
      console.error('Failed to parse AI response:', { error: parseError instanceof Error ? parseError.message : 'Unknown parse error', contentLength: content?.length })
      return NextResponse.json({ error: 'Kunne ikke tolke AI-svar' }, { status: 500 })
    }
  } catch (error) {
    console.error('Parse reminders error:', error)
    return NextResponse.json({ error: 'En feil oppstod' }, { status: 500 })
  }
}

function buildPrompt(input: string, today: string, childContext: string): string {
  return `Tolk følgende tekst og trekk ut påminnelser:

"${input}"

Dagens dato er: ${today}${childContext}

Trekk ut alle påminnelser du finner. Hvis teksten inneholder flere påminnelser (f.eks. separert med komma eller linjeskift), returner alle.`
}

function validateTaskType(type: string): ChildTaskType {
  const validTypes: ChildTaskType[] = ['bring', 'appointment', 'reminder', 'activity', 'closure', 'other']
  if (validTypes.includes(type as ChildTaskType)) {
    return type as ChildTaskType
  }
  return 'reminder' // Default fallback
}
