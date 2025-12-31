import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { z } from 'zod'

/**
 * Semantic Shopping Duplicate Check
 *
 * Uses LLM to detect if a new shopping item is semantically the same as existing items.
 * Much smarter than trigram similarity - understands that:
 * - "helmjølk" and "melk" are related (but user might want both)
 * - "egg" and "6 egg" are the same product
 * - "brød" and "grovbrød" might be different (user might want specific type)
 * - "tomat" and "tomater" are the same
 */

const requestSchema = z.object({
  newItem: z.string().min(1).max(200),
  existingItems: z.array(z.object({
    id: z.string(),
    name: z.string(),
    quantity: z.string().nullable().optional(),
  })).max(100),
})

export interface DuplicateMatch {
  id: string
  name: string
  quantity: string | null
  matchType: 'exact' | 'semantic' | 'variant'
  reason: string
}

export interface CheckDuplicateResponse {
  matches: DuplicateMatch[]
  suggestion: string | null
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

    // Parse request body
    const body = await request.json()
    const validation = requestSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 })
    }

    const { newItem, existingItems } = validation.data

    // If no existing items, nothing to check
    if (existingItems.length === 0) {
      return NextResponse.json({ matches: [], suggestion: null } as CheckDuplicateResponse)
    }

    // Get model from settings
    const { data: modelSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'openrouter_model')
      .single()

    const model = modelSetting?.value || 'google/gemini-2.5-flash-lite'

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ matches: [], suggestion: null } as CheckDuplicateResponse)
    }

    // Build the prompt
    const existingList = existingItems
      .map((item, i) => `${i + 1}. "${item.name}"${item.quantity ? ` (${item.quantity})` : ''}`)
      .join('\n')

    const systemPrompt = `Du er en smart handlelisteassistent for norske familier.

Din oppgave er å sjekke om et nytt element som legges til handlelisten ALLEREDE finnes på listen.

Regler:
1. "melk" og "Melk" = SAMME (stor/liten bokstav)
2. "egg" og "6 egg" = SAMME (mengde + produkt)
3. "tomat" og "tomater" = SAMME (entall/flertall)
4. "helmjølk" og "melk" = VARIANT (spesifikk type vs generell - brukeren kan ønske begge)
5. "brød" og "grovbrød" = VARIANT (generell vs spesifikk)
6. "ost" og "brunost" = FORSKJELLIG (helt forskjellige produkter)
7. "epler" og "bananer" = FORSKJELLIG

Svar i JSON-format:
{
  "matches": [
    {
      "index": 1,
      "matchType": "exact" | "semantic" | "variant",
      "reason": "Kort norsk forklaring"
    }
  ],
  "suggestion": "Forslag til brukeren (f.eks. 'Kanskje du vil øke mengden på eksisterende vare?') eller null"
}`

    const userPrompt = `Handlelisten inneholder:
${existingList}

Nytt element som skal legges til: "${newItem}"

Er dette allerede på listen? Svar i JSON.`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        'X-Title': 'Familjen Shopping',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      console.error('OpenRouter check duplicate error:', { status: response.status })
      return NextResponse.json({ matches: [], suggestion: null } as CheckDuplicateResponse)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ matches: [], suggestion: null } as CheckDuplicateResponse)
    }

    // Parse the response
    let parsed: { matches?: Array<{ index: number; matchType: string; reason: string }>; suggestion?: string | null }
    try {
      parsed = JSON.parse(content)
    } catch {
      console.error('Failed to parse LLM response:', content)
      return NextResponse.json({ matches: [], suggestion: null } as CheckDuplicateResponse)
    }

    // Map indices back to actual items
    const matches: DuplicateMatch[] = (parsed.matches || [])
      .filter(m => m.index >= 1 && m.index <= existingItems.length)
      .map(m => {
        const item = existingItems[m.index - 1]
        return {
          id: item.id,
          name: item.name,
          quantity: item.quantity || null,
          matchType: (m.matchType as 'exact' | 'semantic' | 'variant') || 'semantic',
          reason: m.reason || '',
        }
      })

    return NextResponse.json({
      matches,
      suggestion: parsed.suggestion || null,
    } as CheckDuplicateResponse)

  } catch (error) {
    console.error('Check shopping duplicate error:', error)
    return NextResponse.json({ matches: [], suggestion: null } as CheckDuplicateResponse)
  }
}
