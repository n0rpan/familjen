import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUserAdmin } from '@/lib/config'
import { MyKidClient, MyKidAuthError, MyKidError } from '@/lib/integrations/mykid'
import { ApiErrors, handleApiError } from '@/lib/api-errors'
import { addDays } from '@/lib/utils'
import { handleSyncSetup, getSyncStartDate, HISTORICAL_SYNC_DAYS, FUTURE_SYNC_DAYS } from '@/lib/integrations/shared'
import {
  handleEventDeletionsAndChanges,
  sendNewEventNotification,
  type SyncedEvent,
} from '@/lib/integrations/shared/deletion-handler'
import { revalidateFeedCache } from '@/lib/data/server'
import sharp from 'sharp'

interface SyncResult {
  integrationId: string
  displayName: string
  success: boolean
  error?: string
  eventsCount: number
  messagesCount: number
  photosCount: number
  documentsCount: number
  deletedEventsCount?: number
  newEventsCount?: number
}

/**
 * POST /api/integrations/mykid/sync
 *
 * Sync calendar events, newsletters, and photos from MyKid for the user's household.
 */
export async function POST(request: Request) {
  try {
    // Common setup: CSRF, auth, rate limit, household check, get integrations
    const setup = await handleSyncSetup(request, {
      service: 'mykid',
      rateLimitKey: 'mykidSync',
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
    const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)
    const totalMessages = results.reduce((sum, r) => sum + r.messagesCount, 0)
    const totalPhotos = results.reduce((sum, r) => sum + r.photosCount, 0)
    const totalDocuments = results.reduce((sum, r) => sum + r.documentsCount, 0)
    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length

    // Revalidate feed cache so fresh data shows immediately
    revalidateFeedCache(householdId)

    return NextResponse.json({
      success: failureCount === 0,
      results: isAdmin ? results : results.map((r) => ({ ...r, error: r.error ? 'Sync failed' : undefined })),
      summary: {
        integrationsTotal: integrations.length,
        integrationsSuccess: successCount,
        integrationsFailed: failureCount,
        eventsTotal: totalEvents,
        messagesTotal: totalMessages,
        photosTotal: totalPhotos,
        documentsTotal: totalDocuments,
      },
    })
  } catch (error) {
    return handleApiError(error, 'mykid sync')
  }
}

/**
 * Sync a single MyKid integration.
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
    eventsCount: 0,
    messagesCount: 0,
    photosCount: 0,
    documentsCount: 0,
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

    const { phone, password } = credentials as {
      phone: string
      password: string
    }

    // Create MyKid client and login
    const client = new MyKidClient()

    try {
      await client.login(phone, password)
    } catch (error) {
      if (error instanceof MyKidAuthError) {
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

    // Calculate date ranges
    const now = new Date()
    const futureDate = addDays(now, FUTURE_SYNC_DAYS) // Full year ahead for long-term planning
    const isHistoricalSync = fullSync || !integration.last_sync_at

    if (isHistoricalSync) {
      console.log(`[MyKid] Historical sync: fetching ${HISTORICAL_SYNC_DAYS} days of data`)
    }

    // ========================================================================
    // SYNC CALENDAR EVENTS (JSON API - easy!)
    // ========================================================================
    try {
      const events = await client.getCalendarEvents(now, futureDate)

      // Get existing event IDs to detect new events
      const { data: existingEventIds } = await supabase
        .from('external_events')
        .select('external_id')
        .eq('integration_id', integration.id)

      const existingIdSet = new Set(existingEventIds?.map(e => e.external_id) || [])

      const eventsToUpsert = events.map((event) => ({
        integration_id: integration.id,
        child_id: null, // MyKid events are for all children
        external_id: event.id,
        external_group_id: null,
        title: event.title,
        description: event.description || null,
        event_date: event.event_at,
        event_time: null, // All-day events typically
        end_date: event.event_until || null,
        end_time: null,
        event_type: event.class || 'event', // 'birthday', 'event', etc.
        raw_data: event,
      }))

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

          // Send notifications for new events
          const newEvents = eventsToUpsert.filter(e => !existingIdSet.has(e.external_id))
          result.newEventsCount = newEvents.length

          // Send push notifications for new future events (limit to avoid spam)
          const today = new Date().toISOString().split('T')[0]
          const futureNewEvents = newEvents.filter(e => e.event_date >= today).slice(0, 3)
          for (const event of futureNewEvents) {
            await sendNewEventNotification(supabase, householdId, 'MyKid', event.title, event.event_date)
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
        location: null,
      }))

      const deletionResult = await handleEventDeletionsAndChanges(
        supabase,
        integration.id,
        householdId,
        syncedEvents,
        'MyKid'
      )

      result.deletedEventsCount = deletionResult.deletedCount
    } catch (eventsError) {
      console.error('Error syncing calendar events:', eventsError)
    }

    // ========================================================================
    // SYNC NEWSLETTERS (HTML parsing)
    // ========================================================================
    try {
      // Use historical sync date for first sync or fullSync
      const lastSync = getSyncStartDate(integration.last_sync_at, fullSync)

      const newsletters = await client.getNewsletterList()

      // Limit to recent 50 newsletters
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

      for (const summary of newsletters.slice(0, 50)) {
        // Check if we already have this newsletter
        const { data: existing } = await supabase
          .from('external_messages')
          .select('id')
          .eq('integration_id', integration.id)
          .eq('external_id', `newsletter_${summary.id}`)
          .single()

        if (!existing) {
          // Fetch full content
          try {
            const full = await client.getNewsletterContent(summary.id)
            const messageDate = MyKidClient.parseNorwegianDate(full.date) || new Date()

            messagesToUpsert.push({
              integration_id: integration.id,
              child_id: null,
              external_id: `newsletter_${summary.id}`,
              external_group_id: null,
              chat_id: null,
              sender_name: null,
              title: full.title,
              body: full.content,
              message_date: messageDate.toISOString(),
              source_type: 'newsletter',
              raw_data: full,
            })

            // Small delay between newsletter fetches
            await new Promise(resolve => setTimeout(resolve, 100))
          } catch (contentError) {
            console.error(`Error fetching newsletter ${summary.id}:`, contentError)
          }
        }
      }

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
    } catch (messagesError) {
      console.error('Error syncing newsletters:', messagesError)
    }

    // ========================================================================
    // SYNC NEWSLETTER ATTACHMENTS (PDFs, documents)
    // ========================================================================
    try {
      // Get all newsletters with attachments that haven't been downloaded yet
      const { data: messagesWithAttachments } = await supabase
        .from('external_messages')
        .select('id, external_id, raw_data')
        .eq('integration_id', integration.id)
        .eq('source_type', 'newsletter')

      let documentsCount = 0

      for (const message of messagesWithAttachments || []) {
        const rawData = message.raw_data as { attachments?: Array<{ id: number; filename: string; url: string }> }
        const attachments = rawData?.attachments || []

        for (const attachment of attachments) {
          try {
            // Check if we already have this document
            const externalId = `attachment_${attachment.id}`
            const { data: existing } = await supabase
              .from('external_documents')
              .select('id')
              .eq('integration_id', integration.id)
              .eq('external_id', externalId)
              .single()

            if (existing) {
              // Already downloaded
              continue
            }

            // Download the attachment
            const { buffer, contentType, filename } = await client.downloadAttachment(attachment.url)

            // Generate storage path
            const safeFilename = (filename || attachment.filename || `doc_${attachment.id}`).replace(/[^a-zA-Z0-9._-]/g, '_')
            const storagePath = `${householdId}/${integration.id}/${safeFilename}`

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
              .from('external-documents')
              .upload(storagePath, buffer, {
                contentType,
                upsert: true,
              })

            if (uploadError) {
              console.error(`Failed to upload attachment ${attachment.id}:`, uploadError)
              continue
            }

            // Insert document record
            const { error: dbError } = await supabase
              .from('external_documents')
              .insert({
                household_id: householdId,
                integration_id: integration.id,
                external_id: externalId,
                source_type: 'mykid_attachment',
                source_url: attachment.url,
                title: attachment.filename || null,
                filename: safeFilename,
                mime_type: contentType,
                storage_path: storagePath,
                file_size: buffer.length,
                ai_processed: false,
                raw_data: attachment,
              })

            if (dbError) {
              console.error(`Failed to save document ${attachment.id}:`, dbError)
            } else {
              documentsCount++
            }

            // Small delay between downloads
            await new Promise(resolve => setTimeout(resolve, 200))

          } catch (attachError) {
            console.error(`Error processing attachment ${attachment.id}:`, attachError)
          }
        }
      }

      result.documentsCount = documentsCount
    } catch (attachError) {
      console.error('Error syncing attachments:', attachError)
    }

    // ========================================================================
    // SYNC PHOTOS (download during sync - IP lock workaround!)
    // ========================================================================
    try {
      // Get photos from /foto gallery (primary source)
      // On first sync or fullSync, go back 1 year for photos
      const photoDays = isHistoricalSync ? HISTORICAL_SYNC_DAYS : 30
      const photos = await client.getPhotosFromRecentDays(photoDays)

      if (photos.length > 0) {
        let uploadedCount = 0
        const maxPhotos = 50 // Increased limit per sync

        for (const photo of photos.slice(0, maxPhotos)) {
          try {
            // Check if we already have this photo
            const { data: existing } = await supabase
              .from('external_photos')
              .select('id, storage_path')
              .eq('integration_id', integration.id)
              .eq('external_id', photo.photoId)
              .single()

            if (existing && !existing.storage_path.startsWith('pending/')) {
              // Already downloaded, skip
              continue
            }

            // Download the photo (MUST be same IP as login due to JWT IP validation!)
            const { buffer, contentType } = await client.downloadPhoto(photo.url)

            // Compress with sharp (max 1200px width, JPEG quality 80)
            const compressed = await sharp(buffer)
              .resize(1200, null, { withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer()

            // Get image metadata
            const metadata = await sharp(compressed).metadata()

            // Generate storage path
            const storagePath = `${householdId}/${integration.id}/${photo.photoId.replace(/[^a-zA-Z0-9._-]/g, '_')}.jpg`

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
              .from('external-photos')
              .upload(storagePath, compressed, {
                contentType: 'image/jpeg',
                upsert: true,
              })

            if (uploadError) {
              console.error(`Failed to upload photo ${photo.photoId}:`, uploadError)
              continue
            }

            // Upsert photo record with actual storage path
            const expiresAt = addDays(new Date(), 365).toISOString() // 1 year retention

            const { error: dbError } = await supabase
              .from('external_photos')
              .upsert({
                integration_id: integration.id,
                child_id: null,
                external_id: photo.photoId,
                title: null,
                taken_at: photo.date ? new Date(photo.date).toISOString() : new Date().toISOString(),
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
              console.error(`Failed to save photo ${photo.photoId}:`, dbError)
            } else {
              uploadedCount++
            }

            // Small delay between photos to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200))

          } catch (photoError) {
            console.error(`Error processing photo ${photo.photoId}:`, photoError)
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
    const errorMessage = error instanceof MyKidError ? error.message : 'Unknown error'
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
 * GET /api/integrations/mykid/sync
 *
 * Get sync status for all MyKid integrations.
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
      return ApiErrors.internal({ internalMessage: 'Failed to fetch integrations' })
    }

    // Filter to MyKid only
    const mykidIntegrations = (integrations || []).filter(
      (i: { service: string }) => i.service === 'mykid'
    )

    const isAdmin = isUserAdmin(user)

    // Transform to camelCase for UI consistency
    return NextResponse.json({
      integrations: mykidIntegrations?.map((i: {
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
    return handleApiError(error, 'mykid sync status')
  }
}
