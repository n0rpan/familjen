import { NextResponse } from 'next/server'
import { createClient as createServiceClient, SupabaseClient } from '@supabase/supabase-js'
import { SpondClient, SpondAuthError, SpondError } from '@/lib/integrations/spond'
import { KidplanClient, KidplanAuthError, KidplanError } from '@/lib/integrations/kidplan'
import { ISkoleClient, ISkoleAuthError, ISkoleError } from '@/lib/integrations/iskole'
import { MyKidClient, MyKidAuthError, MyKidError } from '@/lib/integrations/mykid'
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

    // Get all integrations (Spond, Kidplan, iSkole, MyKid)
    const { data: integrations, error: integrationsError } = await supabase
      .from('external_integrations')
      .select('*')
      .in('service', ['spond', 'kidplan', 'iskole', 'mykid'])
      .in(
        'household_id',
        households.map((h) => h.id)
      )

    if (integrationsError) {
      console.error('[Cron] Error fetching integrations:', integrationsError)
      return NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 })
    }

    if (!integrations || integrations.length === 0) {
      console.log('[Cron] No integrations found')
      return NextResponse.json({
        success: true,
        householdsProcessed: households.length,
        integrationsProcessed: 0,
        message: 'No integrations to sync',
      })
    }

    // Group integrations by service
    const spondIntegrations = integrations.filter((i) => i.service === 'spond')
    const kidplanIntegrations = integrations.filter((i) => i.service === 'kidplan')
    const iskoleIntegrations = integrations.filter((i) => i.service === 'iskole')
    const mykidIntegrations = integrations.filter((i) => i.service === 'mykid')

    console.log(`[Cron] Found ${spondIntegrations.length} Spond, ${kidplanIntegrations.length} Kidplan, ${iskoleIntegrations.length} iSkole, ${mykidIntegrations.length} MyKid integrations`)

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
      service: string
      success: boolean
      eventsCount: number
      messagesCount: number
      error?: string
    }> = []

    // Sync Spond integrations
    for (const integration of spondIntegrations) {
      const result = await syncSpondIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || []
      )
      results.push({
        integrationId: integration.id,
        householdId: integration.household_id,
        service: 'spond',
        ...result,
      })
    }

    // Sync Kidplan integrations
    for (const integration of kidplanIntegrations) {
      const result = await syncKidplanIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || []
      )
      results.push({
        integrationId: integration.id,
        householdId: integration.household_id,
        service: 'kidplan',
        ...result,
      })
    }

    // Sync iSkole integrations
    for (const integration of iskoleIntegrations) {
      const result = await syncISkoleIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || []
      )
      results.push({
        integrationId: integration.id,
        householdId: integration.household_id,
        service: 'iskole',
        ...result,
      })
    }

    // Sync MyKid integrations
    for (const integration of mykidIntegrations) {
      const result = await syncMyKidIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || []
      )
      results.push({
        integrationId: integration.id,
        householdId: integration.household_id,
        service: 'mykid',
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
 * Sync a single Spond integration.
 */
async function syncSpondIntegration(
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

    // Calculate date ranges (90 days ahead for calendar, 30 days back for messages)
    const now = new Date()
    const futureDate = addDays(now, 90)
    const lastSync = integration.last_sync_at
      ? new Date(integration.last_sync_at)
      : addDays(now, -30)

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

/**
 * Sync a single Kidplan integration.
 */
async function syncKidplanIntegration(
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
    // Decrypt credentials
    const { data: credentials, error: credError } = await supabase.rpc('decrypt_token', {
      ciphertext: integration.credentials_encrypted,
    })

    if (credError || !credentials) {
      result.error = 'Failed to decrypt credentials'
      await updateSyncStatus(supabase, integration.id, 'error', result.error)
      return result
    }

    let parsedCreds: { email: string; password: string; kindergartenId?: number }
    try {
      parsedCreds = JSON.parse(credentials)
    } catch {
      result.error = 'Invalid credentials format'
      await updateSyncStatus(supabase, integration.id, 'error', result.error)
      return result
    }

    // Create Kidplan client and login
    const client = new KidplanClient()

    try {
      await client.login(parsedCreds.email, parsedCreds.password, parsedCreds.kindergartenId)
    } catch (error) {
      if (error instanceof KidplanAuthError) {
        result.error = 'Authentication failed'
        await updateSyncStatus(supabase, integration.id, 'auth_failed', result.error)
        return result
      }
      throw error
    }

    const now = new Date()
    const lastSync = integration.last_sync_at
      ? new Date(integration.last_sync_at)
      : addDays(now, -30)

    // Fetch board posts and conversations
    // Note: Kidplan messages are not child-specific (board posts/conversations apply to all children)
    const messagesToUpsert: Array<Record<string, unknown>> = []

    try {
      const boardData = await client.getBoardPosts()

      for (const post of boardData.BoardPosts || []) {
        const postDate = new Date(post.Created)
        if (postDate < lastSync) continue

        messagesToUpsert.push({
          integration_id: integration.id,
          child_id: null,
          external_id: `boardpost_${post.PostId}`,
          external_group_id: null,
          chat_id: null,
          sender_name: post.AuthorName || null,
          title: post.Title || null,
          body: post.Content || '',
          message_date: postDate.toISOString(),
          source_type: 'board_post',
          raw_data: post,
        })
      }
    } catch (boardError) {
      console.error(`[Cron] Kidplan board fetch error for ${integration.id}:`, boardError)
    }

    try {
      const conversations = await client.getConversations(20, 0)

      for (const conv of conversations) {
        try {
          const messages = await client.getMessages(conv.ConversationId, 20, 0)

          for (const msg of messages) {
            const msgDate = new Date(msg.Created)
            if (msgDate < lastSync) continue

            messagesToUpsert.push({
              integration_id: integration.id,
              child_id: null,
              external_id: `message_${msg.MessageId}`,
              external_group_id: null,
              chat_id: String(conv.ConversationId),
              sender_name: msg.SenderName || null,
              title: null,
              body: msg.Body || '',
              message_date: msgDate.toISOString(),
              source_type: 'conversation',
              raw_data: msg,
            })
          }
        } catch (msgError) {
          console.error(`[Cron] Kidplan messages error for conversation ${conv.ConversationId}:`, msgError)
        }
      }
    } catch (convError) {
      console.error(`[Cron] Kidplan conversations error for ${integration.id}:`, convError)
    }

    // Upsert messages
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

    await updateSyncStatus(supabase, integration.id, 'ok', null)
    result.success = true
    return result
  } catch (error) {
    console.error(`[Cron] Kidplan sync failed for ${integration.id}:`, error)
    result.error = error instanceof KidplanError ? error.message : 'Unknown error'
    await updateSyncStatus(supabase, integration.id, 'error', result.error)
    return result
  }
}

/**
 * Sync a single iSkole integration.
 */
async function syncISkoleIntegration(
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
    // Decrypt credentials
    const { data: credentials, error: credError } = await supabase.rpc('decrypt_token', {
      ciphertext: integration.credentials_encrypted,
    })

    if (credError || !credentials) {
      result.error = 'Failed to decrypt credentials'
      await updateSyncStatus(supabase, integration.id, 'error', result.error)
      return result
    }

    let parsedCreds: { username: string; password: string }
    try {
      parsedCreds = JSON.parse(credentials)
    } catch {
      result.error = 'Invalid credentials format'
      await updateSyncStatus(supabase, integration.id, 'error', result.error)
      return result
    }

    // Create iSkole client and login
    const client = new ISkoleClient()

    try {
      await client.login(parsedCreds.username, parsedCreds.password)
    } catch (error) {
      if (error instanceof ISkoleAuthError) {
        result.error = 'Authentication failed'
        await updateSyncStatus(supabase, integration.id, 'auth_failed', result.error)
        return result
      }
      throw error
    }

    // Build child ID map
    const childIdMap = new Map<string, string>()
    childMappings.forEach((m) => {
      if (m.groupId && m.childId) {
        childIdMap.set(m.groupId, m.childId)
      }
    })

    const now = new Date()
    const lastSync = integration.last_sync_at
      ? new Date(integration.last_sync_at)
      : addDays(now, -30)

    const messagesToUpsert: Array<Record<string, unknown>> = []

    // Fetch children and their messages
    try {
      const children = await client.getChildren()

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
          console.error(`[Cron] iSkole messages error for child ${child.Elevnr}:`, msgError)
        }
      }
    } catch (childError) {
      console.error(`[Cron] iSkole children error for ${integration.id}:`, childError)
    }

    // Upsert messages
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

    await updateSyncStatus(supabase, integration.id, 'ok', null)
    result.success = true
    return result
  } catch (error) {
    console.error(`[Cron] iSkole sync failed for ${integration.id}:`, error)
    result.error = error instanceof ISkoleError ? error.message : 'Unknown error'
    await updateSyncStatus(supabase, integration.id, 'error', result.error)
    return result
  }
}

/**
 * Sync a single MyKid integration.
 * Note: Photos are NOT synced in cron (too slow) - only in on-demand sync.
 */
async function syncMyKidIntegration(
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
    // Decrypt credentials
    const { data: credentials, error: credError } = await supabase.rpc('decrypt_token', {
      ciphertext: integration.credentials_encrypted,
    })

    if (credError || !credentials) {
      result.error = 'Failed to decrypt credentials'
      await updateSyncStatus(supabase, integration.id, 'error', result.error)
      return result
    }

    let parsedCreds: { phone: string; password: string }
    try {
      parsedCreds = JSON.parse(credentials)
    } catch {
      result.error = 'Invalid credentials format'
      await updateSyncStatus(supabase, integration.id, 'error', result.error)
      return result
    }

    // Create MyKid client and login
    const client = new MyKidClient()

    try {
      await client.login(parsedCreds.phone, parsedCreds.password)
    } catch (error) {
      if (error instanceof MyKidAuthError) {
        result.error = 'Authentication failed'
        await updateSyncStatus(supabase, integration.id, 'auth_failed', result.error)
        return result
      }
      throw error
    }

    const now = new Date()
    const futureDate = addDays(now, 90)
    const lastSync = integration.last_sync_at
      ? new Date(integration.last_sync_at)
      : addDays(now, -30)

    // Sync calendar events (JSON API - easy)
    try {
      const events = await client.getCalendarEvents(now, futureDate)
      const eventsToUpsert: Array<Record<string, unknown>> = []

      for (const event of events) {
        const mapped = MyKidClient.mapCalendarEventToDb(event)
        eventsToUpsert.push({
          integration_id: integration.id,
          child_id: null, // MyKid events are not child-specific
          external_id: mapped.externalId,
          external_group_id: null,
          title: mapped.title,
          description: mapped.description,
          event_date: mapped.eventDate,
          event_time: mapped.eventTime,
          end_date: mapped.endDate,
          end_time: mapped.endTime,
          location: null,
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
    } catch (calendarError) {
      console.error(`[Cron] MyKid calendar error for ${integration.id}:`, calendarError)
    }

    // Sync newsletters (HTML parsing)
    const messagesToUpsert: Array<Record<string, unknown>> = []

    try {
      const newsletters = await client.getNewsletterList()

      // Limit to recent 20 in cron
      for (const summary of newsletters.slice(0, 20)) {
        // Check if already synced
        const { data: existing } = await supabase
          .from('external_messages')
          .select('id')
          .eq('integration_id', integration.id)
          .eq('external_id', `newsletter_${summary.id}`)
          .single()

        if (!existing) {
          try {
            const full = await client.getNewsletterContent(summary.id)
            const mapped = MyKidClient.mapNewsletterToDb(full)

            messagesToUpsert.push({
              integration_id: integration.id,
              child_id: null,
              external_id: mapped.externalId,
              external_group_id: null,
              chat_id: null,
              sender_name: null,
              title: mapped.title,
              body: mapped.body,
              message_date: mapped.messageDate,
              source_type: 'newsletter',
              raw_data: mapped.rawData,
            })

            // Small delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 100))
          } catch (contentError) {
            console.error(`[Cron] MyKid newsletter content error for ${summary.id}:`, contentError)
          }
        }
      }
    } catch (newsletterError) {
      console.error(`[Cron] MyKid newsletter list error for ${integration.id}:`, newsletterError)
    }

    // Upsert messages
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

    await updateSyncStatus(supabase, integration.id, 'ok', null)
    result.success = true
    return result
  } catch (error) {
    console.error(`[Cron] MyKid sync failed for ${integration.id}:`, error)
    result.error = error instanceof MyKidError ? error.message : 'Unknown error'
    await updateSyncStatus(supabase, integration.id, 'error', result.error)
    return result
  }
}
