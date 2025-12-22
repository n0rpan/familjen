import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractEventsFromHtml } from '@/lib/integrations/document-extraction'

/**
 * POST /api/integrations/fetch-url
 *
 * Fetch content from a manual source URL and process it.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 })
    }

    // Get user's household
    const { data: member } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!member) {
      return NextResponse.json({ error: 'Ingen husstand funnet' }, { status: 404 })
    }

    const body = await request.json()
    const { sourceUrlId } = body

    if (!sourceUrlId) {
      return NextResponse.json({ error: 'sourceUrlId mangler' }, { status: 400 })
    }

    // Get the source URL record
    const { data: sourceUrl, error: fetchError } = await supabase
      .from('external_source_urls')
      .select('*')
      .eq('id', sourceUrlId)
      .eq('household_id', member.household_id)
      .single()

    if (fetchError || !sourceUrl) {
      return NextResponse.json({ error: 'Kilde ikke funnet' }, { status: 404 })
    }

    // Fetch the content based on type
    let content: string | null = null
    let mimeType = 'text/html'

    try {
      const response = await fetch(sourceUrl.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FamiljenBot/1.0)',
          'Accept': 'text/html,application/pdf,text/calendar,*/*',
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
        // TODO: Parse ICS and create external_events
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
        await supabase
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

        content = null // PDF content will be processed by AI later
      } else {
        // HTML page - store and process immediately
        content = await response.text()

        // Create document record for HTML content (truncate to 500KB for DB storage)
        const truncatedContent = content.slice(0, 500000)

        const { data: docRecord } = await supabase
          .from('external_documents')
          .upsert({
            household_id: member.household_id,
            source_url_id: sourceUrl.id,
            external_id: `manual_${sourceUrl.id}`,
            source_type: 'manual_url',
            source_url: sourceUrl.url,
            title: sourceUrl.display_name,
            filename: null,
            mime_type: 'text/html',
            storage_path: null, // Content stored in extracted_text
            file_size: content.length,
            extracted_text: truncatedContent,
            ai_processed: false,
            child_id: sourceUrl.child_id,
          }, {
            onConflict: 'source_url_id',
          })
          .select('id')
          .single()

        // Process immediately with AI to extract events
        let eventsFound = 0
        if (docRecord) {
          try {
            // Get vision model setting
            const { data: modelSetting } = await supabase
              .from('app_settings')
              .select('value')
              .eq('key', 'openrouter_vision_model')
              .single()

            const model = modelSetting?.value || 'google/gemini-2.0-flash-001'

            // Extract events from HTML
            const events = await extractEventsFromHtml(truncatedContent, {
              childName: undefined, // Could look up child name from child_id
              schoolName: sourceUrl.display_name,
              model,
            })

            eventsFound = events.length

            // Create suggestions from extracted events
            for (const event of events) {
              await supabase
                .from('external_suggestions')
                .insert({
                  household_id: member.household_id,
                  child_id: sourceUrl.child_id,
                  source_type: 'external_document',
                  source_document_id: docRecord.id,
                  suggestion_type: event.eventType === 'holiday' || event.eventType === 'closure' ? 'event' : 'task',
                  title: event.title,
                  suggested_date: event.date,
                  suggested_end_date: event.endDate,
                  raw_data: event,
                  status: 'pending',
                })
            }

            // Mark document as processed
            await supabase
              .from('external_documents')
              .update({
                ai_processed: true,
                ai_processed_at: new Date().toISOString(),
              })
              .eq('id', docRecord.id)

          } catch (aiError) {
            console.error('AI extraction error:', aiError)
            // Don't fail the request, just log - cron will retry later
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

        return NextResponse.json({
          success: true,
          message: eventsFound > 0 ? `Synkronisert - ${eventsFound} hendelser funnet` : 'Synkronisert',
          eventsFound,
        })
      }

      // Update sync status (for PDF/ICS)
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
        message: 'Synkronisert',
      })

    } catch (fetchErr) {
      // Update sync status with error
      await supabase
        .from('external_source_urls')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_error: fetchErr instanceof Error ? fetchErr.message : 'Unknown error',
        })
        .eq('id', sourceUrl.id)

      return NextResponse.json({
        error: 'Kunne ikke hente innhold',
        details: fetchErr instanceof Error ? fetchErr.message : 'Unknown error',
      }, { status: 500 })
    }

  } catch (error) {
    console.error('Fetch URL error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
      return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 })
    }

    // Get user's household
    const { data: member } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!member) {
      return NextResponse.json({ error: 'Ingen husstand funnet' }, { status: 404 })
    }

    // Get all source URLs
    const { data: sourceUrls, error } = await supabase
      .from('external_source_urls')
      .select('*')
      .eq('household_id', member.household_id)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: 'Kunne ikke hente kilder' }, { status: 500 })
    }

    return NextResponse.json({ sourceUrls })

  } catch (error) {
    console.error('Get source URLs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
      return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID mangler' }, { status: 400 })
    }

    // Delete is handled by RLS - only household members can delete their own URLs
    const { error } = await supabase
      .from('external_source_urls')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: 'Kunne ikke slette kilde' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Delete source URL error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
