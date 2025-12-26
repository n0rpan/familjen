import { NextResponse } from 'next/server'
import { createClient as createServiceClient, SupabaseClient } from '@supabase/supabase-js'
import { SpondClient, SpondAuthError, SpondError } from '@/lib/integrations/spond'
import { KidplanClient, KidplanAuthError, KidplanError } from '@/lib/integrations/kidplan'
import { ISkoleClient, ISkoleAuthError, ISkoleError } from '@/lib/integrations/iskole'
import { MyKidClient, MyKidAuthError, MyKidError } from '@/lib/integrations/mykid'
import { extractEventsFromHtml, extractEventsFromPdf, extractEventsFromImage, type ExtractedEvent } from '@/lib/integrations/document-extraction'
import { syncCalendarSource, type CalendarSource } from '@/lib/integrations/calendar-source-sync'
import { formatDateISO, addDays } from '@/lib/utils'
import { fetchAndParseICS, type ICSEvent } from '@/lib/ics-parser'
import { syncHouseholdICS as syncHouseholdICSShared } from '@/lib/household-ics-sync'
import { verifyCronRequest } from '@/lib/cron-auth'
import { truncate, sanitizeString, sanitizeTime } from '@/lib/sanitize'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

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

    // Sync each integration in parallel (grouped by service to respect rate limits)
    const results: Array<{
      integrationId: string
      householdId: string
      service: string
      success: boolean
      eventsCount: number
      messagesCount: number
      error?: string
    }> = []

    // Create sync promises for each service type (parallel within groups)
    const spondPromises = spondIntegrations.map(async (integration) => {
      const result = await syncSpondIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || []
      )
      return {
        integrationId: integration.id,
        householdId: integration.household_id,
        service: 'spond' as const,
        ...result,
      }
    })

    const kidplanPromises = kidplanIntegrations.map(async (integration) => {
      const result = await syncKidplanIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || []
      )
      return {
        integrationId: integration.id,
        householdId: integration.household_id,
        service: 'kidplan' as const,
        ...result,
      }
    })

    const iskolePromises = iskoleIntegrations.map(async (integration) => {
      const result = await syncISkoleIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || []
      )
      return {
        integrationId: integration.id,
        householdId: integration.household_id,
        service: 'iskole' as const,
        ...result,
      }
    })

    const mykidPromises = mykidIntegrations.map(async (integration) => {
      const result = await syncMyKidIntegration(
        supabase,
        integration,
        childMappingsByIntegration.get(integration.id) || []
      )
      return {
        integrationId: integration.id,
        householdId: integration.household_id,
        service: 'mykid' as const,
        ...result,
      }
    })

    // Run all service types in parallel using Promise.allSettled
    const allSettled = await Promise.allSettled([
      ...spondPromises,
      ...kidplanPromises,
      ...iskolePromises,
      ...mykidPromises,
    ])

    // Collect results, handling any unexpected rejections
    for (const settled of allSettled) {
      if (settled.status === 'fulfilled') {
        results.push(settled.value)
      } else {
        // Promise rejected unexpectedly (shouldn't happen as sync functions catch errors)
        console.error('[Cron] Unexpected sync rejection:', settled.reason)
      }
    }

    // Sync ICS calendars for all members with ICS URLs
    const icsResults = await syncAllICSCalendars(supabase)
    console.log(`[Cron] ICS sync: ${icsResults.membersSuccess}/${icsResults.membersProcessed} success, ${icsResults.eventsTotal} events`)

    // Sync household ICS calendars (shared family calendars)
    const householdIcsResults = await syncAllHouseholdICSCalendars(supabase)
    console.log(`[Cron] Household ICS sync: ${householdIcsResults.householdsSuccess}/${householdIcsResults.householdsProcessed} success, ${householdIcsResults.eventsTotal} events`)

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

    // Process unprocessed documents for AI event extraction
    let documentsProcessed = 0
    let documentSuggestionsCreated = 0

    // Get vision model from settings
    const { data: visionModelSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'openrouter_vision_model')
      .single()

    const visionModel = visionModelSetting?.value || 'google/gemini-2.0-flash-001'

    // Process documents where ai_processed = false
    const { data: unprocessedDocuments } = await supabase
      .from('external_documents')
      .select('id, household_id, source_type, source_url, title, mime_type, storage_path, extracted_text, child_id')
      .eq('ai_processed', false)
      .limit(50)

    if (unprocessedDocuments && unprocessedDocuments.length > 0) {
      console.log(`[Cron] Processing ${unprocessedDocuments.length} documents for AI event extraction`)

      for (const doc of unprocessedDocuments) {
        try {
          let events: ExtractedEvent[] = []

          if (doc.mime_type === 'text/html' && doc.extracted_text) {
            // HTML content - extract events from text
            events = await extractEventsFromHtml(doc.extracted_text, {
              childName: undefined,
              schoolName: doc.title || doc.source_url || undefined,
              model: visionModel,
            })
          } else if (doc.mime_type === 'application/pdf' && doc.storage_path) {
            // PDF - download from storage and process with vision
            const { data: pdfData, error: downloadError } = await supabase.storage
              .from('external-documents')
              .download(doc.storage_path)

            if (downloadError) {
              console.error(`[Cron] Failed to download PDF ${doc.id}:`, downloadError.message)
            } else if (pdfData) {
              const buffer = Buffer.from(await pdfData.arrayBuffer())
              const pdfBase64 = buffer.toString('base64')
              const result = await extractEventsFromPdf(pdfBase64, {
                source: doc.title || doc.source_url || undefined,
                model: visionModel,
              })
              events = result.events
            }
          } else if (doc.mime_type?.startsWith('image/') && doc.storage_path) {
            // Image - download from storage and process with vision
            const { data: imageData, error: downloadError } = await supabase.storage
              .from('external-documents')
              .download(doc.storage_path)

            if (downloadError) {
              console.error(`[Cron] Failed to download image ${doc.id}:`, downloadError.message)
            } else if (imageData) {
              const buffer = Buffer.from(await imageData.arrayBuffer())
              const imageBase64 = buffer.toString('base64')
              events = await extractEventsFromImage(imageBase64, doc.mime_type, {
                source: doc.title || doc.source_url || undefined,
                model: visionModel,
              })
            }
          }

          // Create suggestions for extracted events
          for (const event of events) {
            if (event.confidence >= 0.5) {
              await supabase.from('external_suggestions').insert({
                household_id: doc.household_id,
                source_document_id: doc.id,
                suggested_type: event.eventType === 'deadline' ? 'task' : 'event',
                suggested_child_id: doc.child_id || null,
                suggested_date: event.date,
                suggested_time: event.time || null,
                suggested_title: event.title,
                suggested_description: event.description || null,
                confidence_score: event.confidence,
                status: 'pending',
              })
              documentSuggestionsCreated++
            }
          }

          // Mark as processed
          await supabase
            .from('external_documents')
            .update({
              ai_processed: true,
              ai_processed_at: new Date().toISOString(),
            })
            .eq('id', doc.id)

          documentsProcessed++

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200))
        } catch (error) {
          console.error(`[Cron] Error processing document ${doc.id}:`, error)
        }
      }
    }

    // Sync calendar source URLs with proper event tracking
    let calendarSourcesProcessed = 0
    let calendarSourcesSuccess = 0
    let calendarEventsFound = 0
    let calendarEventsCreated = 0
    let calendarEventsRemoved = 0
    let calendarNotificationsCreated = 0
    const now = new Date()

    const { data: sourceUrls } = await supabase
      .from('external_source_urls')
      .select('id, household_id, url, display_name, url_type, sync_frequency_days, last_sync_at, child_id, auto_sync')
      .eq('auto_sync', true)

    if (sourceUrls && sourceUrls.length > 0) {
      for (const sourceUrl of sourceUrls) {
        // Check if sync is due
        const lastSync = sourceUrl.last_sync_at ? new Date(sourceUrl.last_sync_at) : null
        const syncDueDays = sourceUrl.sync_frequency_days || 7
        const syncDue = !lastSync || (now.getTime() - lastSync.getTime()) > (syncDueDays * 24 * 60 * 60 * 1000)

        if (!syncDue) continue

        calendarSourcesProcessed++

        try {
          console.log(`[Cron] Syncing calendar source: ${sourceUrl.display_name}`)

          // For HTML/calendar pages, use the new sync function with event tracking
          if (sourceUrl.url_type === 'calendar_page' || !sourceUrl.url_type) {
            const calendarSource: CalendarSource = {
              id: sourceUrl.id,
              household_id: sourceUrl.household_id,
              url: sourceUrl.url,
              display_name: sourceUrl.display_name,
              url_type: sourceUrl.url_type || 'calendar_page',
              child_id: sourceUrl.child_id,
              auto_sync: sourceUrl.auto_sync,
              last_sync_at: sourceUrl.last_sync_at,
            }

            const syncResult = await syncCalendarSource(supabase, calendarSource, { model: visionModel })

            if (syncResult.success) {
              calendarSourcesSuccess++
              calendarEventsFound += syncResult.eventsFound
              calendarEventsCreated += syncResult.eventsCreated
              calendarEventsRemoved += syncResult.eventsRemoved
              calendarNotificationsCreated += syncResult.notificationsCreated

              console.log(
                `[Cron] ${sourceUrl.display_name}: ${syncResult.eventsFound} found, ` +
                `${syncResult.eventsCreated} new, ${syncResult.eventsUpdated} updated, ` +
                `${syncResult.eventsRemoved} removed`
              )
            } else {
              console.error(`[Cron] Calendar source sync failed for ${sourceUrl.display_name}:`, syncResult.error)
            }
          } else if (sourceUrl.url_type === 'pdf') {
            // PDF document - store for AI processing (legacy approach)
            const response = await fetch(sourceUrl.url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; FamiljenBot/1.0)',
                'Accept': 'application/pdf,*/*',
              },
            })

            if (!response.ok) throw new Error(`HTTP ${response.status}`)

            const buffer = Buffer.from(await response.arrayBuffer())
            const filename = `source_${sourceUrl.id}_${Date.now()}.pdf`
            const storagePath = `${sourceUrl.household_id}/manual/${filename}`

            await supabase.storage
              .from('external-documents')
              .upload(storagePath, buffer, {
                contentType: 'application/pdf',
                upsert: true,
              })

            await supabase
              .from('external_documents')
              .upsert({
                household_id: sourceUrl.household_id,
                source_url_id: sourceUrl.id,
                external_id: `manual_${sourceUrl.id}`,
                source_type: 'manual_url',
                source_url: sourceUrl.url,
                title: sourceUrl.display_name,
                filename,
                mime_type: 'application/pdf',
                storage_path: storagePath,
                file_size: buffer.length,
                ai_processed: false,
                child_id: sourceUrl.child_id,
              }, {
                onConflict: 'source_url_id',
              })

            await supabase
              .from('external_source_urls')
              .update({
                last_sync_at: new Date().toISOString(),
                last_sync_status: 'ok',
                last_sync_error: null,
              })
              .eq('id', sourceUrl.id)

            calendarSourcesSuccess++
          }
          // ICS type is handled separately by household ICS sync

          // Small delay between syncs
          await new Promise((resolve) => setTimeout(resolve, 500))
        } catch (error) {
          console.error(`[Cron] Error syncing source URL ${sourceUrl.id}:`, error)

          await supabase
            .from('external_source_urls')
            .update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: 'error',
              last_sync_error: error instanceof Error ? error.message : 'Unknown error',
            })
            .eq('id', sourceUrl.id)
        }
      }
    }

    // Run cleanup for stale suggestions and old notifications
    try {
      const { data: cleanupResult } = await supabase.rpc('cleanup_stale_calendar_data')
      if (cleanupResult) {
        console.log(`[Cron] Cleanup: ${cleanupResult.notifications_deleted} notifications, ${cleanupResult.suggestions_deleted} suggestions`)
      }
    } catch (cleanupError) {
      console.error('[Cron] Cleanup failed:', cleanupError)
    }

    console.log(`[Cron] Documents: ${documentsProcessed} processed, ${documentSuggestionsCreated} suggestions`)
    console.log(`[Cron] Calendar sources: ${calendarSourcesSuccess}/${calendarSourcesProcessed} synced, ${calendarEventsFound} events found, ${calendarEventsRemoved} removed`)

    // Summary
    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length
    const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)
    const totalMessages = results.reduce((sum, r) => sum + r.messagesCount, 0)

    console.log(`[Cron] Sync complete: ${successCount} success, ${failureCount} failed`)
    console.log(`[Cron] Events: ${totalEvents}, Messages: ${totalMessages}, Suggestions: ${suggestionsCreated + documentSuggestionsCreated}`)

    return NextResponse.json({
      success: true,
      householdsProcessed: households.length,
      integrationsProcessed: integrations.length,
      integrationsSuccess: successCount,
      integrationsFailed: failureCount,
      eventsTotal: totalEvents,
      messagesTotal: totalMessages,
      suggestionsCreated: suggestionsCreated + documentSuggestionsCreated,
      documentsProcessed,
      calendarSources: {
        processed: calendarSourcesProcessed,
        success: calendarSourcesSuccess,
        eventsFound: calendarEventsFound,
        eventsCreated: calendarEventsCreated,
        eventsRemoved: calendarEventsRemoved,
        notificationsCreated: calendarNotificationsCreated,
      },
      icsCalendars: {
        membersProcessed: icsResults.membersProcessed,
        membersSuccess: icsResults.membersSuccess,
        eventsTotal: icsResults.eventsTotal,
      },
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
        title: truncate(sanitizeString(mapped.title), 200),
        description: truncate(sanitizeString(mapped.description), 2000),
        event_date: mapped.eventDate,
        event_time: sanitizeTime(mapped.eventTime),
        end_date: mapped.endDate,
        end_time: sanitizeTime(mapped.endTime),
        location: truncate(sanitizeString(mapped.location), 500),
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
            sender_name: truncate(sanitizeString(mapped.senderName), 100),
            title: truncate(sanitizeString(mapped.title), 200),
            body: truncate(sanitizeString(mapped.body), 50000),
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

    // Fetch children (for calendar sync later) and messages
    let children: Awaited<ReturnType<typeof client.getChildren>> = []
    try {
      children = await client.getChildren()

      // Fetch all messages (uses elevnr=0 to get all children's messages)
      const messages = await client.getMessages(100, 0)

      for (const msg of messages) {
        const msgDate = new Date(msg.Mottatt)
        if (msgDate < lastSync) continue

        const senderName = [msg.Fname, msg.Lname].filter(Boolean).join(' ') || null
        const childIdStr = msg.Elevnr ? String(msg.Elevnr) : null
        const mappedChildId = childIdStr ? childIdMap.get(childIdStr) || null : null

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
    } catch (syncError) {
      console.error(`[Cron] iSkole sync error for ${integration.id}:`, syncError)
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

// Sync window for ICS calendars: 90 days ahead
const ICS_SYNC_DAYS_AHEAD = 90

/**
 * Sync all ICS calendars for members with ICS URLs.
 */
async function syncAllICSCalendars(
  supabase: AnySupabaseClient
): Promise<{
  membersProcessed: number
  membersSuccess: number
  eventsTotal: number
}> {
  const result = {
    membersProcessed: 0,
    membersSuccess: 0,
    eventsTotal: 0,
  }

  try {
    // Get all members with ICS URLs
    const { data: members, error: membersError } = await supabase
      .from('household_members')
      .select('id, name, ics_calendar_url, household_id')
      .not('ics_calendar_url', 'is', null)

    if (membersError || !members || members.length === 0) {
      console.log('[Cron] No members with ICS calendars')
      return result
    }

    result.membersProcessed = members.length
    console.log(`[Cron] Found ${members.length} members with ICS calendars`)

    // Sync each member
    for (const member of members) {
      try {
        const eventsCount = await syncMemberICS(supabase, member)
        result.membersSuccess++
        result.eventsTotal += eventsCount

        // Small delay between syncs to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch (error) {
        console.error(`[Cron] ICS sync failed for ${member.name}:`, error)
      }
    }

    return result
  } catch (error) {
    console.error('[Cron] ICS calendar sync error:', error)
    return result
  }
}

/**
 * Sync ICS calendar for a single member.
 */
async function syncMemberICS(
  supabase: AnySupabaseClient,
  member: {
    id: string
    name: string
    ics_calendar_url: string
    household_id: string
  }
): Promise<number> {
  try {
    // Calculate date range
    const startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    const endDate = addDays(startDate, ICS_SYNC_DAYS_AHEAD)

    // Fetch and parse ICS
    const events = await fetchAndParseICS(member.ics_calendar_url, startDate, endDate)

    // Convert to member_events format
    const eventsToUpsert = events.map((event) => {
      // Format time as HH:MM:SS if not an all-day event
      let eventTime: string | null = null
      if (!event.isAllDay) {
        const hours = event.startDate.getHours().toString().padStart(2, '0')
        const minutes = event.startDate.getMinutes().toString().padStart(2, '0')
        eventTime = `${hours}:${minutes}:00`
      }

      return {
        household_id: member.household_id,
        member_id: member.id,
        date: formatDateISO(event.startDate),
        end_date: event.endDate.toDateString() !== event.startDate.toDateString()
          ? formatDateISO(event.endDate)
          : null,
        title: event.summary.substring(0, 200),
        event_type: inferEventType(event),
        event_time: eventTime,
        source: 'ics_calendar' as const,
        source_email: null,
        google_event_id: null,
        ics_uid: event.uid,
      }
    })

    // Delete old ICS events for this member that are no longer in the feed
    const currentUIDs = new Set(eventsToUpsert.map((e) => e.ics_uid))

    const { data: existingEvents } = await supabase
      .from('member_events')
      .select('id, ics_uid, date')
      .eq('member_id', member.id)
      .eq('source', 'ics_calendar')
      .gte('date', formatDateISO(startDate))
      .lte('date', formatDateISO(endDate))

    if (existingEvents) {
      const eventsToDelete = existingEvents.filter(
        (e: { ics_uid: string }) => e.ics_uid && !currentUIDs.has(e.ics_uid)
      )
      if (eventsToDelete.length > 0) {
        await supabase
          .from('member_events')
          .delete()
          .in('id', eventsToDelete.map((e: { id: string }) => e.id))
      }
    }

    // Upsert events
    if (eventsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('member_events')
        .upsert(eventsToUpsert, {
          onConflict: 'household_id,member_id,date,ics_uid',
          ignoreDuplicates: false,
        })

      if (upsertError) {
        throw new Error(`Failed to upsert events: ${upsertError.message}`)
      }
    }

    // Update sync status
    await supabase
      .from('household_members')
      .update({
        ics_last_sync_at: new Date().toISOString(),
        ics_sync_error: null,
      })
      .eq('id', member.id)

    return eventsToUpsert.length
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Cron] ICS sync failed for ${member.name}:`, errorMessage)

    // Update sync error
    await supabase
      .from('household_members')
      .update({
        ics_sync_error: errorMessage.substring(0, 500),
      })
      .eq('id', member.id)

    throw error
  }
}

/**
 * Infer event type from ICS event content.
 */
function inferEventType(event: ICSEvent): 'work' | 'travel' | 'family' | 'other' {
  const text = `${event.summary} ${event.description || ''} ${event.location || ''}`.toLowerCase()

  if (
    text.includes('flight') ||
    text.includes('fly') ||
    text.includes('reise') ||
    text.includes('travel') ||
    text.includes('trip') ||
    text.includes('airport') ||
    text.includes('hotel')
  ) {
    return 'travel'
  }

  if (
    text.includes('family') ||
    text.includes('familie') ||
    text.includes('birthday') ||
    text.includes('bursdag') ||
    text.includes('wedding') ||
    text.includes('bryllup')
  ) {
    return 'family'
  }

  return 'work'
}

/**
 * Sync all household ICS calendars (shared family calendars).
 */
async function syncAllHouseholdICSCalendars(
  supabase: AnySupabaseClient
): Promise<{
  householdsProcessed: number
  householdsSuccess: number
  eventsTotal: number
}> {
  const result = {
    householdsProcessed: 0,
    householdsSuccess: 0,
    eventsTotal: 0,
  }

  try {
    // Get all households with ICS URLs
    const { data: households, error: householdsError } = await supabase
      .from('households')
      .select('id, name, ics_calendar_url')
      .not('ics_calendar_url', 'is', null)

    if (householdsError || !households || households.length === 0) {
      console.log('[Cron] No households with ICS calendars')
      return result
    }

    result.householdsProcessed = households.length
    console.log(`[Cron] Found ${households.length} households with ICS calendars`)

    // Sync each household using shared utility
    for (const household of households) {
      try {
        const syncResult = await syncHouseholdICSShared(supabase, {
          id: household.id,
          name: household.name || 'Household',
          ics_calendar_url: household.ics_calendar_url,
        })
        if (syncResult.success) {
          result.householdsSuccess++
          result.eventsTotal += syncResult.eventsCount
        } else {
          console.error(`[Cron] Household ICS sync failed for ${household.name}:`, syncResult.error)
        }

        // Small delay between syncs to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch (error) {
        console.error(`[Cron] Household ICS sync failed for ${household.name}:`, error)
      }
    }

    return result
  } catch (error) {
    console.error('[Cron] Household ICS calendar sync error:', error)
    return result
  }
}
