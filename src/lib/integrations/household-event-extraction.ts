/**
 * AI extraction utilities for processing household calendar events.
 * Analyzes events to determine which family member they relate to.
 */

import { extractJSON } from '@/lib/json-extract'
import { formatDateISO } from '@/lib/utils'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface EventAssignment {
  target_type: 'child' | 'member' | 'household'
  target_id: string | null
  target_name: string | null
  suggested_type: 'task' | 'event' | 'reminder'
  suggested_title: string
  confidence: number
  reasoning: string
}

export interface HouseholdEventExtractionResult {
  processed: number
  suggestionsCreated: number
  errors: string[]
}

interface HouseholdEventForProcessing {
  id: string
  household_id: string
  ics_uid: string | null
  title: string
  description: string | null
  event_date: string
  end_date: string | null
  event_time: string | null
  location: string | null
}

interface FamilyMember {
  id: string
  name: string
  type: 'child' | 'member'
  location_name?: string | null
  location_type?: string | null
}

/**
 * Process unprocessed household events with AI and create suggestions.
 */
export async function processHouseholdEventsWithAI(
  supabase: SupabaseClient,
  householdId: string,
  limit: number = 50
): Promise<HouseholdEventExtractionResult> {
  const result: HouseholdEventExtractionResult = {
    processed: 0,
    suggestionsCreated: 0,
    errors: [],
  }

  // Get unprocessed household events (not yet redistributed)
  const { data: events, error: eventsError } = await supabase
    .from('household_events')
    .select('id, household_id, ics_uid, title, description, event_date, end_date, event_time, location')
    .eq('household_id', householdId)
    .eq('is_redistributed', false)
    .eq('source', 'ics_calendar')
    .gte('event_date', formatDateISO(new Date())) // Only future events
    .order('event_date')
    .limit(limit)

  if (eventsError) {
    console.error('[HouseholdEventExtraction] Error fetching events:', eventsError)
    result.errors.push('Failed to fetch events')
    return result
  }

  if (!events || events.length === 0) {
    console.log('[HouseholdEventExtraction] No unprocessed events found')
    return result
  }

  console.log(`[HouseholdEventExtraction] Processing ${events.length} events`)

  // Get AI model from settings
  const { data: modelSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'openrouter_model')
    .single()

  const model = modelSetting?.value || 'google/gemini-2.5-flash-lite'

  // Get family members for context
  const [childrenResult, membersResult] = await Promise.all([
    supabase.from('children').select('id, name, location_name, location_type').eq('household_id', householdId),
    supabase.from('household_members').select('id, name').eq('household_id', householdId),
  ])

  const familyMembers: FamilyMember[] = [
    ...(childrenResult.data || []).map((c) => ({
      id: c.id,
      name: c.name,
      type: 'child' as const,
      location_name: c.location_name,
      location_type: c.location_type,
    })),
    ...(membersResult.data || []).map((m) => ({
      id: m.id,
      name: m.name,
      type: 'member' as const,
    })),
  ]

  if (familyMembers.length === 0) {
    console.log('[HouseholdEventExtraction] No family members found')
    return result
  }

  // Process events in batches to avoid rate limiting
  for (const event of events as HouseholdEventForProcessing[]) {
    try {
      const assignment = await analyzeEventWithAI(event, familyMembers, model)

      if (assignment && assignment.confidence >= 0.5) {
        // Skip household-level events - they don't need redistribution to individuals
        // (e.g., family vacations, holidays)
        if (assignment.target_type === 'household') {
          console.log(`[HouseholdEventExtraction] Skipping household-level event: ${event.title}`)
          await supabase
            .from('household_events')
            .update({ is_redistributed: true })
            .eq('id', event.id)
          result.processed++
          continue
        }

        // Skip if we couldn't find a target_id (name matching failed)
        if (!assignment.target_id) {
          console.log(`[HouseholdEventExtraction] No target_id found for: ${event.title}`)
          await supabase
            .from('household_events')
            .update({ is_redistributed: true })
            .eq('id', event.id)
          result.processed++
          continue
        }

        // Create suggestion with ics_uid for persistent linking across re-syncs
        const { error: insertError } = await supabase.from('external_suggestions').insert({
          household_id: householdId,
          source_type: 'household_ics',
          source_household_event_id: event.id,
          source_ics_uid: event.ics_uid,
          suggested_type: assignment.suggested_type,
          suggested_child_id: assignment.target_type === 'child' ? assignment.target_id : null,
          target_member_id: assignment.target_type === 'member' ? assignment.target_id : null,
          suggested_date: event.event_date,
          suggested_time: event.event_time,
          suggested_title: assignment.suggested_title,
          suggested_description: assignment.reasoning,
          confidence_score: assignment.confidence,
          status: 'pending',
        })

        if (insertError) {
          console.error('[HouseholdEventExtraction] Error inserting suggestion:', insertError)
          result.errors.push(event.id)
        } else {
          result.suggestionsCreated++

          // Mark event as redistributed (suggestion created)
          await supabase
            .from('household_events')
            .update({ is_redistributed: true })
            .eq('id', event.id)
        }
      } else {
        // Low confidence or no match - mark as processed but no suggestion
        await supabase
          .from('household_events')
          .update({ is_redistributed: true })
          .eq('id', event.id)
      }

      result.processed++
    } catch (error) {
      console.error(`[HouseholdEventExtraction] Error processing event ${event.id}:`, error)
      result.errors.push(event.id)
    }
  }

  console.log(`[HouseholdEventExtraction] Completed: ${result.processed} processed, ${result.suggestionsCreated} suggestions created`)
  return result
}

/**
 * Use AI to analyze which family member an event relates to.
 */
async function analyzeEventWithAI(
  event: HouseholdEventForProcessing,
  familyMembers: FamilyMember[],
  model: string
): Promise<EventAssignment | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('[HouseholdEventExtraction] OPENROUTER_API_KEY not set')
    return null
  }

  // Build family context
  const familyContext = familyMembers
    .map((m) => {
      if (m.type === 'child') {
        const location = m.location_name ? ` (går på ${m.location_name})` : ''
        return `- ${m.name} (barn)${location}`
      }
      return `- ${m.name} (voksen)`
    })
    .join('\n')

  const prompt = `Analyser denne kalenderhendelsen og avgjør hvem i familien den gjelder.

Hendelse:
- Tittel: ${event.title}
- Dato: ${event.event_date}${event.event_time ? ` kl. ${event.event_time}` : ''}
- Sted: ${event.location || 'Ikke oppgitt'}
- Beskrivelse: ${event.description || 'Ingen'}

Familiemedlemmer:
${familyContext}

Oppgave:
1. Avgjør hvem denne hendelsen mest sannsynlig gjelder basert på:
   - Navnet på skole/barnehage i hendelsen matcher barnets sted
   - Aktivitetstype (barneidrett, foreldremøte, jobb, etc.)
   - Kontekst fra tittel og beskrivelse

2. Hvis hendelsen er for hele familien (ferie, familiebesøk, etc.), svar "household"

3. Hvis du ikke kan avgjøre hvem det gjelder med rimelig sikkerhet, svar null

Returner JSON:
{
  "target_type": "child" | "member" | "household" | null,
  "target_name": "navn på personen" | null,
  "suggested_type": "event" | "task" | "reminder",
  "suggested_title": "kort tittel på norsk",
  "confidence": 0.0-1.0,
  "reasoning": "kort forklaring på norsk"
}

Kun JSON, ingen annen tekst.`

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
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 500,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[HouseholdEventExtraction] OpenRouter error:', response.status, errorText)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return null
    }

    const parsed = extractJSON<{
      target_type: 'child' | 'member' | 'household' | null
      target_name: string | null
      suggested_type: 'event' | 'task' | 'reminder'
      suggested_title: string
      confidence: number
      reasoning: string
    }>(content)

    if (!parsed || parsed.target_type === null) {
      return null
    }

    // Find the target ID by name
    let targetId: string | null = null
    if (parsed.target_type !== 'household' && parsed.target_name) {
      const match = familyMembers.find(
        (m) =>
          m.type === parsed.target_type &&
          m.name.toLowerCase().includes(parsed.target_name!.toLowerCase())
      )
      targetId = match?.id || null
    }

    return {
      target_type: parsed.target_type,
      target_id: targetId,
      target_name: parsed.target_name,
      suggested_type: parsed.suggested_type || 'event',
      suggested_title: parsed.suggested_title || event.title,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reasoning: parsed.reasoning || '',
    }
  } catch (error) {
    console.error('[HouseholdEventExtraction] Error calling AI:', error)
    return null
  }
}
