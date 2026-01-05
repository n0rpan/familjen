/**
 * AI extraction utilities for processing external messages.
 * Extracts action items (tasks, events, reminders) from messages using OpenRouter.
 */

import { extractJSON } from '@/lib/json-extract'
import { formatDateISO } from '@/lib/utils'
import { sanitizeDate, sanitizeTime } from '@/lib/sanitize'
import { getModel } from '@/lib/ai-models'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ExtractedAction {
  type: 'task' | 'event' | 'reminder'
  title: string
  date: string | null
  time: string | null
  description: string | null
  confidence: number
}

export interface ExtractionResult {
  processed: number
  suggestionsCreated: number
  errors: string[]
}

export interface ExternalMessageForExtraction {
  id: string
  integration_id: string
  child_id: string | null
  member_id: string | null
  body: string
  message_date: string
  sender_name: string | null
  external_group_id: string | null
}

/**
 * Process unprocessed messages with AI and create suggestions.
 *
 * @param supabase - Supabase client
 * @param householdId - The household ID
 * @param integrationId - Optional: Only process messages from this integration
 * @param limit - Max messages to process (default: 20)
 * @returns Extraction result with counts
 */
export async function processMessagesWithAI(
  supabase: SupabaseClient,
  householdId: string,
  integrationId?: string,
  limit: number = 20
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    processed: 0,
    suggestionsCreated: 0,
    errors: [],
  }

  // Get unprocessed messages
  let messagesQuery = supabase
    .from('external_messages')
    .select(
      `
      id,
      integration_id,
      child_id,
      member_id,
      body,
      message_date,
      sender_name,
      external_group_id,
      integration:external_integrations!inner(household_id)
    `
    )
    .eq('is_processed', false)
    .eq('external_integrations.household_id', householdId)
    .order('message_date', { ascending: false })
    .limit(limit)

  if (integrationId) {
    messagesQuery = messagesQuery.eq('integration_id', integrationId)
  }

  const { data: messages, error: messagesError } = await messagesQuery

  if (messagesError) {
    console.error('Error fetching messages for AI extraction:', messagesError)
    result.errors.push('Failed to fetch messages')
    return result
  }

  if (!messages || messages.length === 0) {
    return result
  }

  // Get AI model from settings with env fallback
  const model = await getModel(supabase, 'text')

  // Get children and members names for context
  const { data: children } = await supabase
    .from('children')
    .select('id, name')
    .eq('household_id', householdId)

  const { data: members } = await supabase
    .from('household_members')
    .select('id, name')
    .eq('household_id', householdId)

  const childNameMap = new Map(children?.map((c) => [c.id, c.name]) || [])
  const memberNameMap = new Map(members?.map((m) => [m.id, m.name]) || [])

  // Process messages
  for (const message of messages as unknown as Array<ExternalMessageForExtraction & { integration: { household_id: string } }>) {
    try {
      // Determine entity name for context
      let entityName = 'barnet'
      if (message.child_id && childNameMap.has(message.child_id)) {
        entityName = childNameMap.get(message.child_id)!
      } else if (message.member_id && memberNameMap.has(message.member_id)) {
        entityName = memberNameMap.get(message.member_id)!
      }

      const actions = await extractActionsFromMessage(message.body, entityName, model)

      // Create suggestions for each extracted action
      for (const action of actions) {
        const { error: insertError } = await supabase.from('external_suggestions').insert({
          household_id: householdId,
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
          result.suggestionsCreated++
        }
      }

      // Mark message as processed
      await supabase
        .from('external_messages')
        .update({ is_processed: true })
        .eq('id', message.id)

      result.processed++
    } catch (error) {
      console.error(`Error processing message ${message.id}:`, error)
      result.errors.push(message.id)
    }
  }

  return result
}

/**
 * Call OpenRouter to extract action items from a message.
 */
export async function extractActionsFromMessage(
  messageBody: string,
  entityName: string,
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

Person this relates to: ${entityName}
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

    // Validate and normalize actions using sanitize helpers
    // sanitizeDate validates format AND that date is real (catches Feb 30 -> Mar 1)
    // sanitizeTime validates format AND range (0-23 hours, 0-59 minutes)
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
        date: sanitizeDate(action.date),
        time: sanitizeTime(action.time),
        description: action.description || null,
        confidence: typeof action.confidence === 'number' ? Math.min(1, Math.max(0, action.confidence)) : 0.5,
      }))
  } catch (error) {
    console.error('Error calling OpenRouter:', error)
    return []
  }
}
