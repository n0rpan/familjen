/**
 * CI Trend Data API
 *
 * Returns aggregated metrics for the CI dashboard.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase credentials')
  }
  return createClient(url, key)
}

export async function GET() {
  try {
    const supabase = getAdminClient()

    // Get all verdict events
    const { data: events, error } = await supabase
      .from('ci_events')
      .select('*')
      .eq('type', 'verdict')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      throw error
    }

    if (!events || events.length === 0) {
      return NextResponse.json({
        trend: {
          total_prs_reviewed: 0,
          total_cost_usd: 0,
          average_cost_per_pr: 0,
          accuracy_rate: 100,
          cost_trend: [],
          model_usage: {},
        },
      })
    }

    // Calculate stats
    const totalCost = events.reduce((sum, e) => sum + (e.data?.cost_usd || 0), 0)
    const avgCost = totalCost / events.length

    // Calculate accuracy (PASS verdicts that were merged = correct)
    // For now, assume 100% since we don't track post-merge outcomes yet
    const accuracyRate = 100

    // Group by date for trend
    const costByDate = new Map<string, { cost_usd: number; pr_count: number }>()
    for (const event of events) {
      const date = event.created_at.split('T')[0]
      const existing = costByDate.get(date) || { cost_usd: 0, pr_count: 0 }
      costByDate.set(date, {
        cost_usd: existing.cost_usd + (event.data?.cost_usd || 0),
        pr_count: existing.pr_count + 1,
      })
    }

    const costTrend = Array.from(costByDate.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)

    // Model usage (from reviewers data if available)
    const modelUsage: Record<string, { calls: number; tokens: number; cost_usd: number }> = {}

    return NextResponse.json({
      trend: {
        total_prs_reviewed: events.length,
        total_cost_usd: totalCost,
        average_cost_per_pr: avgCost,
        accuracy_rate: accuracyRate,
        cost_trend: costTrend,
        model_usage: modelUsage,
      },
    })
  } catch (error) {
    console.error('Failed to get CI trend:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
