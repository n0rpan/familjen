import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUserAdmin } from '@/lib/config'
import { MyKidClient, MyKidAuthError, MyKidError } from '@/lib/integrations/mykid'
import { addDays } from '@/lib/utils'
import { handleSyncSetup } from '@/lib/integrations/shared'
import sharp from 'sharp'

interface SyncResult {
  integrationId: string
  displayName: string
  success: boolean
  error?: string
  eventsCount: number
  messagesCount: number
  photosCount: number
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

    const { supabase, householdId, integrations, isAdmin } = setup

    // Sync each integration
    const results: SyncResult[] = []

    for (const integration of integrations) {
      const result = await syncIntegration(
        supabase,
        integration,
        householdId,
        isAdmin
      )
      results.push(result)
    }

    // Calculate totals
    const totalEvents = results.reduce((sum, r) => sum + r.eventsCount, 0)
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
        eventsTotal: totalEvents,
        messagesTotal: totalMessages,
        photosTotal: totalPhotos,
      },
    })
  } catch (error) {
    console.error('MyKid sync error:', error)
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 })
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
  isAdmin: boolean
): Promise<SyncResult> {
  const result: SyncResult = {
    integrationId: integration.id,
    displayName: integration.display_name,
    success: false,
    eventsCount: 0,
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

    // Calculate date range for events
    const now = new Date()
    const futureDate = addDays(now, 90) // 90 days ahead for calendar

    // ========================================================================
    // SYNC CALENDAR EVENTS (JSON API - easy!)
    // ========================================================================
    try {
      const events = await client.getCalendarEvents(now, futureDate)

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
        }
      }
    } catch (eventsError) {
      console.error('Error syncing calendar events:', eventsError)
    }

    // ========================================================================
    // SYNC NEWSLETTERS (HTML parsing)
    // ========================================================================
    try {
      const lastSync = integration.last_sync_at
        ? new Date(integration.last_sync_at)
        : addDays(now, -30) // Go back 30 days on first sync

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
    // SYNC PHOTOS (download during sync - IP lock workaround!)
    // ========================================================================
    try {
      // Get photos from /foto gallery (primary source)
      const photos = await client.getPhotosFromRecentDays(30)

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get integrations via RPC (handles RLS)
    const { data: integrations, error } = await supabase.rpc('get_household_integrations')

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 })
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
    console.error('MyKid sync status error:', error)
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 })
  }
}
