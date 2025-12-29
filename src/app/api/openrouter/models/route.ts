import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'

export interface OpenRouterModel {
  id: string
  name: string
  pricing: {
    prompt: string
    completion: string
  }
  context_length: number
  top_provider?: {
    max_completion_tokens: number
  }
  supportsVision?: boolean
}

interface OpenRouterAPIModel {
  id: string
  name: string
  pricing: { prompt: string; completion: string }
  context_length: number
  architecture?: {
    modality?: string
    input_modalities?: string[]
    output_modalities?: string[]
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const visionOnly = searchParams.get('vision') === 'true'
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 })
    }

    // Rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'aiModels')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.aiModels)
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `For mange forespørsler. Prøv igjen om ${rateLimit.retryAfter} sekunder.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenRouter API-nøkkel ikke konfigurert' }, { status: 500 })
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
    })

    if (!response.ok) {
      throw new Error('Failed to fetch models')
    }

    const data = await response.json()

    // Filter and sort models - prioritize popular ones
    const models: OpenRouterModel[] = data.data
      .filter((m: OpenRouterAPIModel) => {
        // Filter out deprecated or test models
        if (m.id.includes('test') || m.id.includes('deprecated')) return false
        // If vision only requested, filter to models with image input
        if (visionOnly) {
          return m.architecture?.input_modalities?.includes('image') ?? false
        }
        return true
      })
      .map((m: OpenRouterAPIModel) => ({
        id: m.id,
        name: m.name,
        pricing: m.pricing,
        context_length: m.context_length,
        supportsVision: m.architecture?.input_modalities?.includes('image') ?? false,
      }))
      .sort((a: OpenRouterModel, b: OpenRouterModel) => {
        // Sort by provider (anthropic, openai first) then by name
        const providerOrder = ['anthropic', 'openai', 'google', 'meta', 'mistral']
        const aProvider = a.id.split('/')[0]
        const bProvider = b.id.split('/')[0]
        const aIndex = providerOrder.indexOf(aProvider)
        const bIndex = providerOrder.indexOf(bProvider)

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex || a.name.localeCompare(b.name)
        }
        if (aIndex !== -1) return -1
        if (bIndex !== -1) return 1
        return a.name.localeCompare(b.name)
      })

    return NextResponse.json({ models })
  } catch (error) {
    console.error('Error fetching OpenRouter models:', error)
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    )
  }
}
