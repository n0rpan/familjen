/**
 * Cache Revalidation API
 *
 * Called by client components after mutations to invalidate server cache.
 * This ensures the next navigation shows fresh data instead of stale cache.
 *
 * Usage from client:
 *   await fetch('/api/revalidate', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ householdId: '...', weekStart: '2026-01-06' })
 *   })
 *
 *   // Or with type-specific revalidation:
 *   await fetch('/api/revalidate', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ householdId: '...', type: 'recipes' })
 *   })
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  revalidateHouseholdCache,
  revalidateWeekCache,
  revalidateRecipesCache,
  revalidateShoppingCache,
  revalidateSettingsCache,
  revalidateFeedCache,
  revalidateStyringCache,
  revalidateAdminCache,
} from '@/lib/data/server'

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { householdId, weekStart, type } = body

    // Admin cache revalidation (special case - no household needed)
    if (type === 'admin') {
      // Verify user is admin
      const { data: allowedEmail } = await supabase
        .from('allowed_emails')
        .select('is_admin')
        .eq('email', user.email?.toLowerCase())
        .maybeSingle()

      if (!allowedEmail?.is_admin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      revalidateAdminCache()
      return NextResponse.json({ revalidated: true })
    }

    if (!householdId) {
      return NextResponse.json({ error: 'householdId required' }, { status: 400 })
    }

    // Verify user belongs to this household
    const { data: membership } = await supabase
      .from('household_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('household_id', householdId)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Revalidate cache based on type
    switch (type) {
      case 'recipes':
        revalidateRecipesCache(householdId)
        break
      case 'shopping':
        revalidateShoppingCache(householdId)
        break
      case 'settings':
        revalidateSettingsCache(householdId)
        break
      case 'feed':
        revalidateFeedCache(householdId)
        break
      case 'styring':
        revalidateStyringCache(householdId)
        break
      default:
        if (weekStart) {
          // Targeted revalidation for specific week
          revalidateWeekCache(householdId, weekStart)
        } else {
          // Revalidate all household data
          revalidateHouseholdCache(householdId)
        }
    }

    return NextResponse.json({ revalidated: true })
  } catch (error) {
    console.error('Revalidation error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
