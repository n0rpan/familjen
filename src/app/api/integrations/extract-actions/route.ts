import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin, isUserAdmin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { extractJSON } from '@/lib/json-extract'
import { formatDateISO } from '@/lib/utils'

interface ExtractedAction {
  type: 'task' | 'event' | 'reminder'
  title: string
  date: string | null
  time: string | null
  description: string | null
  confidence: number
}

interface ExternalMessage {
  id: string
  integration_id: string
  child_id: string | null
  body: string
  message_date: string
  sender_name: string | null
  external_group_id: string | null
}

/**
 * POST /api/integrations/extract-actions
 *
 * Process unprocessed external messages with AI to extract action items.
 * Creates external_suggestions records for user review.
 */
export async function POST(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }

    const supabase = await createClient()

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'aiSuggest')
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.aiSuggest)
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rateLimit.retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Get user's household
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 400 })
    }

    // Parse request body for optional filters
    const body = await request.json().catch(() => ({}))
    const { integrationId, limit = 20 } = body as {
      integrationId?: string
      limit?: number
    }

    // Get unprocessed messages
    let messagesQuery = supabase
      .from('external_messages')
      .select(
        `
        id,
        integration_id,
        child_id,
        body,
        message_date,
        sender_name,
        external_group_id,
        integration:external_integrations!inner(household_id)
      `
      )
      .eq('is_processed', false)
      .eq('external_integrations.household_id', membership.household_id)
      .order('message_date', { ascending: false })
      .limit(limit)

    if (integrationId) {
      messagesQuery = messagesQuery.eq('integration_id', integrationId)
    }

    const { data: messages, error: messagesError } = await messagesQuery

    if (messagesError) {
      console.error('Error fetching messages:', messagesError)
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        suggestionsCreated: 0,
        message: 'No unprocessed messages found',
      })
    }

    // Get AI model from settings
    const { data: modelSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'openrouter_model')
      .single()

    const model = modelSetting?.value || 'google/gemini-2.5-flash-lite'

    // Get children names for context
    const { data: children } = await supabase
      .from('children')
      .select('id, name')
      .eq('household_id', membership.household_id)

    const childNameMap = new Map(children?.map((c) => [c.id, c.name]) || [])

    // Process messages in batches
    let processedCount = 0
    let suggestionsCreated = 0
    const errors: string[] = []

    for (const message of messages as unknown as Array<ExternalMessage & { integration: { household_id: string } }>) {
      try {
        const childName = message.child_id ? childNameMap.get(message.child_id) : null
        const actions = await extractActionsFromMessage(
          message.body,
          childName || 'barnet',
          model
        )

        // Create suggestions for each extracted action
        for (const action of actions) {
          const { error: insertError } = await supabase.from('external_suggestions').insert({
            household_id: membership.household_id,
            integration_id: message.integration_id,
            source_message_id: message.id,
            suggested_type: action.type,
            suggested_child_id: message.child_id,
            suggested_date: action.date,
            suggested_time: action.time,
            suggested_title: action.title,
            suggested_description: action.description,
            confidence_score: action.confidence,
            status: 'pending',
          })

          if (insertError) {
            console.error('Error inserting suggestion:', insertError)
          } else {
            suggestionsCreated++
          }
        }

        // Mark message as processed
        await supabase
          .from('external_messages')
          .update({ is_processed: true })
          .eq('id', message.id)

        processedCount++
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error)
        errors.push(message.id)
      }
    }

    const isAdmin = isUserAdmin(user)

    return NextResponse.json({
      success: true,
      processed: processedCount,
      suggestionsCreated,
      errors: isAdmin ? errors : errors.length,
    })
  } catch (error) {
    console.error('Extract actions error:', error)
    return NextResponse.json({ error: 'Failed to extract actions' }, { status: 500 })
  }
}

/**
 * Call OpenRouter to extract action items from a message.
 */
async function extractActionsFromMessage(
  messageBody: string,
  childName: string,
  model: string
): Promise<ExtractedAction[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set')
    return []
  }

  const today = formatDateISO(new Date())

  const prompt = `Analyze this message from a children's activity group (sport team, school, kindergarten, etc.) and extract any action items that parents need to remember.

Message:
"${messageBody}"

Child's name: ${childName}
Today's date: ${today}

Extract action items such as:
- Things to bring (equipment, food, clothes)
- Appointments or events to attend
- Deadlines or reminders
- Schedule changes

Return a JSON array of action items. Each item should have:
- "type": "task" (things to bring/do), "event" (things to attend), or "reminder" (general reminders)
- "title": Short, actionable title in Norwegian (max 50 chars)
- "date": Date in YYYY-MM-DD format if mentioned, or null
- "time": Time in HH:MM format if mentioned, or null
- "description": Additional context if needed, or null
- "confidence": 0.0-1.0 how confident you are this is an action item

Only include actual action items, not general information. If no action items found, return an empty array [].

Example output:
[
  {
    "type": "task",
    "title": "Ta med leggskinn",
    "date": "2025-12-20",
    "time": null,
    "description": "Til fotballtrening",
    "confidence": 0.95
  }
]

Return only the JSON array, no other text.`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'https://familjen.eu',
        'X-Title': 'Familjen',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent extraction
        max_tokens: 1000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenRouter API error:', response.status, errorText)
      return []
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return []
    }

    // Extract JSON from response
    const actions = extractJSON<ExtractedAction[]>(content)

    if (!Array.isArray(actions)) {
      return []
    }

    // Validate and normalize actions
    return actions
      .filter(
        (action) =>
          action &&
          typeof action.type === 'string' &&
          ['task', 'event', 'reminder'].includes(action.type) &&
          typeof action.title === 'string' &&
          action.title.length > 0
      )
      .map((action) => ({
        type: action.type,
        title: action.title.slice(0, 100), // Truncate long titles
        date: isValidDate(action.date) ? action.date : null,
        time: isValidTime(action.time) ? action.time : null,
        description: action.description || null,
        confidence: typeof action.confidence === 'number' ? Math.min(1, Math.max(0, action.confidence)) : 0.5,
      }))
  } catch (error) {
    console.error('Error calling OpenRouter:', error)
    return []
  }
}

/**
 * Validate date string format (YYYY-MM-DD).
 */
function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string') return false
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
}

/**
 * Validate time string format (HH:MM or HH:MM:SS).
 */
function isValidTime(time: unknown): time is string {
  if (typeof time !== 'string') return false
  return /^\d{2}:\d{2}(:\d{2})?$/.test(time)
}

/**
 * GET /api/integrations/extract-actions
 *
 * Get count of unprocessed messages and pending suggestions.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get pending suggestions count
    const { data: pendingCount } = await supabase.rpc('get_pending_suggestions_count')

    // Get unprocessed messages count (via RPC to handle RLS)
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    let unprocessedCount = 0
    if (membership) {
      const { count } = await supabase
        .from('external_messages')
        .select('id', { count: 'exact', head: true })
        .eq('is_processed', false)

      unprocessedCount = count || 0
    }

    return NextResponse.json({
      unprocessedMessages: unprocessedCount,
      pendingSuggestions: pendingCount || 0,
    })
  } catch (error) {
    console.error('Error getting extraction status:', error)
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 })
  }
}
