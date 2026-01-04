import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLanguageFromCookieOrBrowser } from '@/lib/i18n/cookie.server'
import type { Language } from '@/lib/i18n/types'
import { ApiErrors, handleApiError } from '@/lib/api-errors'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'

export const maxDuration = 30

const OPENROUTER_TIMEOUT_MS = 25000 // 25 seconds (leave buffer for maxDuration)

// Language-specific prompts for AI image analysis
const PROMPTS: Record<Language, string> = {
  nb: `Analyser dette bildet av et produkt/gaveønske for en ønskeliste.

Ekstraher følgende informasjon på NORSK i JSON-format:
{
  "name": "Produktnavn (vær spesifikk, f.eks. 'LEGO Star Wars Millennium Falcon' ikke bare 'LEGO')",
  "description": "Kort beskrivelse av produktet på norsk (1-2 setninger, inkluder viktige egenskaper som størrelse, farge, materiale)",
  "price": <tall uten valutasymbol, eller null hvis ikke synlig>
}

Pris-formater å se etter: "kr 500", "500,-", "500 kr", "NOK 500", "499,00", "fra 299".
Returner KUN tallet uten "kr", "NOK" eller ",-".

Hvis du ikke kan finne et felt, bruk null.
Svar KUN med gyldig JSON, ingen tilleggstekst.`,

  sv: `Analysera denna bild av en produkt/gåvoönskning för en önskelista.

Extrahera följande information på SVENSKA i JSON-format:
{
  "name": "Produktnamn (var specifik, t.ex. 'LEGO Star Wars Millennium Falcon' inte bara 'LEGO')",
  "description": "Kort beskrivning av produkten på svenska (1-2 meningar, inkludera viktiga egenskaper som storlek, färg, material)",
  "price": <tal utan valutasymbol, eller null om inte synlig>
}

Prisformat att leta efter: "kr 500", "500:-", "500 kr", "SEK 500", "499,00", "från 299".
Returnera ENDAST talet utan "kr", "SEK" eller ":-".

Om du inte kan hitta ett fält, använd null.
Svara ENDAST med giltig JSON, ingen ytterligare text.`,

  en: `Analyze this image of a product/gift item for a wishlist.

Extract the following information in ENGLISH in JSON format:
{
  "name": "Product name (be specific, e.g., 'LEGO Star Wars Millennium Falcon' not just 'LEGO')",
  "description": "Brief description of the product in English (1-2 sentences, include key features like size, color, material)",
  "price": <number without currency symbol, or null if not visible>
}

Price formats to look for: "kr 500", "500,-", "500 kr", "NOK 500", "SEK 500", "$499", "€299", "£199".
Return ONLY the number without currency symbols.

If you cannot determine a field, use null.
Respond ONLY with valid JSON, no additional text.`,
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return ApiErrors.unauthorized()
    }

    // Rate limit check
    const rateLimit = await checkRateLimit(
      createRateLimitKey(user.id, 'aiSuggest'),
      RATE_LIMITS.aiSuggest
    )
    if (rateLimit.limited) {
      return ApiErrors.rateLimit(rateLimit.retryAfter)
    }

    // Get user's household to verify they have access
    const { data: member } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!member) {
      // User is authenticated but hasn't joined/created a household yet
      return ApiErrors.forbidden()
    }

    // Run parallel queries for household API key and vision model setting
    const [householdResult, visionModelResult] = await Promise.all([
      supabase
        .from('households')
        .select('openrouter_api_key_encrypted')
        .eq('id', member.household_id)
        .single(),
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'openrouter_vision_model')
        .single(),
    ])

    let apiKey = process.env.OPENROUTER_API_KEY

    // Try to decrypt household's API key if they have one
    if (householdResult.data?.openrouter_api_key_encrypted) {
      const { data: decryptedKey } = await supabase.rpc('decrypt_token', {
        ciphertext: householdResult.data.openrouter_api_key_encrypted,
      })
      if (decryptedKey) {
        apiKey = decryptedKey
      }
    }

    if (!apiKey) {
      return ApiErrors.internal({ internalMessage: 'No OpenRouter API key configured' })
    }

    const model = visionModelResult.data?.value || 'google/gemini-2.5-flash-lite'

    // Get image from request
    const { image } = await request.json()
    if (!image) {
      return ApiErrors.validation('Bilde er påkrevd')
    }

    // Get user's language preference (fallback to Norwegian)
    const language = await getLanguageFromCookieOrBrowser()
    const prompt = PROMPTS[language] || PROMPTS.nb

    // Call OpenRouter with vision model (with timeout)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS)

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://familjen.eu',
        'X-Title': 'Familjen Wishlist',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: image,
                },
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenRouter error:', errorText)
      return ApiErrors.internal({ internalMessage: `OpenRouter API error: ${response.status}` })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return ApiErrors.internal({ internalMessage: 'No content in AI response' })
    }

    // Parse JSON response
    try {
      // Clean up the response - remove markdown code blocks if present
      let jsonStr = content.trim()
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7)
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3)
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3)
      }

      const result = JSON.parse(jsonStr.trim())

      // Validate and sanitize response
      // AI might return price as string - parse it to number
      let price: number | null = null
      if (result.price != null) {
        const parsed = typeof result.price === 'string'
          ? parseFloat(result.price)
          : result.price
        // Only use if it's a valid finite number
        if (typeof parsed === 'number' && Number.isFinite(parsed)) {
          price = parsed
        }
      }

      return NextResponse.json({
        name: typeof result.name === 'string' ? result.name : null,
        description: typeof result.description === 'string' ? result.description : null,
        price,
      })
    } catch {
      console.error('Failed to parse AI response:', content)
      return ApiErrors.internal({ internalMessage: 'Failed to parse AI JSON response' })
    }
  } catch (error) {
    // Handle timeout specifically
    if (error instanceof Error && error.name === 'AbortError') {
      return ApiErrors.internal({ internalMessage: 'AI request timed out' })
    }
    return handleApiError(error, 'wishlist image analysis')
  }
}
