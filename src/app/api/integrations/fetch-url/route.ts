import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncCalendarSource, generateEventHash, type CalendarSource } from '@/lib/integrations/calendar-source-sync'
import { deduplicateEvents } from '@/lib/integrations/event-deduplication'
import { validateOrigin } from '@/lib/config'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { isUrlAllowed } from '@/lib/sanitize'
import { parseICSContent } from '@/lib/ics-parser'
import { formatDateISO } from '@/lib/utils'
import { getModel } from '@/lib/ai-models'
import { ApiErrors, handleApiError } from '@/lib/api-errors'
import { revalidateHouseholdCache } from '@/lib/data/server'

/**
 * POST /api/integrations/fetch-url
 *
 * Fetch content from a manual source URL and process it.
 */
export async function POST(request: Request) {
  // CSRF protection
  if (!validateOrigin(request)) {
    return ApiErrors.invalidOrigin()
  }

  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return ApiErrors.unauthorized()
    }

    // Rate limiting
    const rateLimitKey = createRateLimitKey(user.id, 'urlFetch')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.urlFetch)
    if (rateLimit.limited) {
      return ApiErrors.rateLimit(rateLimit.retryAfter)
    }

    // Get user's household
    const { data: member } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!member) {
      return ApiErrors.noHousehold()
    }

    const body = await request.json()
    const { sourceUrlId } = body

    if (!sourceUrlId) {
      return ApiErrors.validation('Kilde-URL-ID er påkrevd')
    }

    // Get the source URL record
    const { data: sourceUrl, error: fetchError } = await supabase
      .from('external_source_urls')
      .select('*')
      .eq('id', sourceUrlId)
      .eq('household_id', member.household_id)
      .single()

    if (fetchError || !sourceUrl) {
      return ApiErrors.notFound('Kilden')
    }

    // SSRF protection - validate URL before fetching
    if (!isUrlAllowed(sourceUrl.url)) {
      return ApiErrors.validation('URL ikke tillatt')
    }

    // Fetch the content based on type
    let content: string | null = null
    let mimeType = 'text/html'

    try {
      const response = await fetch(sourceUrl.url, {
        headers: {
          'User-Agent': 'FamiljenBot/1.0 (https://familjen.eu)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/calendar,application/pdf,*/*;q=0.8',
          'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const contentType = response.headers.get('content-type') || ''
      mimeType = contentType.split(';')[0].trim()

      if (sourceUrl.url_type === 'ics' || contentType.includes('text/calendar')) {
        // ICS calendar - parse and create events directly
        content = await response.text()

        // Parse ICS content (1 year back, 1 year forward)
        const now = new Date()
        const startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
        const endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())

        const icsEvents = parseICSContent(content, startDate, endDate)
        console.log(`[ICS Sync] Parsed ${icsEvents.length} events from ${sourceUrl.display_name}`)

        // Get existing events for this source
        const { data: existingEvents } = await supabase
          .from('external_events')
          .select('id, source_event_hash')
          .eq('source_url_id', sourceUrl.id)

        const existingByHash = new Map<string, string>()
        for (const event of existingEvents || []) {
          if (event.source_event_hash) {
            existingByHash.set(event.source_event_hash, event.id)
          }
        }

        // Track stats
        let eventsCreated = 0
        let eventsUpdated = 0
        const processedHashes = new Set<string>()
        const newEventIds: string[] = []

        // Upsert events
        for (const icsEvent of icsEvents) {
          const eventDate = formatDateISO(icsEvent.startDate)
          const hash = generateEventHash(sourceUrl.id, eventDate, icsEvent.summary)
          processedHashes.add(hash)

          const eventData = {
            source_url_id: sourceUrl.id,
            source_event_hash: hash,
            external_id: icsEvent.uid,
            title: icsEvent.summary.slice(0, 200),
            event_date: eventDate,
            end_date: icsEvent.isAllDay && icsEvent.endDate
              ? formatDateISO(new Date(icsEvent.endDate.getTime() - 24 * 60 * 60 * 1000)) // All-day end is exclusive
              : formatDateISO(icsEvent.endDate),
            event_time: icsEvent.isAllDay ? null : icsEvent.startDate.toTimeString().slice(0, 5),
            event_type: 'event',
            description: icsEvent.description?.slice(0, 2000) || null,
            child_id: sourceUrl.child_id,
            raw_data: { uid: icsEvent.uid, location: icsEvent.location, busyStatus: icsEvent.busyStatus },
          }

          const existingId = existingByHash.get(hash)
          if (existingId) {
            await supabase.from('external_events').update(eventData).eq('id', existingId)
            eventsUpdated++
          } else {
            const { data: insertedEvent } = await supabase
              .from('external_events')
              .insert(eventData)
              .select('id')
              .single()
            if (insertedEvent) {
              eventsCreated++
              newEventIds.push(insertedEvent.id)
            }
          }
        }

        // Remove events that no longer exist in ICS
        let eventsRemoved = 0
        const today = formatDateISO(new Date())
        for (const [hash, eventId] of existingByHash) {
          if (!processedHashes.has(hash)) {
            // Only remove future events
            const { data: event } = await supabase
              .from('external_events')
              .select('event_date')
              .eq('id', eventId)
              .single()

            if (event && event.event_date >= today) {
              await supabase.from('external_events').delete().eq('id', eventId)
              eventsRemoved++
            }
          }
        }

        // Update sync status
        await supabase
          .from('external_source_urls')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: 'ok',
            last_sync_error: null,
          })
          .eq('id', sourceUrl.id)

        // Run deduplication on newly created events
        let duplicatesAutoMerged = 0
        let duplicateSuggestionsCreated = 0
        if (newEventIds.length > 0) {
          const dedupeResult = await deduplicateEvents(supabase, member.household_id, newEventIds)
          duplicatesAutoMerged = dedupeResult.autoMerged
          duplicateSuggestionsCreated = dedupeResult.suggestionsCreated
        }

        // Revalidate all household caches so fresh data shows on feed and week pages
        revalidateHouseholdCache(member.household_id)

        return NextResponse.json({
          success: true,
          eventsFound: icsEvents.length,
          eventsCreated,
          eventsUpdated,
          eventsRemoved,
          duplicatesAutoMerged,
          duplicateSuggestionsCreated,
          message: `ICS synkronisert: ${icsEvents.length} hendelser funnet`,
        })
      } else if (sourceUrl.url_type === 'pdf' || contentType.includes('application/pdf')) {
        // PDF document - store for AI processing
        const buffer = Buffer.from(await response.arrayBuffer())

        // Generate storage path
        const filename = `source_${sourceUrl.id}_${Date.now()}.pdf`
        const storagePath = `${member.household_id}/manual/${filename}`

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('external-documents')
          .upload(storagePath, buffer, {
            contentType: 'application/pdf',
            upsert: true,
          })

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`)
        }

        // Create document record
        const { error: docError } = await supabase
          .from('external_documents')
          .upsert({
            household_id: member.household_id,
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

        if (docError) {
          console.error('PDF document record error:', docError)
          throw new Error(`Document record failed: ${docError.message}`)
        }

        // Update sync status
        await supabase
          .from('external_source_urls')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: 'ok',
            last_sync_error: null,
          })
          .eq('id', sourceUrl.id)

        return NextResponse.json({
          success: true,
          message: 'PDF lastet opp - vil bli behandlet',
        })
      }
      // If we reach here, it's HTML - fall through to calendar source sync
    } catch (fetchErr) {
      // For ICS/PDF failures, update status and return error
      await supabase
        .from('external_source_urls')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_error: fetchErr instanceof Error ? fetchErr.message : 'Unknown error',
        })
        .eq('id', sourceUrl.id)

      return ApiErrors.internal({ internalMessage: fetchErr instanceof Error ? fetchErr.message : 'Unknown error' })
    }

    // For HTML/calendar_page: Use the new sync function with proper event tracking
    // Get AI vision model from settings with env fallback
    const model = await getModel(supabase, 'vision')

    // Build the CalendarSource object
    const calendarSource: CalendarSource = {
      id: sourceUrl.id,
      household_id: member.household_id,
      url: sourceUrl.url,
      display_name: sourceUrl.display_name,
      url_type: sourceUrl.url_type,
      child_id: sourceUrl.child_id,
      auto_sync: sourceUrl.auto_sync,
      last_sync_at: sourceUrl.last_sync_at,
    }

    // Run the sync with proper event tracking
    const syncResult = await syncCalendarSource(supabase, calendarSource, { model })

    if (!syncResult.success) {
      return ApiErrors.internal({ internalMessage: syncResult.error || 'Synkronisering feilet' })
    }

    // Build response message
    const parts: string[] = []
    if (syncResult.eventsFound > 0) {
      parts.push(`${syncResult.eventsFound} hendelser funnet`)
    }
    if (syncResult.eventsCreated > 0) {
      parts.push(`${syncResult.eventsCreated} nye`)
    }
    if (syncResult.eventsUpdated > 0) {
      parts.push(`${syncResult.eventsUpdated} oppdatert`)
    }
    if (syncResult.eventsRemoved > 0) {
      parts.push(`${syncResult.eventsRemoved} fjernet`)
    }

    // Revalidate all household caches so fresh data shows on feed and week pages
    revalidateHouseholdCache(member.household_id)

    return NextResponse.json({
      ...syncResult,
      message: parts.length > 0 ? `Synkronisert: ${parts.join(', ')}` : 'Synkronisert - ingen hendelser funnet',
      debug: {
        ...syncResult.debug,
        sourceUrl: sourceUrl.url,
        urlType: sourceUrl.url_type,
        model,
      },
    })

  } catch (error) {
    return handleApiError(error, 'fetch url')
  }
}

/**
 * GET /api/integrations/fetch-url
 *
 * List all source URLs for the user's household.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return ApiErrors.unauthorized()
    }

    // Get user's household
    const { data: member } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!member) {
      return ApiErrors.noHousehold()
    }

    // Get all source URLs
    const { data: sourceUrls, error } = await supabase
      .from('external_source_urls')
      .select('*')
      .eq('household_id', member.household_id)
      .order('created_at', { ascending: false })

    if (error) {
      return ApiErrors.internal({ internalMessage: 'Failed to fetch source URLs' })
    }

    return NextResponse.json({ sourceUrls })

  } catch (error) {
    return handleApiError(error, 'get source urls')
  }
}

/**
 * DELETE /api/integrations/fetch-url
 *
 * Delete a source URL.
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return ApiErrors.unauthorized()
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return ApiErrors.validation('ID er påkrevd')
    }

    // Delete is handled by RLS - only household members can delete their own URLs
    const { error } = await supabase
      .from('external_source_urls')
      .delete()
      .eq('id', id)

    if (error) {
      return ApiErrors.internal({ internalMessage: 'Failed to delete source URL' })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    return handleApiError(error, 'delete source url')
  }
}
