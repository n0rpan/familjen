import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin, isUserAdmin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { ISkoleClient, ISkoleAuthError, ISkoleError } from '@/lib/integrations/iskole'
import { addDays } from '@/lib/utils'

interface SyncResult {
  integrationId: string
  displayName: string
  success: boolean
  error?: string
  messagesCount: number
}

/**
 * POST /api/integrations/iskole/sync
 *
 * Sync messages from iSkole for the user's household.
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
    const rateLimitKey = createRateLimitKey(user.id, 'iskoleSync')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.iskoleSync)
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

    // Check if household has integrations enabled
    const { data: household } = await supabase
      .from('households')
      .select('external_integrations_enabled')
      .eq('id', membership.household_id)
      .single()

    if (!household?.external_integrations_enabled) {
      return NextResponse.json(
        { error: 'External integrations are not enabled for your household' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json().catch(() => ({}))
    const { integrationId } = body as { integrationId?: string }

    // Get integrations to sync
    let integrationsQuery = supabase
      .from('external_integrations')
      .select('*')
      .eq('household_id', membership.household_id)
      .eq('service', 'iskole')

    if (integrationId) {
      integrationsQuery = integrationsQuery.eq('id', integrationId)
    }

    const { data: integrations, error: integrationsError } = await integrationsQuery

    if (integrationsError) {
      console.error('Error fetching integrations:', integrationsError)
      return NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 })
    }

    if (!integrations || integrations.length === 0) {
      return NextResponse.json(
        { error: 'No iSkole integrations found' },
        { status: 404 }
      )
    }

    // Sync each integration
    const results: SyncResult[] = []
    const isAdmin = isUserAdmin(user)

    for (const integration of integrations) {
      const result = await syncIntegration(
        supabase,
        integration,
        membership.household_id,
        isAdmin
      )
      results.push(result)
    }

    // Calculate totals
    const totalMessages = results.reduce((sum, r) => sum + r.messagesCount, 0)
    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length

    return NextResponse.json({
      success: failureCount === 0,
      results: isAdmin ? results : results.map((r) => ({ ...r, error: r.error ? 'Sync failed' : undefined })),
      summary: {
        integrationsTotal: integrations.length,
        integrationsSuccess: successCount,
        integrationsFailed: failureCount,
        messagesTotal: totalMessages,
      },
    })
  } catch (error) {
    console.error('iSkole sync error:', error)
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 })
  }
}

/**
 * Sync a single iSkole integration.
 */
async function syncIntegration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  integration: {
    id: string
    display_name: string
    credentials_encrypted: string
    last_sync_at: string | null
  },
  householdId: string,
  isAdmin: boolean
): Promise<SyncResult> {
  const result: SyncResult = {
    integrationId: integration.id,
    displayName: integration.display_name,
    success: false,
    messagesCount: 0,
  }

  try {
    // Get decrypted credentials
    const { data: credentials, error: credError } = await supabase.rpc(
      'get_integration_credentials',
      { p_integration_id: integration.id }
    )

    if (credError || !credentials) {
      throw new Error('Failed to decrypt credentials')
    }

    const { username, password } = credentials as {
      username: string
      password: string
    }

    // Create iSkole client and login
    const client = new ISkoleClient({
      debug: process.env.NODE_ENV === 'development',
    })

    try {
      await client.login(username, password)
    } catch (error) {
      if (error instanceof ISkoleAuthError) {
        // Update status to auth_failed
        await supabase.rpc('update_integration_sync_status', {
          p_integration_id: integration.id,
          p_status: 'auth_failed',
          p_error: 'Invalid credentials',
        })
        result.error = isAdmin ? 'Authentication failed - check credentials' : 'Sync failed'
        return result
      }
      throw error
    }

    // Get children for mapping
    const { data: childMappings } = await supabase
      .from('external_integration_children')
      .select('child_id, external_group_id, external_group_name')
      .eq('integration_id', integration.id)

    // Build a map of external child IDs to our child IDs
    const childIdMap = new Map<string, string>()
    childMappings?.forEach((m) => {
      if (m.external_group_id && m.child_id) {
        childIdMap.set(m.external_group_id, m.child_id)
      }
    })

    // Calculate date range for messages
    const now = new Date()
    const lastSync = integration.last_sync_at
      ? new Date(integration.last_sync_at)
      : addDays(now, -7)

    const messagesToUpsert: Array<{
      integration_id: string
      child_id: string | null
      external_id: string
      external_group_id: string | null
      chat_id: string | null
      sender_name: string | null
      title: string | null
      body: string
      message_date: string
      source_type: string
      raw_data: unknown
    }> = []

    // Fetch children to get their school info
    const children = await client.getChildren()

    // Fetch messages for each child
    for (const child of children) {
      try {
        const messages = await client.getMessages(
          child.Elevnr,
          child.Fylkeid,
          child.Planperi,
          child.Skoleid,
          50,
          0
        )

        for (const msg of messages) {
          const msgDate = new Date(msg.Mottatt)
          if (msgDate < lastSync) continue

          const senderName = [msg.Fname, msg.Lname].filter(Boolean).join(' ') || null
          const childIdStr = String(child.Elevnr)
          const mappedChildId = childIdMap.get(childIdStr) || null

          messagesToUpsert.push({
            integration_id: integration.id,
            child_id: mappedChildId,
            external_id: `iskole_msg_${msg.Meldingid}`,
            external_group_id: childIdStr,
            chat_id: null,
            sender_name: senderName,
            title: msg.Emne || null,
            body: msg.Tekst || '',
            message_date: msgDate.toISOString(),
            source_type: 'school_message',
            raw_data: msg,
          })
        }
      } catch (msgError) {
        console.error(`Error fetching messages for child ${child.Elevnr}:`, msgError)
      }
    }

    // Upsert messages
    if (messagesToUpsert.length > 0) {
      const { error: messagesError } = await supabase
        .from('external_messages')
        .upsert(messagesToUpsert, {
          onConflict: 'integration_id,external_id',
          ignoreDuplicates: false,
        })

      if (messagesError) {
        console.error('Error upserting messages:', messagesError)
      } else {
        result.messagesCount = messagesToUpsert.length
      }
    }

    // Fetch and sync school calendar (FD = free day, PD = planning day)
    const eventsToUpsert: Array<{
      integration_id: string
      child_id: string | null
      external_id: string
      external_group_id: string | null
      title: string
      description: string | null
      event_date: string
      event_type: string
      raw_data: unknown
    }> = []

    // Get current and next month
    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1 // 1-12
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1

    // Weekday names for extracting specific days
    const weekdays = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lordag', 'Sondag'] as const
    const weekdayTypes = ['SkoletypeMandag', 'SkoletypeTirsdag', 'SkoletypeOnsdag', 'SkoletypeTorsdag', 'SkoletypeFredag', 'SkoletypeLordag', 'SkoletypeSondag'] as const

    for (const child of children) {
      const childIdStr = String(child.Elevnr)
      const mappedChildId = childIdMap.get(childIdStr) || null

      // Fetch calendar for both months
      for (const month of [currentMonth, nextMonth]) {
        try {
          const calendarDays = await client.getSchoolCalendar(
            month,
            child.Fylkeid,
            child.Planperi,
            child.Skoleid
          )

          // Process each week's data
          for (const week of calendarDays) {
            // Parse the base date (first day of week - Monday)
            const baseDateStr = week.Dato // "20250113" format
            const baseYear = parseInt(baseDateStr.substring(0, 4))
            const baseMonth = parseInt(baseDateStr.substring(4, 6)) - 1
            const baseDay = parseInt(baseDateStr.substring(6, 8))
            const baseDate = new Date(baseYear, baseMonth, baseDay)

            // Check each day of the week
            for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
              const dayTypeKey = weekdayTypes[dayIndex]
              const dayType = week[dayTypeKey]

              // Only sync FD (free day) and PD (planning day)
              if (dayType === 'FD' || dayType === 'PD') {
                const eventDate = new Date(baseDate)
                eventDate.setDate(baseDate.getDate() + dayIndex)
                const eventDateStr = eventDate.toISOString().split('T')[0]

                const title = dayType === 'FD' ? 'Skolefri' : 'Planleggingsdag'
                const dayName = weekdays[dayIndex]
                const dayContent = week[dayName]

                eventsToUpsert.push({
                  integration_id: integration.id,
                  child_id: mappedChildId,
                  external_id: `iskole_cal_${child.Elevnr}_${eventDateStr}`,
                  external_group_id: childIdStr,
                  title,
                  description: dayContent || null,
                  event_date: eventDateStr,
                  event_type: 'school_closure',
                  raw_data: { week, dayIndex, dayType },
                })
              }
            }
          }
        } catch (calError) {
          console.error(`Error fetching calendar for child ${child.Elevnr} month ${month}:`, calError)
        }
      }
    }

    // Upsert calendar events
    if (eventsToUpsert.length > 0) {
      const { error: eventsError } = await supabase
        .from('external_events')
        .upsert(eventsToUpsert, {
          onConflict: 'integration_id,external_id',
          ignoreDuplicates: false,
        })

      if (eventsError) {
        console.error('Error upserting calendar events:', eventsError)
      }
    }

    // Update sync status
    await supabase.rpc('update_integration_sync_status', {
      p_integration_id: integration.id,
      p_status: 'ok',
      p_error: null,
    })

    result.success = true
    return result
  } catch (error) {
    console.error(`Sync failed for integration ${integration.id}:`, error)

    // Update status to error
    const errorMessage = error instanceof ISkoleError ? error.message : 'Unknown error'
    await supabase.rpc('update_integration_sync_status', {
      p_integration_id: integration.id,
      p_status: 'error',
      p_error: errorMessage,
    })

    result.error = isAdmin ? errorMessage : 'Sync failed'
    return result
  }
}

/**
 * GET /api/integrations/iskole/sync
 *
 * Get sync status for all iSkole integrations.
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

    // Get integrations via RPC (handles RLS)
    const { data: integrations, error } = await supabase.rpc('get_household_integrations')

    if (error) {
      console.error('Error fetching integrations:', error)
      return NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 })
    }

    // Filter to iSkole only
    const iskoleIntegrations = integrations?.filter(
      (i: { service: string }) => i.service === 'iskole'
    )

    const isAdmin = isUserAdmin(user)

    return NextResponse.json({
      integrations: iskoleIntegrations?.map((i: {
        id: string
        display_name: string
        account_email: string | null
        last_sync_at: string | null
        last_sync_status: string
        last_sync_error: string | null
      }) => ({
        id: i.id,
        displayName: i.display_name,
        accountEmail: i.account_email,
        lastSyncAt: i.last_sync_at,
        lastSyncStatus: i.last_sync_status,
        lastSyncError: isAdmin ? i.last_sync_error : null,
      })),
    })
  } catch (error) {
    console.error('Error getting sync status:', error)
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 })
  }
}
