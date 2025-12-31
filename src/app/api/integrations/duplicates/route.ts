/**
 * Duplicates API Endpoint
 *
 * GET: Fetch pending suggestions and recently merged duplicates
 * Used by the feed page to show duplicate review UI
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface MergedDuplicate {
  id: string
  title: string
  event_date: string
  event_time: string | null
  duplicate_of_id: string
  duplicate_confidence: number
  source_url_id: string | null
  integration_id: string | null
  child_id: string | null
  updated_at: string
}

/**
 * Query merged duplicates using parameterized .in() filters instead of string interpolation.
 * Makes separate queries for source_url_id and integration_id, then combines results.
 * This is the SAFE approach - avoids SQL injection via .or() string interpolation.
 */
async function queryMergedDuplicates(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
  sourceUrlIds: string[],
  integrationIds: string[],
  thirtyDaysAgo: Date
): Promise<MergedDuplicate[]> {
  const results: MergedDuplicate[] = []
  const seenIds = new Set<string>()

  const baseSelect = 'id, title, event_date, event_time, duplicate_of_id, duplicate_confidence, source_url_id, integration_id, child_id, updated_at'

  // Query by source_url_id using parameterized .in()
  if (sourceUrlIds.length > 0) {
    const { data, error } = await supabase
      .from('external_events')
      .select(baseSelect)
      .not('duplicate_of_id', 'is', null)
      .eq('is_hidden', true)
      .in('source_url_id', sourceUrlIds)
      .gte('updated_at', thirtyDaysAgo.toISOString())
      .order('updated_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[Duplicates API] Error querying by source_url_id:', error)
    } else if (data) {
      for (const item of data) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id)
          results.push(item as MergedDuplicate)
        }
      }
    }
  }

  // Query by integration_id using parameterized .in()
  if (integrationIds.length > 0) {
    const { data, error } = await supabase
      .from('external_events')
      .select(baseSelect)
      .not('duplicate_of_id', 'is', null)
      .eq('is_hidden', true)
      .in('integration_id', integrationIds)
      .gte('updated_at', thirtyDaysAgo.toISOString())
      .order('updated_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[Duplicates API] Error querying by integration_id:', error)
    } else if (data) {
      for (const item of data) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id)
          results.push(item as MergedDuplicate)
        }
      }
    }
  }

  // Sort by updated_at descending and limit to 20
  results.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return results.slice(0, 20)
}

export async function GET() {
  const supabase = await createClient()

  // Verify authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get user's household
  const { data: member } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Household not found' }, { status: 404 })
  }

  const householdId = member.household_id

  // Get all source IDs for this household
  const [sourceUrlsResult, integrationsResult] = await Promise.all([
    supabase.from('external_source_urls').select('id, display_name').eq('household_id', householdId),
    supabase.from('external_integrations').select('id, display_name').eq('household_id', householdId),
  ])

  const sourceMap = new Map<string, string>()
  sourceUrlsResult.data?.forEach((s) => sourceMap.set(s.id, s.display_name || 'Kalender'))
  integrationsResult.data?.forEach((i) => sourceMap.set(i.id, i.display_name || 'Integrasjon'))

  // Get children for mapping
  const { data: children } = await supabase
    .from('children')
    .select('id, name')
    .eq('household_id', householdId)

  const childMap = new Map<string, string>()
  children?.forEach((c) => childMap.set(c.id, c.name))

  try {
    // Fetch pending suggestions
    const { data: suggestions, error: suggestionsError } = await supabase
      .from('event_duplicate_suggestions')
      .select(`
        id,
        confidence,
        match_reason,
        created_at,
        event_a:external_events!event_a_id(
          id, title, event_date, end_date, event_time, event_type,
          source_url_id, integration_id, child_id
        ),
        event_b:external_events!event_b_id(
          id, title, event_date, end_date, event_time, event_type,
          source_url_id, integration_id, child_id
        )
      `)
      .eq('household_id', householdId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (suggestionsError) {
      console.error('[Duplicates API] Error fetching suggestions:', suggestionsError)
    }

    // Fetch recently merged duplicates (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const sourceUrlIds = sourceUrlsResult.data?.map((s) => s.id) || []
    const integrationIds = integrationsResult.data?.map((i) => i.id) || []

    // Query using safe parameterized .in() queries instead of .or() string interpolation
    const mergedDuplicates = await queryMergedDuplicates(
      supabase,
      sourceUrlIds,
      integrationIds,
      thirtyDaysAgo
    )

    // Get the kept events for merged duplicates
    const keptEventIds = [...new Set(mergedDuplicates.map((m) => m.duplicate_of_id))]
    let keptEventsMap = new Map<string, { title: string; event_date: string }>()

    if (keptEventIds.length > 0) {
      const { data: keptEvents } = await supabase
        .from('external_events')
        .select('id, title, event_date')
        .in('id', keptEventIds)

      keptEvents?.forEach((e) => keptEventsMap.set(e.id, { title: e.title, event_date: e.event_date }))
    }

    // Format suggestions
    const formattedSuggestions = (suggestions || []).map((s) => {
      const eventA = s.event_a as unknown as {
        id: string
        title: string
        event_date: string
        end_date: string | null
        event_time: string | null
        event_type: string | null
        source_url_id: string | null
        integration_id: string | null
        child_id: string | null
      }
      const eventB = s.event_b as unknown as typeof eventA

      return {
        id: s.id,
        confidence: s.confidence,
        matchReason: s.match_reason || '',
        createdAt: s.created_at,
        eventA: {
          id: eventA.id,
          title: eventA.title,
          event_date: eventA.event_date,
          end_date: eventA.end_date,
          event_time: eventA.event_time,
          event_type: eventA.event_type,
          source_name: sourceMap.get(eventA.source_url_id || eventA.integration_id || '') || null,
          child_name: eventA.child_id ? childMap.get(eventA.child_id) || null : null,
        },
        eventB: {
          id: eventB.id,
          title: eventB.title,
          event_date: eventB.event_date,
          end_date: eventB.end_date,
          event_time: eventB.event_time,
          event_type: eventB.event_type,
          source_name: sourceMap.get(eventB.source_url_id || eventB.integration_id || '') || null,
          child_name: eventB.child_id ? childMap.get(eventB.child_id) || null : null,
        },
      }
    })

    // Format merged duplicates
    const formattedMerged = mergedDuplicates.map((m) => {
      const keptEvent = keptEventsMap.get(m.duplicate_of_id)
      return {
        id: m.id,
        title: m.title,
        event_date: m.event_date,
        event_time: m.event_time,
        duplicate_of_id: m.duplicate_of_id,
        duplicate_confidence: m.duplicate_confidence || 0,
        kept_event_title: keptEvent?.title || 'Ukjent',
        kept_event_date: keptEvent?.event_date || m.event_date,
        source_name: sourceMap.get(m.source_url_id || m.integration_id || '') || null,
        child_name: m.child_id ? childMap.get(m.child_id) || null : null,
        merged_at: m.updated_at,
      }
    })

    return NextResponse.json({
      suggestions: formattedSuggestions,
      mergedDuplicates: formattedMerged,
    })
  } catch (error) {
    console.error('[Duplicates API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch duplicates' },
      { status: 500 }
    )
  }
}
