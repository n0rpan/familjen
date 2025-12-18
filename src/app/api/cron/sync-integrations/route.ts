import { NextResponse } from 'next/server'
import { createClient as createServiceClient, SupabaseClient } from '@supabase/supabase-js'
import { SpondClient, SpondAuthError, SpondError } from '@/lib/integrations/spond'
import { formatDateISO, addDays } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

/**
 * Verify the request is from Vercel Cron.
 * In production, Vercel adds an Authorization header with CRON_SECRET.
 */
function verifyCronRequest(request: Request): boolean {
  // In development, allow without verification
  if (process.env.NODE_ENV === 'development') {
    return true
  }

  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return false
  }

  return authHeader === `Bearer ${cronSecret}`
}

/**
 * GET /api/cron/sync-integrations
 *
 * Scheduled sync for all external integrations.
 * Called by Vercel Cron at 05:00 UTC daily.
 */
export async function GET(request: Request) {
  // Verify cron authorization
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron] Starting scheduled integration sync')

  // Use service role client to bypass RLS
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[Cron] Missing Supabase configuration')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = createServiceClient(supabaseUrl, serviceRoleKey)

  try {
    // Get all households with integrations enabled
    const { data: households, error: householdsError } = await supabase
      .from('households')
      .select('id, name')
      .eq('external_integrations_enabled', true)

    if (householdsError) {
      console.error('[Cron] Error fetching households:', householdsError)
      return NextResponse.json({ error: 'Failed to fetch households' }, { status: 500 })
    }

    if (!households || households.length === 0) {
      console.log('[Cron] No households with integrations enabled')
      return NextResponse.json({
        success: true,
        householdsProcessed: 0,
        message: 'No households with integrations enabled',
      })
    }

    console.log(`[Cron] Found ${households.length} households with integrations enabled`)

    // Get all Spond integrations
    const { data: integrations, error: integrationsError } = await supabase
      .from('external_integrations')
      .select('*')
      .eq('service', 'spond')
      .in(
        'household_id',
        households.map((h) => h.id)
      )

    if (integrationsError) {
      console.error('[Cron] Error fetching integrations:', integrationsError)
      return NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 })
    }

    if (!integrations || integrations.length === 0) {
      console.log('[Cron] No Spond integrations found')
      return NextResponse.json({
        success: true,
        householdsProcessed: households.length,
        integrationsProcessed: 0,
        message: 'No Spond integrations to sync',
      })
    }

    console.log(`[Cron] Found ${integrations.length} Spond integrations to sync`)

    // Get all child mappings
    const { data: allChildMappings } = await supabase
      .from('external_integration_children')
      .select('integration_id, child_id, external_group_id')
      .in(
        'integration_id',
        integrations.map((i) => i.id)
      )

    // Group mappings by integration
    const childMappingsByIntegration = new Map<
      string,
      Array<{ childId: string; groupId: string }>
    >()
    allChildMappings?.forEach((mapping) => {
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
    const results: Array<{
      integrationId: string
      householdId: string
      success: boolean
      eventsCount: number
      messagesCount: number
      error?: string
    }> = []

    for (const integration of integrations) {
      const result = await syncIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || []
      )
      results.push({
        integrationId: integration.id,
        householdId: integration.household_id,
        ...result,
      })
    }

    // Process AI extraction for new messages
    let suggestionsCreated = 0
    const unprocessedMessages = await supabase
      .from('external_messages')
      .select('id, integration_id, child_id, body, sender_name')
      .eq('is_processed', false)
      .limit(100)

    if (unprocessedMessages.data && unprocessedMessages.data.length > 0) {
      console.log(`[Cron] Processing ${unprocessedMessages.data.length} messages for AI extraction`)

      // Get AI model
      const { data: modelSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'openrouter_model')
        .single()

      const model = modelSetting?.value || 'google/gemini-2.5-flash-lite'

      // Process messages (simplified for cron - can be batched)
      for (const message of unprocessedMessages.data) {
        try {
          const actions = await extractActionsFromMessage(message.body, 'barnet', model)

          for (const action of actions) {
            // Get household_id from integration
            const integration = integrations.find((i) => i.id === message.integration_id)
            if (!integration) continue

            await supabase.from('external_suggestions').insert({
              household_id: integration.household_id,
              integration_id: message.integration_id,
              source_message_id: message.id,
              suggested_type: action.type,
              suggested_child_id: message.child_id,
              suggested_date: action.date,
              suggested_time: action.time,
              suggested_title: action.title,
              suggested_description: action.description,
              confidence_score: action.confidence,
              status: 'pending',
            })
            suggestionsCreated++
          }

          // Mark as processed
          await supabase
            .from('external_messages')
            .update({ is_processed: true })
            .eq('id', message.id)
        } catch (error) {
          console.error(`[Cron] Error processing message ${message.id}:`, error)
        }
      }
    }

    // Summary
    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length
    const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)
    const totalMessages = results.reduce((sum, r) => sum + r.messagesCount, 0)

    console.log(`[Cron] Sync complete: ${successCount} success, ${failureCount} failed`)
    console.log(`[Cron] Events: ${totalEvents}, Messages: ${totalMessages}, Suggestions: ${suggestionsCreated}`)

    return NextResponse.json({
      success: true,
      householdsProcessed: households.length,
      integrationsProcessed: integrations.length,
      integrationsSuccess: successCount,
      integrationsFailed: failureCount,
      eventsTotal: totalEvents,
      messagesTotal: totalMessages,
      suggestionsCreated,
    })
  } catch (error) {
    console.error('[Cron] Sync error:', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}

/**
 * Sync a single integration.
 */
async function syncIntegration(
  supabase: AnySupabaseClient,
  integration: {
    id: string
    household_id: string
    display_name: string
    credentials_encrypted: string
    last_sync_at: string | null
  },
  childMappings: Array<{ childId: string; groupId: string }>
): Promise<{
  success: boolean
  eventsCount: number
  messagesCount: number
  error?: string
}> {
  const result = {
    success: false,
    eventsCount: 0,
    messagesCount: 0,
    error: undefined as string | undefined,
  }

  try {
    // Decrypt credentials using the decrypt_token function
    const { data: credentials, error: credError } = await supabase.rpc('decrypt_token', {
      ciphertext: integration.credentials_encrypted,
    })

    if (credError || !credentials) {
      console.error(`[Cron] Failed to decrypt credentials for ${integration.id}`)
      result.error = 'Failed to decrypt credentials'
      await updateSyncStatus(supabase, integration.id, 'error', result.error)
      return result
    }

    let parsedCreds: { email: string; password: string }
    try {
      parsedCreds = JSON.parse(credentials)
    } catch {
      console.error(`[Cron] Invalid credentials format for ${integration.id}`)
      result.error = 'Invalid credentials format'
      await updateSyncStatus(supabase, integration.id, 'error', result.error)
      return result
    }

    // Create Spond client and login
    const client = new SpondClient()

    try {
      await client.login(parsedCreds.email, parsedCreds.password)
    } catch (error) {
      if (error instanceof SpondAuthError) {
        result.error = 'Authentication failed'
        await updateSyncStatus(supabase, integration.id, 'auth_failed', result.error)
        return result
      }
      throw error
    }

    // Calculate date ranges
    const now = new Date()
    const futureDate = addDays(now, 30)
    const lastSync = integration.last_sync_at
      ? new Date(integration.last_sync_at)
      : addDays(now, -7)

    const mappedGroupIds = new Set(childMappings.map((m) => m.groupId))

    // Fetch events
    const events = await client.getEvents({
      includeScheduled: true,
      maxEvents: 200,
      minEndTimestamp: now,
      maxStartTimestamp: futureDate,
    })

    // Process events
    const eventsToUpsert: Array<Record<string, unknown>> = []

    for (const event of events) {
      const groupId = event.recipients?.group?.id
      if (!groupId) continue

      const childMapping = childMappings.find((m) => m.groupId === groupId)
      if (!childMapping && mappedGroupIds.size > 0) continue

      const mapped = SpondClient.mapEventToDb(event, groupId)
      eventsToUpsert.push({
        integration_id: integration.id,
        child_id: childMapping?.childId || null,
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

    if (eventsToUpsert.length > 0) {
      const { error: eventsError } = await supabase
        .from('external_events')
        .upsert(eventsToUpsert, {
          onConflict: 'integration_id,external_id',
        })

      if (!eventsError) {
        result.eventsCount = eventsToUpsert.length
      }
    }

    // Fetch messages
    try {
      const chats = await client.getChats({ limit: 50 })
      const messagesToUpsert: Array<Record<string, unknown>> = []

      for (const chat of chats) {
        const groupId = chat.groupId
        const childMapping = groupId ? childMappings.find((m) => m.groupId === groupId) : null

        const messages = await client.getChatMessages(chat.id, { limit: 50 })

        for (const message of messages) {
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

      if (messagesToUpsert.length > 0) {
        const { error: messagesError } = await supabase
          .from('external_messages')
          .upsert(messagesToUpsert, {
            onConflict: 'integration_id,external_id',
          })

        if (!messagesError) {
          result.messagesCount = messagesToUpsert.length
        }
      }
    } catch (chatError) {
      console.error(`[Cron] Chat sync error for ${integration.id}:`, chatError)
    }

    // Update sync status
    await updateSyncStatus(supabase, integration.id, 'ok', null)
    result.success = true

    return result
  } catch (error) {
    console.error(`[Cron] Sync failed for ${integration.id}:`, error)
    result.error = error instanceof SpondError ? error.message : 'Unknown error'
    await updateSyncStatus(supabase, integration.id, 'error', result.error)
    return result
  }
}

/**
 * Update integration sync status.
 */
async function updateSyncStatus(
  supabase: AnySupabaseClient,
  integrationId: string,
  status: string,
  error: string | null
) {
  await supabase
    .from('external_integrations')
    .update({
      last_sync_at: status === 'ok' ? new Date().toISOString() : undefined,
      last_sync_status: status,
      last_sync_error: error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', integrationId)
}

/**
 * Extract actions from message (simplified version for cron).
 */
async function extractActionsFromMessage(
  messageBody: string,
  childName: string,
  model: string
): Promise<
  Array<{
    type: 'task' | 'event' | 'reminder'
    title: string
    date: string | null
    time: string | null
    description: string | null
    confidence: number
  }>
> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return []

  const today = formatDateISO(new Date())

  const prompt = `Analyze this message from a children's activity group and extract action items.

Message: "${messageBody}"
Child: ${childName}
Today: ${today}

Return JSON array of action items:
[{"type": "task"|"event"|"reminder", "title": "string", "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "description": "string"|null, "confidence": 0.0-1.0}]

Return [] if no action items.`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    })

    if (!response.ok) return []

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return []

    // Simple JSON extraction
    const match = content.match(/\[[\s\S]*\]/)
    if (!match) return []

    const actions = JSON.parse(match[0])
    return Array.isArray(actions) ? actions : []
  } catch {
    return []
  }
}
