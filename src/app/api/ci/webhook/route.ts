/**
 * CI Webhook Endpoint
 *
 * Receives events from GitHub Actions to update CI dashboard
 * and send push notifications to admin users.
 *
 * Security:
 * - POST: Requires CI_WEBHOOK_SECRET header
 * - GET: Requires admin authentication via Supabase
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

// Event types from CI
export interface CIEvent {
  type: 'pr_opened' | 'review_started' | 'review_completed' | 'verdict' | 'labels_applied' | 'activity_pulse'
  pr_number: number
  pr_title: string
  timestamp: string
  source?: string // 'production' | 'staging' | 'local'
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
    // Activity pulse data
    branch?: string
    work_type?: 'ai-agent' | 'feature' | 'bugfix' | 'production' | 'development' | 'unknown'
    commit_sha?: string
    commit_msg?: string
    areas?: string  // e.g., "ui(3) api(2) tests(1)"
    lines_added?: number
    lines_removed?: number
    actor?: string
    event?: string  // 'push' | 'pull_request'
    tips?: string   // AI-generated tips, pipe-separated
  }
}

// Validate webhook secret - REQUIRED, no fallback
function validateSecret(request: NextRequest): boolean {
  const secret = request.headers.get('x-ci-secret')
  const expectedSecret = process.env.CI_WEBHOOK_SECRET

  // Security: Require secret to be configured
  if (!expectedSecret) {
    console.error('CI_WEBHOOK_SECRET not configured - rejecting webhook')
    return false
  }

  return secret === expectedSecret
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting - use IP or forwarded IP as identifier
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
    const rateLimitKey = `ciWebhook:${clientIp}`
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.ciWebhook)

    if (rateLimit.limited) {
      console.warn(`⚠️ CI webhook rate limited for IP: ${clientIp}`)
      return ApiErrors.rateLimit(rateLimit.retryAfter)
    }

    // Validate secret - REQUIRED
    if (!validateSecret(request)) {
      return ApiErrors.unauthorized()
    }

    const event = (await request.json()) as CIEvent
    console.log(`📬 CI webhook: ${event.type} for PR #${event.pr_number}`)

    const supabase = createAdminClient()

    // Store event in database
    const { error: insertError } = await supabase
      .from('ci_events')
      .insert({
        type: event.type,
        pr_number: event.pr_number,
        pr_title: event.pr_title,
        source: event.source || 'production',
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
    return handleApiError(error, 'CI webhook')
  }
}

// GET endpoint to fetch recent CI events - ADMIN ONLY
export async function GET() {
  try {
    // Authenticate user
    const supabase = await createServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return ApiErrors.unauthorized()
    }

    // Check if user is admin
    const { data: allowedEmail } = await supabase
      .from('allowed_emails')
      .select('is_admin')
      .eq('email', user.email?.toLowerCase())
      .single()

    if (!allowedEmail?.is_admin) {
      return ApiErrors.adminRequired()
    }

    // Use admin client to bypass RLS for CI events
    const adminClient = createAdminClient()

    // Get last 50 events
    const { data, error } = await adminClient
      .from('ci_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      throw error
    }

    return NextResponse.json({ events: data || [] })
  } catch (error) {
    return handleApiError(error, 'CI events')
  }
}

async function notifyAdmins(supabase: ReturnType<typeof createAdminClient>, event: CIEvent) {
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
