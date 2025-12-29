import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30

interface AnalysisResult {
  name: string | null
  description: string | null
  price: number | null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's household to verify they have access
    const { data: member } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!member) {
      return NextResponse.json({ error: 'No household found' }, { status: 403 })
    }

    // Get API key from household or service role
    const { data: household } = await supabase
      .from('households')
      .select('openrouter_api_key_encrypted')
      .eq('id', member.household_id)
      .single()

    let apiKey = process.env.OPENROUTER_API_KEY

    // Try to decrypt household's API key if they have one
    if (household?.openrouter_api_key_encrypted) {
      const { data: decryptedKey } = await supabase.rpc('decrypt_token', {
        ciphertext: household.openrouter_api_key_encrypted,
      })
      if (decryptedKey) {
        apiKey = decryptedKey
      }
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'No API key configured' }, { status: 500 })
    }

    // Get vision model from app settings
    const { data: visionModelSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'openrouter_vision_model')
      .single()

    const model = visionModelSetting?.value || 'google/gemini-2.5-flash-lite'

    // Get image from request
    const { image } = await request.json()
    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    // Call OpenRouter with vision model
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
                text: `Analyze this image of a product/gift item for a wishlist.

Extract the following information in JSON format:
{
  "name": "Product name (be specific, e.g., 'LEGO Star Wars Millennium Falcon' not just 'LEGO')",
  "description": "Brief description of the product (1-2 sentences, include key features like size, color, material)",
  "price": <number or null if not visible>
}

If you cannot determine a field, use null.
Respond ONLY with valid JSON, no additional text.`,
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

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenRouter error:', errorText)
      return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
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

      const result: AnalysisResult = JSON.parse(jsonStr.trim())

      return NextResponse.json({
        name: result.name || null,
        description: result.description || null,
        price: result.price || null,
      })
    } catch {
      console.error('Failed to parse AI response:', content)
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }
  } catch (error) {
    console.error('Analyze wishlist image error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
