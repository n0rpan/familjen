import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Prevent static prerendering - this route uses cookies()
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/integration-debug?householdId=xxx
 *
 * Admin-only endpoint to debug integrations for any household.
 * Uses service role to bypass RLS.
 */
export async function GET(request: Request) {
  try {
    // Verify the user is an admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin status from allowed_emails
    const { data: allowedEmail } = await supabase
      .from('allowed_emails')
      .select('is_admin')
      .eq('email', user.email?.toLowerCase())
      .single()

    if (!allowedEmail?.is_admin) {
      return NextResponse.json({ error: 'Forbidden: Admin only' }, { status: 403 })
    }

    // Get household ID from query
    const url = new URL(request.url)
    const householdId = url.searchParams.get('householdId')

    if (!householdId) {
      return NextResponse.json({ error: 'Missing householdId' }, { status: 400 })
    }

    // Create service role client to bypass RLS
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Fetch integrations for the household
    const { data: integrations, error: intError } = await serviceClient
      .from('external_integrations')
      .select('id, service, display_name, account_email, last_sync_at, last_sync_status, last_sync_error')
      .eq('household_id', householdId)

    if (intError) {
      console.error('[Admin] Error fetching integrations:', intError)
      return NextResponse.json({ error: intError.message }, { status: 500 })
    }

    if (!integrations || integrations.length === 0) {
      return NextResponse.json({ integrations: [] })
    }

    // Get counts for each integration
    const integrationInfos = []
    for (const int of integrations) {
      const [eventsRes, messagesRes, photosRes] = await Promise.all([
        serviceClient.from('external_events').select('id', { count: 'exact', head: true }).eq('integration_id', int.id),
        serviceClient.from('external_messages').select('id', { count: 'exact', head: true }).eq('integration_id', int.id),
        serviceClient.from('external_photos').select('id', { count: 'exact', head: true }).eq('integration_id', int.id),
      ])

      integrationInfos.push({
        ...int,
        eventsCount: eventsRes.count || 0,
        messagesCount: messagesRes.count || 0,
        photosCount: photosRes.count || 0,
      })
    }

    return NextResponse.json({ integrations: integrationInfos })
  } catch (error) {
    console.error('[Admin] Integration debug error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
