import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin, isUserAdmin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { SpondClient, SpondAuthError, SpondError } from '@/lib/integrations/spond'
import { formatDateISO, addDays } from '@/lib/utils'

interface SyncResult {
  integrationId: string
  displayName: string
  success: boolean
  error?: string
  eventsCount: number
  messagesCount: number
}

/**
 * POST /api/integrations/spond/sync
 *
 * Sync events and messages from Spond for the user's household.
 * Can sync a specific integration or all integrations.
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
    const rateLimitKey = createRateLimitKey(user.id, 'spondSync')
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.calendarSync) // Reuse calendar rate limit
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
      .eq('service', 'spond')

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
        { error: 'No Spond integrations found' },
        { status: 404 }
      )
    }

    // Get child mappings for this household
    const { data: childMappings } = await supabase
      .from('external_integration_children')
      .select('integration_id, child_id, external_group_id')
      .in(
        'integration_id',
        integrations.map((i) => i.id)
      )

    const childMappingsByIntegration = new Map<
      string,
      Array<{ childId: string; groupId: string }>
    >()
    childMappings?.forEach((mapping) => {
      const existing = childMappingsByIntegration.get(mapping.integration_id) || []
      if (mapping.external_group_id) {
        existing.push({
          childId: mapping.child_id,
          groupId: mapping.external_group_id,
        })
      }
      childMappingsByIntegration.set(mapping.integration_id, existing)
    })

    // Sync each integration
    const results: SyncResult[] = []
    const isAdmin = isUserAdmin(user)

    for (const integration of integrations) {
      const result = await syncIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || [],
        membership.household_id,
        isAdmin
      )
      results.push(result)
    }

    // Calculate totals
    const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)
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
        eventsTotal: totalEvents,
        messagesTotal: totalMessages,
      },
    })
  } catch (error) {
    console.error('Spond sync error:', error)
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 })
  }
}

/**
 * Sync a single Spond integration.
 */
async function syncIntegration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  integration: {
    id: string
    display_name: string
    credentials_encrypted: string
    last_sync_at: string | null
  },
  childMappings: Array<{ childId: string; groupId: string }>,
  householdId: string,
  isAdmin: boolean
): Promise<SyncResult> {
  const result: SyncResult = {
    integrationId: integration.id,
    displayName: integration.display_name,
    success: false,
    eventsCount: 0,
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

    const { email, password } = credentials as { email: string; password: string }

    // Create Spond client and login
    const client = new SpondClient({
      debug: process.env.NODE_ENV === 'development',
    })

    try {
      await client.login(email, password)
    } catch (error) {
      if (error instanceof SpondAuthError) {
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

    // Fetch groups to identify which ones we care about
    const mappedGroupIds = new Set(childMappings.map((m) => m.groupId))

    // Calculate date ranges
    const now = new Date()
    const futureDate = addDays(now, 30) // Events for next 30 days
    const lastSync = integration.last_sync_at
      ? new Date(integration.last_sync_at)
      : addDays(now, -7) // Messages from last 7 days on first sync

    // Fetch events
    const events = await client.getEvents({
      includeScheduled: true,
      maxEvents: 200,
      minEndTimestamp: now,
      maxStartTimestamp: futureDate,
    })

    // Filter to events from groups we care about and map to DB format
    const eventsToUpsert: Array<{
      integration_id: string
      child_id: string | null
      external_id: string
      external_group_id: string | null
      title: string
      description: string | null
      event_date: string
      event_time: string | null
      end_date: string | null
      end_time: string | null
      location: string | null
      event_type: string | null
      raw_data: unknown
      updated_at: string
    }> = []

    for (const event of events) {
      // Find which group this event belongs to
      // Events can be sent to parent groups or subgroups
      const parentGroupId = event.recipients?.group?.id
      const subGroupIds = event.recipients?.subGroups?.map((sg) => sg.id) || []

      // Find a matching child mapping - check parent group and all subgroups
      let matchedMapping: { childId: string; groupId: string } | undefined
      let matchedGroupId: string | undefined

      // First check if parent group matches
      if (parentGroupId) {
        matchedMapping = childMappings.find((m) => m.groupId === parentGroupId)
        if (matchedMapping) {
          matchedGroupId = parentGroupId
        }
      }

      // If no parent match, check subgroups
      if (!matchedMapping && subGroupIds.length > 0) {
        for (const subGroupId of subGroupIds) {
          matchedMapping = childMappings.find((m) => m.groupId === subGroupId)
          if (matchedMapping) {
            matchedGroupId = subGroupId
            break
          }
        }
      }

      // If we have mappings but this event doesn't match any, skip it
      if (!matchedMapping && mappedGroupIds.size > 0) {
        continue
      }

      // Use the matched group ID, or fall back to parent group ID for unmapped events
      const groupIdForDb = matchedGroupId || parentGroupId || subGroupIds[0]
      if (!groupIdForDb) continue

      const mapped = SpondClient.mapEventToDb(event, groupIdForDb)
      eventsToUpsert.push({
        integration_id: integration.id,
        child_id: matchedMapping?.childId || null,
        external_id: mapped.externalId,
        external_group_id: mapped.externalGroupId,
        title: mapped.title,
        description: mapped.description,
        event_date: mapped.eventDate,
        event_time: mapped.eventTime,
        end_date: mapped.endDate,
        end_time: mapped.endTime,
        location: mapped.location,
        event_type: mapped.eventType,
        raw_data: mapped.rawData,
        updated_at: new Date().toISOString(),
      })
    }

    // Upsert events
    if (eventsToUpsert.length > 0) {
      const { error: eventsError } = await supabase
        .from('external_events')
        .upsert(eventsToUpsert, {
          onConflict: 'integration_id,external_id',
          ignoreDuplicates: false,
        })

      if (eventsError) {
        console.error('Error upserting events:', eventsError)
      } else {
        result.eventsCount = eventsToUpsert.length
      }
    }

    // Fetch chats and messages
    try {
      const chats = await client.getChats({ limit: 50 })

      const messagesToUpsert: Array<{
        integration_id: string
        child_id: string | null
        external_id: string
        external_group_id: string | null
        chat_id: string
        sender_name: string | null
        title: string | null
        body: string
        message_date: string
        raw_data: unknown
      }> = []

      for (const chat of chats) {
        // Check if this chat belongs to a mapped group
        const groupId = chat.groupId
        const childMapping = groupId
          ? childMappings.find((m) => m.groupId === groupId)
          : null

        // Get messages for this chat
        const messages = await client.getChatMessages(chat.id, { limit: 50 })

        for (const message of messages) {
          // Filter by date - only get messages since last sync
          const messageDate = new Date(message.timestamp)
          if (messageDate < lastSync) continue

          const mapped = SpondClient.mapMessageToDb(message, chat.id, groupId)
          messagesToUpsert.push({
            integration_id: integration.id,
            child_id: childMapping?.childId || null,
            external_id: mapped.externalId,
            external_group_id: mapped.externalGroupId,
            chat_id: mapped.chatId,
            sender_name: mapped.senderName,
            title: mapped.title,
            body: mapped.body,
            message_date: mapped.messageDate,
            raw_data: mapped.rawData,
          })
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
    } catch (chatError) {
      // Chat errors are non-fatal - we still synced events
      console.error('Error syncing chats:', chatError)
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
    const errorMessage = error instanceof SpondError ? error.message : 'Unknown error'
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
 * GET /api/integrations/spond/sync
 *
 * Get sync status for all Spond integrations.
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

    // Filter to Spond only
    const spondIntegrations = integrations?.filter(
      (i: { service: string }) => i.service === 'spond'
    )

    // Get counts
    const isAdmin = isUserAdmin(user)

    return NextResponse.json({
      integrations: spondIntegrations?.map((i: {
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
