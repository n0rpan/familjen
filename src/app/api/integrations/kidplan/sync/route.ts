import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUserAdmin } from '@/lib/config'
import { KidplanClient, KidplanAuthError, KidplanError } from '@/lib/integrations/kidplan'
import { addDays } from '@/lib/utils'
import { handleSyncSetup, getSyncStartDate, HISTORICAL_SYNC_DAYS } from '@/lib/integrations/shared'
import sharp from 'sharp'

interface SyncResult {
  integrationId: string
  displayName: string
  success: boolean
  error?: string
  messagesCount: number
  photosCount: number
}

/**
 * POST /api/integrations/kidplan/sync
 *
 * Sync board posts, conversations, and photos from Kidplan for the user's household.
 */
export async function POST(request: Request) {
  try {
    // Common setup: CSRF, auth, rate limit, household check, get integrations
    const setup = await handleSyncSetup(request, {
      service: 'kidplan',
      rateLimitKey: 'kidplanSync',
    })

    if (!setup.success) {
      return setup.response
    }

    const { supabase, householdId, integrations, isAdmin, fullSync } = setup

    // Sync each integration
    const results: SyncResult[] = []

    for (const integration of integrations) {
      const result = await syncIntegration(
        supabase,
        integration,
        householdId,
        isAdmin,
        fullSync
      )
      results.push(result)
    }

    // Calculate totals
    const totalMessages = results.reduce((sum, r) => sum + r.messagesCount, 0)
    const totalPhotos = results.reduce((sum, r) => sum + r.photosCount, 0)
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
        photosTotal: totalPhotos,
      },
    })
  } catch (error) {
    console.error('Kidplan sync error:', error)
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 })
  }
}

/**
 * Sync a single Kidplan integration.
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
  isAdmin: boolean,
  fullSync: boolean
): Promise<SyncResult> {
  const result: SyncResult = {
    integrationId: integration.id,
    displayName: integration.display_name,
    success: false,
    messagesCount: 0,
    photosCount: 0,
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

    const { email, password, kindergartenId } = credentials as {
      email: string
      password: string
      kindergartenId?: number
    }

    // Create Kidplan client and login
    const client = new KidplanClient()

    try {
      await client.login(email, password, kindergartenId)
    } catch (error) {
      if (error instanceof KidplanAuthError) {
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

    // Fetch children from Kidplan API to see units
    try {
      const childrenData = await client.getChildren()
      console.log(`[Kidplan] Children from API:`, childrenData.ChildList.map(c => ({
        id: c.ChildId,
        name: c.Name,
        unitName: c.unitName,
      })))
    } catch (childError) {
      console.error('[Kidplan] Error fetching children:', childError)
    }

    // Get children for mapping
    const { data: childMappings } = await supabase
      .from('external_integration_children')
      .select('child_id, external_group_id')
      .eq('integration_id', integration.id)

    // Build a map of external child IDs to our child IDs
    const childIdMap = new Map<string, string>()
    childMappings?.forEach((m) => {
      if (m.external_group_id && m.child_id) {
        childIdMap.set(m.external_group_id, m.child_id)
      }
    })

    // Calculate date range for messages
    // On first sync or fullSync, go back 1 year for rich historical context
    const isHistoricalSync = fullSync || !integration.last_sync_at
    const lastSync = getSyncStartDate(integration.last_sync_at, fullSync)

    if (isHistoricalSync) {
      console.log(`[Kidplan] Historical sync: fetching ${HISTORICAL_SYNC_DAYS} days of data`)
    }
    console.log(`[Kidplan] Message sync window: ${lastSync.toISOString()} to now`)

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

    // Fetch board posts
    try {
      const boardData = await client.getBoardPosts()
      const totalBoardPosts = boardData.BoardPosts?.length || 0
      const totalLatestPictures = boardData.LatestPictures?.length || 0

      // Log full board response metadata for debugging
      console.log(`[Kidplan] Board response:`, {
        boardPosts: totalBoardPosts,
        latestPictures: totalLatestPictures,
        morePostsAvailable: boardData.MorePostsAvaliable,
        oldestItemDate: boardData.OldestItemDate,
        lastSeenDateTime: boardData.LastSeenDateTime,
        userIsEmployee: boardData.UserIsEmployee,
        unitsForCurrentUser: boardData.UnitsForCurrentUser,
      })
      console.log(`[Kidplan] Board posts received: ${totalBoardPosts}`)

      let boardPostsFiltered = 0
      let boardPostsAdded = 0

      for (const post of boardData.BoardPosts || []) {
        const postDate = KidplanClient.parseMicrosoftDate(post.Created)
        if (!postDate) {
          console.log(`[Kidplan] Board post ${post.PostId} has invalid date: ${post.Created}`)
          boardPostsFiltered++
          continue
        }
        if (postDate < lastSync) {
          boardPostsFiltered++
          continue
        }

        messagesToUpsert.push({
          integration_id: integration.id,
          child_id: null, // Board posts are for all children
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
        boardPostsAdded++
      }

      console.log(`[Kidplan] Board posts: ${boardPostsAdded} added, ${boardPostsFiltered} filtered (older than ${lastSync.toISOString()})`)
    } catch (boardError) {
      console.error('Error fetching board posts:', boardError)
    }

    // Fetch conversations with pagination
    try {
      const PAGE_SIZE = 50 // Fetch more per page
      const MAX_PAGES = isHistoricalSync ? 20 : 5 // More pages for historical sync
      let allConversations: Awaited<ReturnType<typeof client.getConversations>> = []
      let page = 0
      let hasMore = true

      // Paginate through conversations
      while (hasMore && page < MAX_PAGES) {
        const conversations = await client.getConversations(PAGE_SIZE, page * PAGE_SIZE)
        console.log(`[Kidplan] Conversations page ${page + 1}: ${conversations.length} items`)

        if (conversations.length === 0) {
          hasMore = false
        } else {
          allConversations = [...allConversations, ...conversations]
          if (conversations.length < PAGE_SIZE) {
            hasMore = false // Last page
          }
          page++
        }
      }

      console.log(`[Kidplan] Total conversations fetched: ${allConversations.length}`)

      let conversationMessagesAdded = 0
      let conversationMessagesFiltered = 0

      for (const conv of allConversations) {
        // Get messages for each conversation (also with pagination)
        try {
          let allMessages: Awaited<ReturnType<typeof client.getMessages>> = []
          let msgPage = 0
          let msgHasMore = true
          const MSG_PAGE_SIZE = 50
          const MSG_MAX_PAGES = isHistoricalSync ? 10 : 2

          while (msgHasMore && msgPage < MSG_MAX_PAGES) {
            const messagesResponse = await client.getMessages(conv.ConversationId, MSG_PAGE_SIZE, msgPage * MSG_PAGE_SIZE)
            const messages = Array.isArray(messagesResponse) ? messagesResponse : []

            if (messages.length === 0) {
              msgHasMore = false
            } else {
              allMessages = [...allMessages, ...messages]
              if (messages.length < MSG_PAGE_SIZE) {
                msgHasMore = false
              }
              msgPage++
            }
          }

          for (const msg of allMessages) {
            const msgDate = KidplanClient.parseMicrosoftDate(msg.Created)
            if (!msgDate) {
              console.log(`[Kidplan] Message ${msg.MessageId} has invalid date: ${msg.Created}`)
              conversationMessagesFiltered++
              continue
            }
            if (msgDate < lastSync) {
              conversationMessagesFiltered++
              continue
            }

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
            conversationMessagesAdded++
          }
        } catch (msgError) {
          console.error(`Error fetching messages for conversation ${conv.ConversationId}:`, msgError)
        }
      }

      console.log(`[Kidplan] Conversation messages: ${conversationMessagesAdded} added, ${conversationMessagesFiltered} filtered`)
    } catch (convError) {
      console.error('Error fetching conversations:', convError)
    }

    // Upsert messages
    console.log(`[Kidplan] Total messages to upsert: ${messagesToUpsert.length}`)

    if (messagesToUpsert.length > 0) {
      const { data: upsertedData, error: messagesError } = await supabase
        .from('external_messages')
        .upsert(messagesToUpsert, {
          onConflict: 'integration_id,external_id',
          ignoreDuplicates: false,
        })
        .select('id')

      if (messagesError) {
        console.error('[Kidplan] Error upserting messages:', messagesError)
        console.error('[Kidplan] Error details:', {
          code: messagesError.code,
          message: messagesError.message,
          details: messagesError.details,
          hint: messagesError.hint,
        })
        // Try inserting one by one to find the problematic message
        if (messagesError.code === '42703') { // undefined_column
          console.error('[Kidplan] Column error - check if source_type column exists in external_messages table')
        }
      } else {
        result.messagesCount = upsertedData?.length ?? messagesToUpsert.length
        console.log(`[Kidplan] Successfully upserted ${result.messagesCount} messages`)
      }
    } else {
      console.log('[Kidplan] No messages to upsert')
    }

    // Fetch, download, compress, and store photos
    try {
      // Get photos with download tokens from the HTML page
      const photos = await client.getLatestPhotos()

      if (photos.length > 0) {
        let uploadedCount = 0

        for (const photo of photos) {
          try {
            // Check if we already have this photo (skip if storage_path is not pending)
            const { data: existing } = await supabase
              .from('external_photos')
              .select('id, storage_path')
              .eq('integration_id', integration.id)
              .eq('external_id', photo.id)
              .single()

            if (existing && !existing.storage_path.startsWith('pending/')) {
              // Already downloaded, skip
              continue
            }

            // Download the photo
            const { buffer, contentType } = await client.fetchPhoto(photo.fullUrl)

            // Compress with sharp (max 1200px width, JPEG quality 80)
            const compressed = await sharp(buffer)
              .resize(1200, null, { withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer()

            // Get image metadata
            const metadata = await sharp(compressed).metadata()

            // Generate storage path
            const storagePath = `${householdId}/${integration.id}/${photo.id}.jpg`

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
              .from('external-photos')
              .upload(storagePath, compressed, {
                contentType: 'image/jpeg',
                upsert: true,
              })

            if (uploadError) {
              console.error(`Failed to upload photo ${photo.id}:`, uploadError)
              continue
            }

            // Upsert photo record with actual storage path
            const expiresAt = addDays(new Date(), 365).toISOString() // 1 year retention

            const { error: dbError } = await supabase
              .from('external_photos')
              .upsert({
                integration_id: integration.id,
                child_id: null,
                external_id: photo.id,
                title: photo.albumName || null,
                taken_at: new Date().toISOString(), // Best guess since not in token URL
                storage_path: storagePath,
                width: metadata.width,
                height: metadata.height,
                file_size: compressed.length,
                expires_at: expiresAt,
                raw_data: photo,
              }, {
                onConflict: 'integration_id,external_id',
                ignoreDuplicates: false,
              })

            if (dbError) {
              console.error(`Failed to save photo ${photo.id}:`, dbError)
            } else {
              uploadedCount++
            }

            // Small delay between photos to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200))

          } catch (photoError) {
            console.error(`Error processing photo ${photo.id}:`, photoError)
            // Continue with next photo
          }
        }

        result.photosCount = uploadedCount
      }
    } catch (photoError) {
      console.error('Error syncing photos:', photoError)
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
    const errorMessage = error instanceof KidplanError ? error.message : 'Unknown error'
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
 * GET /api/integrations/kidplan/sync
 *
 * Get sync status for all Kidplan integrations.
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

    // Filter to Kidplan only
    const kidplanIntegrations = integrations?.filter(
      (i: { service: string }) => i.service === 'kidplan'
    )

    const isAdmin = isUserAdmin(user)

    return NextResponse.json({
      integrations: kidplanIntegrations?.map((i: {
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
