/**
 * Manual Deduplication API Endpoint
 *
 * Allows users to manually trigger deduplication of all existing events.
 * This scans all future events across all sources and:
 * - Auto-merges high confidence duplicates (≥0.9)
 * - Creates suggestions for medium confidence duplicates (0.6-0.9)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deduplicateAllEvents } from '@/lib/integrations/event-deduplication'

export async function POST() {
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
  const { data: member, error: memberError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .single()

  if (memberError || !member) {
    return NextResponse.json({ error: 'Household not found' }, { status: 404 })
  }

  try {
    const result = await deduplicateAllEvents(supabase, member.household_id)

    return NextResponse.json({
      success: true,
      autoMerged: result.autoMerged,
      suggestionsCreated: result.suggestionsCreated,
      pairsChecked: result.pairsChecked,
      errors: result.errors,
    })
  } catch (error) {
    console.error('[Manual Deduplication] Error:', error)
    return NextResponse.json(
      { error: 'Failed to run deduplication' },
      { status: 500 }
    )
  }
}
