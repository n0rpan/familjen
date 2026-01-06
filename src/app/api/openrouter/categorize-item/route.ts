import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { z } from 'zod'
import { SHOPPING_CATEGORIES, type ShoppingCategory } from '@/lib/constants'
import { getCommonItemCategory, normalizeItemName } from '@/lib/shopping-common-items'
import { getModel } from '@/lib/ai-models'
import { ApiErrors } from '@/lib/api-errors'

// Request schema
const categorizeItemSchema = z.object({
  itemName: z.string().min(1).max(200),
})

// Response type
export interface CategorizeItemResponse {
  category: ShoppingCategory
  confidence: number
  fromCache?: boolean
}

export async function POST(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return ApiErrors.unauthorized()
    }

    // Parse request body
    const body = await request.json()
    const validation = categorizeItemSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 })
    }
    const { itemName } = validation.data

    // Check common items cache first (shared with client)
    const cachedCategory = getCommonItemCategory(itemName)
    if (cachedCategory) {
      return NextResponse.json({
        category: cachedCategory,
        confidence: 1.0,
        fromCache: true,
      } as CategorizeItemResponse)
    }

    // Check rate limit (use a lightweight limit since this is a simple call)
    const rateLimitKey = createRateLimitKey(user.id, 'aiParseReminders')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.aiParseReminders)
    if (rateLimit.limited) {
      // If rate limited, return 'other' as fallback
      return NextResponse.json({
        category: 'other' as ShoppingCategory,
        confidence: 0.5,
        fromCache: false,
      } as CategorizeItemResponse)
    }

    // Get model from app_settings with env fallback
    const model = await getModel(supabase, 'text')

    // Call OpenRouter API for categorization
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      // Fallback if no API key
      return NextResponse.json({
        category: 'other' as ShoppingCategory,
        confidence: 0.5,
        fromCache: false,
      } as CategorizeItemResponse)
    }

    const systemPrompt = `Du er en kategoriseringsassistent for handlelisteapper.
Kategoriser varen i EN av disse kategoriene:
- produce: frukt, grønnsaker, ferske urter
- dairy: meieri, egg, ost, yoghurt, smør
- meat: kjøtt, fisk, sjømat, kylling
- frozen: frosne varer, is, frosne grønnsaker
- pantry: tørrvarer, brød, pasta, ris, hermetikk, snacks
- beverages: drikke, juice, brus, kaffe, te
- household: husholdning, rengjøring, toalettsaker
- home: hjem, møbler, dekor, verktøy
- electronics: elektronikk, kabler, batterier
- other: alt annet

Svar BARE med kategorinavnet, ingenting annet.`

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
          { role: 'user', content: `Kategoriser: "${itemName}"` },
        ],
        temperature: 0.1,  // Low temperature for consistent results
        max_tokens: 20,    // Short response expected
      }),
    })

    if (!response.ok) {
      console.error('OpenRouter categorize error:', { status: response.status })
      return NextResponse.json({
        category: 'other' as ShoppingCategory,
        confidence: 0.5,
        fromCache: false,
      } as CategorizeItemResponse)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim().toLowerCase()

    // Validate the response is a valid category
    const category = SHOPPING_CATEGORIES.includes(content as ShoppingCategory)
      ? (content as ShoppingCategory)
      : 'other'

    return NextResponse.json({
      category,
      confidence: category === 'other' ? 0.5 : 0.9,
      fromCache: false,
    } as CategorizeItemResponse)

  } catch (error) {
    console.error('Categorize item error:', error)
    return NextResponse.json({
      category: 'other' as ShoppingCategory,
      confidence: 0.5,
      fromCache: false,
    } as CategorizeItemResponse)
  }
}
