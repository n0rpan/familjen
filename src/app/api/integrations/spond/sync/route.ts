import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUserAdmin } from '@/lib/config'
import { SpondClient, SpondAuthError, SpondError } from '@/lib/integrations/spond'
import { ApiErrors, handleApiError } from '@/lib/api-errors'
import { addDays } from '@/lib/utils'
import { processMessagesWithAI } from '@/lib/integrations/ai-extraction'
import {
  handleSyncSetup,
  getMappingsForIntegrations,
  getSyncStartDate,
  HISTORICAL_SYNC_DAYS,
  FUTURE_SYNC_DAYS,
  type IntegrationMapping,
} from '@/lib/integrations/shared'
import {
  handleEventDeletionsAndChanges,
  sendNewEventNotification,
  type SyncedEvent,
} from '@/lib/integrations/shared/deletion-handler'

interface SyncResult {
  integrationId: string
  displayName: string
  success: boolean
  error?: string
  chatError?: string
  eventsCount: number
  messagesCount: number
  deletedEventsCount?: number
  modifiedEventsCount?: number
  newEventsCount?: number
}

/**
 * POST /api/integrations/spond/sync
 *
 * Sync events and messages from Spond for the user's household.
 * Can sync a specific integration or all integrations.
 */
export async function POST(request: Request) {
  try {
    // Common setup: CSRF, auth, rate limit, household check, get integrations
    const setup = await handleSyncSetup(request, {
      service: 'spond',
      rateLimitKey: 'spondSync',
    })

    if (!setup.success) {
      return setup.response
    }

    const { supabase, householdId, integrations, isAdmin, fullSync } = setup

    // Get all mappings (children and members) for this household
    const mappingsByIntegration = await getMappingsForIntegrations(
      supabase,
      integrations.map((i) => i.id)
    )

    // Sync each integration
    const results: SyncResult[] = []

    for (const integration of integrations) {
      // Filter out mappings without groupId and narrow the type
      const mappings = (mappingsByIntegration.get(integration.id) || [])
        .filter((m): m is typeof m & { groupId: string } => m.groupId !== null)
      const result = await syncIntegration(
        supabase,
        integration,
        mappings,
        householdId,
        isAdmin,
        fullSync
      )
      results.push(result)
    }

    // Calculate totals
    const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)
    const totalMessages = results.reduce((sum, r) => sum + r.messagesCount, 0)
    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length

    // Process messages with AI to extract suggestions
    // Only do this if we have new messages and at least one successful sync
    let aiExtractionResult = { processed: 0, suggestionsCreated: 0, errors: [] as string[] }
    if (totalMessages > 0 && successCount > 0) {
      try {
        // Process messages for the synced integrations
        const integrationIds = results.filter((r) => r.success).map((r) => r.integrationId)
        for (const intId of integrationIds) {
          const result = await processMessagesWithAI(supabase, householdId, intId, 50)
          aiExtractionResult.processed += result.processed
          aiExtractionResult.suggestionsCreated += result.suggestionsCreated
          aiExtractionResult.errors.push(...result.errors)
        }
      } catch (error) {
        console.error('AI extraction error during sync:', error)
        // Non-fatal - sync still succeeded
      }
    }

    // Collect chat errors for debugging
    const chatErrors = results.filter((r) => r.chatError).map((r) => r.chatError)

    return NextResponse.json({
      success: failureCount === 0,
      results: isAdmin ? results : results.map((r) => ({ ...r, error: r.error ? 'Sync failed' : undefined, chatError: undefined })),
      summary: {
        integrationsTotal: integrations.length,
        integrationsSuccess: successCount,
        integrationsFailed: failureCount,
        eventsTotal: totalEvents,
        messagesTotal: totalMessages,
        messagesProcessed: aiExtractionResult.processed,
        suggestionsCreated: aiExtractionResult.suggestionsCreated,
        chatErrors: isAdmin ? chatErrors : chatErrors.length > 0 ? ['Chat sync failed'] : [],
      },
    })
  } catch (error) {
    return handleApiError(error, 'spond sync')
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
  mappings: Array<{ childId: string | null; memberId: string | null; groupId: string }>,
  householdId: string,
  isAdmin: boolean,
  fullSync: boolean
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
    const mappedGroupIds = new Set(mappings.map((m) => m.groupId))

    // Calculate date ranges
    // On first sync or fullSync, go back 1 year for rich historical context
    const now = new Date()
    const isHistoricalSync = fullSync || !integration.last_sync_at
    const pastDate = isHistoricalSync
      ? addDays(now, -HISTORICAL_SYNC_DAYS)
      : addDays(now, -7) // Regular sync: include events from last 7 days
    const futureDate = addDays(now, FUTURE_SYNC_DAYS) // Full year ahead for long-term planning
    const lastSync = getSyncStartDate(integration.last_sync_at, fullSync)

    if (isHistoricalSync) {
      console.log(`[Spond] Historical sync: fetching ${HISTORICAL_SYNC_DAYS} days of data`)
    }

    // Fetch events - include recent past events for reference
    const events = await client.getEvents({
      includeScheduled: true,
      maxEvents: 200,
      minEndTimestamp: pastDate, // Include events from past 7 days
      maxStartTimestamp: futureDate,
    })

    // Filter to events from groups we care about and map to DB format
    const eventsToUpsert: Array<{
      integration_id: string
      child_id: string | null
      member_id: string | null
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

      // Find a matching mapping - check parent group and all subgroups
      // Can match to a child OR a member
      let matchedMapping: { childId: string | null; memberId: string | null; groupId: string } | undefined
      let matchedGroupId: string | undefined

      // First check if parent group matches
      if (parentGroupId) {
        matchedMapping = mappings.find((m) => m.groupId === parentGroupId)
        if (matchedMapping) {
          matchedGroupId = parentGroupId
        }
      }

      // If no parent match, check subgroups
      if (!matchedMapping && subGroupIds.length > 0) {
        for (const subGroupId of subGroupIds) {
          matchedMapping = mappings.find((m) => m.groupId === subGroupId)
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
        member_id: matchedMapping?.memberId || null,
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

    // Get existing event IDs to detect new events
    const { data: existingEventIds } = await supabase
      .from('external_events')
      .select('external_id')
      .eq('integration_id', integration.id)

    const existingIdSet = new Set(existingEventIds?.map(e => e.external_id) || [])

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

        // Send notifications for new events (not updates)
        const newEvents = eventsToUpsert.filter(e => !existingIdSet.has(e.external_id))
        result.newEventsCount = newEvents.length

        // Send push notifications for new future events (limit to avoid spam)
        const today = new Date().toISOString().split('T')[0]
        const futureNewEvents = newEvents
          .filter(e => e.event_date >= today)
          .slice(0, 3) // Limit to 3 notifications

        for (const event of futureNewEvents) {
          await sendNewEventNotification(
            supabase,
            householdId,
            'Spond',
            event.title,
            event.event_date
          )
        }
      }
    }

    // Handle deleted/modified events
    const syncedEvents: SyncedEvent[] = eventsToUpsert.map(e => ({
      external_id: e.external_id,
      title: e.title,
      event_date: e.event_date,
      event_time: e.event_time,
      end_date: e.end_date,
      location: e.location,
    }))

    const deletionResult = await handleEventDeletionsAndChanges(
      supabase,
      integration.id,
      householdId,
      syncedEvents,
      'Spond'
    )

    result.deletedEventsCount = deletionResult.deletedCount
    result.modifiedEventsCount = deletionResult.modifiedCount

    // Fetch chats and messages
    try {
      const chats = await client.getChats({ limit: 50 })

      const messagesToUpsert: Array<{
        integration_id: string
        child_id: string | null
        member_id: string | null
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
        // Check if this chat belongs to a mapped group (child or member)
        const groupId = chat.groupId
        const mapping = groupId
          ? mappings.find((m) => m.groupId === groupId)
          : null

        // Get messages for this chat
        const messages = await client.getChatMessages(chat.id, { limit: 50 })

        for (const message of messages) {
          // Skip messages with no text content
          if (!message.text) continue

          // Filter by date - only get messages since last sync
          const messageDate = new Date(message.timestamp)
          if (messageDate < lastSync) continue

          const mapped = SpondClient.mapMessageToDb(message, chat.id, groupId)

          // Detect personal chats (no groupId, or explicit 'personal' type)
          // Store chat metadata for UI to distinguish personal vs group messages
          const isPersonalChat = chat.type === 'personal' || (!groupId && chat.name)

          messagesToUpsert.push({
            integration_id: integration.id,
            child_id: mapping?.childId || null,
            member_id: mapping?.memberId || null,
            external_id: mapped.externalId,
            external_group_id: mapped.externalGroupId,
            chat_id: mapped.chatId,
            sender_name: mapped.senderName, // Keep original - don't use chat.name as fallback (it's semantically incorrect)
            title: mapped.title,
            body: mapped.body,
            message_date: mapped.messageDate,
            raw_data: {
              ...mapped.rawData,
              // Add chat metadata for UI display
              _chatName: chat.name,
              _chatType: isPersonalChat ? 'personal' : (chat.type || 'group'),
              _isPersonalChat: isPersonalChat,
            },
          })
        }
      }

      // Fetch posts (innlegg) from each mapped group and subgroups
      // First, fetch groups to get subgroup info
      const groups = await client.getGroups()
      const mappedGroups = groups.filter((g) => mappedGroupIds.has(g.id))

      for (const group of mappedGroups) {
        const mapping = mappings.find((m) => m.groupId === group.id)

        // Fetch posts for the main group
        try {
          const posts = await client.getPosts({ groupId: group.id, maxPosts: 50 })
          for (const post of posts) {
            const postDate = new Date(post.timestamp || post.createdTime || '')
            if (isNaN(postDate.getTime()) || postDate < lastSync) continue

            const mapped = SpondClient.mapPostToDb(post, group.id)
            messagesToUpsert.push({
              integration_id: integration.id,
              child_id: mapping?.childId || null,
              member_id: mapping?.memberId || null,
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
        } catch (postError) {
          console.error(`Error fetching posts for group ${group.id}:`, postError)
        }

        // Fetch posts from each subgroup
        if (group.subGroups && group.subGroups.length > 0) {
          for (const subGroup of group.subGroups) {
            try {
              const posts = await client.getPosts({
                groupId: group.id,
                subGroupId: subGroup.id,
                maxPosts: 50,
              })
              for (const post of posts) {
                const postDate = new Date(post.timestamp || post.createdTime || '')
                if (isNaN(postDate.getTime()) || postDate < lastSync) continue

                const mapped = SpondClient.mapPostToDb(post, group.id)
                // Add subgroup info to external_id to avoid duplicates
                mapped.externalId = `post_${(post as { id: string }).id}_sg_${subGroup.id}`
                messagesToUpsert.push({
                  integration_id: integration.id,
                  child_id: mapping?.childId || null,
                  member_id: mapping?.memberId || null,
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
            } catch (postError) {
              console.error(
                `Error fetching posts for subgroup ${subGroup.id} in group ${group.id}:`,
                postError
              )
            }
          }
        }
      }

      // Upsert messages (including posts)
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
      const chatErrorMsg = chatError instanceof Error ? chatError.message : String(chatError)
      console.error('Error syncing chats:', chatErrorMsg, chatError)
      result.chatError = chatErrorMsg
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
      return ApiErrors.unauthorized()
    }

    // Get integrations via RPC (handles RLS)
    const { data: integrations, error } = await supabase.rpc('get_household_integrations')

    if (error) {
      return ApiErrors.internal({ internalMessage: `Failed to fetch integrations: ${error.message}` })
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
    return handleApiError(error, 'spond sync status')
  }
}
