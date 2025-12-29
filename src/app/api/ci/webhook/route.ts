/**
 * CI Webhook Endpoint
 *
 * Receives events from GitHub Actions to update CI dashboard
 * and send push notifications to admin users.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Create admin client (bypasses RLS)
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase credentials')
  }
  return createClient(url, key)
}

// Event types from CI
export interface CIEvent {
  type: 'pr_opened' | 'review_started' | 'review_completed' | 'verdict' | 'labels_applied'
  pr_number: number
  pr_title: string
  timestamp: string
  data: {
    verdict?: 'PASS' | 'BLOCK' | 'ERROR'
    cost_usd?: number
    labels?: string[]
    reviewers?: Array<{
      name: string
      verdict: string
      duration_ms: number
    }>
    summary?: string
    confidence?: number
  }
}

// Validate webhook secret
function validateSecret(request: NextRequest): boolean {
  const secret = request.headers.get('x-ci-secret')
  const expectedSecret = process.env.CI_WEBHOOK_SECRET
  if (!expectedSecret) {
    console.warn('CI_WEBHOOK_SECRET not set - accepting all webhooks')
    return true
  }
  return secret === expectedSecret
}

export async function POST(request: NextRequest) {
  try {
    // Validate secret
    if (!validateSecret(request)) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
    }

    const event = (await request.json()) as CIEvent
    console.log(`📬 CI webhook: ${event.type} for PR #${event.pr_number}`)

    const supabase = getAdminClient()

    // Store event in database
    const { error: insertError } = await supabase
      .from('ci_events')
      .insert({
        type: event.type,
        pr_number: event.pr_number,
        pr_title: event.pr_title,
        data: event.data,
        created_at: event.timestamp,
      })

    if (insertError) {
      console.error('Failed to store CI event:', insertError)
      // Don't fail the webhook, just log
    }

    // Send push notifications for important events
    if (event.type === 'verdict') {
      await notifyAdmins(supabase, event)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('CI webhook error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET endpoint to fetch recent CI events
export async function GET(request: NextRequest) {
  try {
    const supabase = getAdminClient()

    // Get last 50 events
    const { data, error } = await supabase
      .from('ci_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      throw error
    }

    return NextResponse.json({ events: data || [] })
  } catch (error) {
    console.error('Failed to fetch CI events:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

async function notifyAdmins(supabase: ReturnType<typeof getAdminClient>, event: CIEvent) {
  // Get admin users with push subscriptions
  const { data: admins } = await supabase
    .from('allowed_emails')
    .select('email')
    .eq('is_admin', true)

  if (!admins || admins.length === 0) return

  // Get push subscriptions for admin users
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_email', admins.map(a => a.email))

  if (!subscriptions || subscriptions.length === 0) return

  // Prepare notification
  const emoji = event.data.verdict === 'PASS' ? '✅' : event.data.verdict === 'BLOCK' ? '❌' : '⚠️'
  const title = `${emoji} PR #${event.pr_number}`
  const body = event.data.summary || `AI verdict: ${event.data.verdict}`

  // Send web push notifications
  // Note: Requires web-push library and VAPID keys to be set up
  // For now, just log
  console.log(`📢 Would notify ${subscriptions.length} admin(s): ${title} - ${body}`)
}
