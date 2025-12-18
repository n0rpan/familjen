import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { SpondClient, SpondAuthError } from '@/lib/integrations/spond'
import { KidplanClient, KidplanAuthError } from '@/lib/integrations/kidplan'
import { ISkoleClient, ISkoleAuthError } from '@/lib/integrations/iskole'
import { MyKidClient, MyKidAuthError } from '@/lib/integrations/mykid'
import { addDays } from '@/lib/utils'
import sharp from 'sharp'

/**
 * POST /api/admin/sync
 *
 * Admin-only endpoint to trigger sync for any integration.
 * Uses service role to bypass RLS.
 */
export async function POST(request: Request) {
  try {
    // Verify the user is an admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin status
    const { data: allowedEmail } = await supabase
      .from('allowed_emails')
      .select('is_admin')
      .eq('email', user.email?.toLowerCase())
      .single()

    if (!allowedEmail?.is_admin) {
      return NextResponse.json({ error: 'Forbidden: Admin only' }, { status: 403 })
    }

    // Parse request body
    const body = await request.json()
    const { integrationId, service, householdId } = body as {
      integrationId: string
      service: string
      householdId: string
    }

    if (!integrationId || !service || !householdId) {
      return NextResponse.json(
        { error: 'Missing required fields: integrationId, service, householdId' },
        { status: 400 }
      )
    }

    console.log(`[Admin Sync] Starting ${service} sync for integration ${integrationId}`)

    // Create service role client
    const serviceSupabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Get the integration
    const { data: integration, error: intError } = await serviceSupabase
      .from('external_integrations')
      .select('*')
      .eq('id', integrationId)
      .single()

    if (intError || !integration) {
      return NextResponse.json({ error: `Integration not found: ${intError?.message}` }, { status: 404 })
    }

    // Decrypt credentials
    const { data: credentials, error: decryptError } = await serviceSupabase.rpc('decrypt_token', {
      ciphertext: integration.credentials_encrypted,
    })

    if (decryptError || !credentials) {
      return NextResponse.json({ error: `Failed to decrypt credentials: ${decryptError?.message}` }, { status: 500 })
    }

    const creds = JSON.parse(credentials)
    const result: {
      success: boolean
      eventsCount: number
      messagesCount: number
      photosCount: number
      error?: string
    } = {
      success: true,
      eventsCount: 0,
      messagesCount: 0,
      photosCount: 0,
    }

    try {
      switch (service) {
        case 'spond':
          await syncSpond(serviceSupabase, integration, creds, result)
          break
        case 'kidplan':
          await syncKidplan(serviceSupabase, integration, creds, result)
          break
        case 'iskole':
          await syncISkole(serviceSupabase, integration, creds, result)
          break
        case 'mykid':
          await syncMyKid(serviceSupabase, integration, creds, householdId, result)
          break
        default:
          return NextResponse.json({ error: `Unknown service: ${service}` }, { status: 400 })
      }

      // Update sync status
      await serviceSupabase
        .from('external_integrations')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'ok',
          last_sync_error: null,
        })
        .eq('id', integrationId)

    } catch (error) {
      console.error(`[Admin Sync] Error:`, error)
      result.success = false
      result.error = String(error)

      // Update sync status with error
      const isAuthError =
        error instanceof SpondAuthError ||
        error instanceof KidplanAuthError ||
        error instanceof ISkoleAuthError ||
        error instanceof MyKidAuthError

      await serviceSupabase
        .from('external_integrations')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: isAuthError ? 'auth_failed' : 'error',
          last_sync_error: String(error),
        })
        .eq('id', integrationId)
    }

    console.log(`[Admin Sync] Completed: ${JSON.stringify(result)}`)
    return NextResponse.json(result)

  } catch (error) {
    console.error('[Admin Sync] Unexpected error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIntegration = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = { eventsCount: number; messagesCount: number; photosCount: number; error?: string }

async function syncSpond(supabase: AnySupabase, integration: AnyIntegration, creds: { email: string; password: string }, result: AnyResult) {
  const client = new SpondClient()
  await client.login(creds.email, creds.password)

  const now = new Date()
  const futureDate = addDays(now, 90)
  const lastSync = integration.last_sync_at ? new Date(integration.last_sync_at) : addDays(now, -30)

  // Get child mappings
  const { data: mappings } = await supabase
    .from('external_integration_members')
    .select('external_group_id, child_id')
    .eq('integration_id', integration.id)

  const mappedGroupIds = new Set(mappings?.map((m: { external_group_id: string }) => m.external_group_id) || [])
  const childIdMap = new Map(mappings?.map((m: { external_group_id: string; child_id: string }) => [m.external_group_id, m.child_id]) || [])

  // Fetch events
  const events = await client.getEvents({
    includeScheduled: true,
    maxEvents: 200,
    minEndTimestamp: now,
    maxStartTimestamp: futureDate,
  })

  for (const event of events) {
    const groupId = event.recipients?.group?.id
    if (!groupId || !mappedGroupIds.has(groupId)) continue

    const mapped = SpondClient.mapEventToDb(event, groupId)
    const childId = childIdMap.get(groupId)

    await supabase.from('external_events').upsert({
      integration_id: integration.id,
      child_id: childId,
      external_id: event.id,
      external_group_id: groupId,
      title: mapped.title,
      event_date: mapped.eventDate,
      end_date: mapped.endDate,
      event_type: mapped.eventType,
      location: mapped.location,
      raw_data: event,
    }, { onConflict: 'integration_id,external_id' })
    result.eventsCount++
  }

  // Fetch posts (innlegg) - includeComments is set by default in getPosts
  const posts = await client.getPosts({
    maxPosts: 100,
  })

  for (const post of posts) {
    const postGroupId = post.group?.id
    if (!postGroupId || !mappedGroupIds.has(postGroupId)) continue
    if (!post.createdTime) continue
    const postDate = new Date(post.createdTime)
    if (postDate < lastSync) continue

    const childId = childIdMap.get(postGroupId)
    const mapped = SpondClient.mapPostToDb(post, postGroupId)

    await supabase.from('external_messages').upsert({
      integration_id: integration.id,
      child_id: childId,
      external_id: post.id,
      external_group_id: postGroupId,
      sender_name: mapped.senderName,
      title: null,
      body: mapped.body,
      message_date: mapped.messageDate,
      source_type: 'post',
      raw_data: post,
    }, { onConflict: 'integration_id,external_id' })
    result.messagesCount++
  }
}

async function syncKidplan(supabase: AnySupabase, integration: AnyIntegration, creds: { email: string; password: string }, result: AnyResult) {
  const client = new KidplanClient()
  await client.login(creds.email, creds.password)

  const now = new Date()
  const lastSync = integration.last_sync_at ? new Date(integration.last_sync_at) : addDays(now, -30)

  // Sync board posts
  const boardData = await client.getBoardPosts()
  console.log(`[Admin Sync] Kidplan board posts: ${boardData.BoardPosts?.length || 0}`)

  for (const post of boardData.BoardPosts || []) {
    const postDate = KidplanClient.parseMicrosoftDate(post.Created)
    if (!postDate || postDate < lastSync) continue

    await supabase.from('external_messages').upsert({
      integration_id: integration.id,
      child_id: null,
      external_id: `boardpost_${post.PostId}`,
      sender_name: post.AuthorName,
      title: post.Title,
      body: post.Content || '',
      message_date: postDate.toISOString(),
      source_type: 'board_post',
      raw_data: post,
    }, { onConflict: 'integration_id,external_id' })
    result.messagesCount++
  }

  // Sync conversations
  const conversations = await client.getConversations(20, 0)
  console.log(`[Admin Sync] Kidplan conversations: ${conversations.length}`)

  for (const conv of conversations) {
    try {
      const messagesResponse = await client.getMessages(conv.ConversationId, 20, 0)
      const messages = Array.isArray(messagesResponse) ? messagesResponse : []

      for (const msg of messages) {
        const msgDate = KidplanClient.parseMicrosoftDate(msg.Created)
        if (!msgDate || msgDate < lastSync) continue

        await supabase.from('external_messages').upsert({
          integration_id: integration.id,
          child_id: null,
          external_id: `message_${msg.MessageId}`,
          chat_id: String(conv.ConversationId),
          sender_name: msg.Sender || null,
          body: msg.Content || '',
          message_date: msgDate.toISOString(),
          source_type: 'conversation',
          raw_data: msg,
        }, { onConflict: 'integration_id,external_id' })
        result.messagesCount++
      }
    } catch (e) {
      console.error(`[Admin Sync] Error fetching conversation ${conv.ConversationId}:`, e)
    }
  }

  // Sync photos
  const photos = await client.getLatestPhotos()
  console.log(`[Admin Sync] Kidplan photos: ${photos.length}`)

  for (const photo of photos.slice(0, 30)) {
    try {
      const { data: existing } = await supabase
        .from('external_photos')
        .select('id, storage_path')
        .eq('integration_id', integration.id)
        .eq('external_id', photo.id)
        .single()

      if (existing && !existing.storage_path?.startsWith('pending/')) continue

      const { buffer, contentType } = await client.fetchPhoto(photo.fullUrl)
      const compressed = await sharp(buffer).resize(1200).jpeg({ quality: 80 }).toBuffer()
      const { width, height } = await sharp(compressed).metadata()

      const storagePath = `${integration.household_id}/${integration.id}/${photo.id}.jpg`
      await supabase.storage.from('external-photos').upload(storagePath, compressed, {
        contentType: 'image/jpeg',
        upsert: true,
      })

      await supabase.from('external_photos').upsert({
        integration_id: integration.id,
        external_id: photo.id,
        storage_path: storagePath,
        width,
        height,
        file_size: compressed.length,
        original_content_type: contentType,
        expires_at: addDays(new Date(), 365).toISOString(),
      }, { onConflict: 'integration_id,external_id' })
      result.photosCount++

      await new Promise(r => setTimeout(r, 200))
    } catch (e) {
      console.error(`[Admin Sync] Error syncing photo ${photo.id}:`, e)
    }
  }
}

async function syncISkole(supabase: AnySupabase, integration: AnyIntegration, creds: { personalNumber: string; password: string }, result: AnyResult) {
  const client = new ISkoleClient()
  await client.login(creds.personalNumber, creds.password)

  const now = new Date()
  const lastSync = integration.last_sync_at ? new Date(integration.last_sync_at) : addDays(now, -30)

  // Get child mappings
  const { data: mappings } = await supabase
    .from('external_integration_members')
    .select('external_group_id, child_id')
    .eq('integration_id', integration.id)

  const childIdMap = new Map(mappings?.map((m: { external_group_id: string; child_id: string }) => [m.external_group_id, m.child_id]) || [])

  // Fetch children and messages
  const children = await client.getChildren()
  console.log(`[Admin Sync] iSkole children: ${children.length}`)

  for (const child of children) {
    try {
      const messages = await client.getMessages(child.Elevnr, child.Fylkeid, child.Planperi, child.Skoleid, 50, 0)
      console.log(`[Admin Sync] iSkole child ${child.Elevnr}: ${messages.length} messages`)

      for (const msg of messages) {
        const msgDate = new Date(msg.Mottatt)
        if (msgDate < lastSync) continue

        const senderName = [msg.Fname, msg.Lname].filter(Boolean).join(' ') || null
        const childId = childIdMap.get(String(child.Elevnr))

        await supabase.from('external_messages').upsert({
          integration_id: integration.id,
          child_id: childId,
          external_id: `iskole_msg_${msg.Meldingid}`,
          external_group_id: String(child.Elevnr),
          sender_name: senderName,
          title: msg.Emne || null,
          body: msg.Tekst || '',
          message_date: msgDate.toISOString(),
          source_type: 'school_message',
          raw_data: msg,
        }, { onConflict: 'integration_id,external_id' })
        result.messagesCount++
      }
    } catch (e) {
      console.error(`[Admin Sync] Error syncing iSkole child ${child.Elevnr}:`, e)
    }
  }

  // Sync school calendar
  try {
    const currentMonth = now.getMonth() + 1
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1
    const firstChild = children[0]

    if (firstChild) {
      for (const month of [currentMonth, nextMonth]) {
        const calendar = await client.getSchoolCalendar(month, firstChild.Fylkeid, firstChild.Planperi, firstChild.Skoleid)

        for (const week of calendar) {
          // Skip if week.Dato is missing
          if (!week.Dato) continue

          for (let d = 1; d <= 5; d++) {
            const dayType = week[`Dag${d}` as keyof typeof week]
            if (dayType === 'FD' || dayType === 'PD') {
              const dateStr = week.Dato
              const dayIndex = d - 1
              const year = parseInt(dateStr.substring(0, 4))
              const monthNum = parseInt(dateStr.substring(4, 6)) - 1
              const day = parseInt(dateStr.substring(6, 8)) + dayIndex

              const eventDate = new Date(year, monthNum, day)

              await supabase.from('external_events').upsert({
                integration_id: integration.id,
                child_id: null,
                external_id: `iskole_closure_${eventDate.toISOString().split('T')[0]}`,
                title: dayType === 'FD' ? 'Skolefri' : 'Planleggingsdag',
                event_date: eventDate.toISOString(),
                event_type: 'school_closure',
                raw_data: { week, dayType },
              }, { onConflict: 'integration_id,external_id' })
              result.eventsCount++
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[Admin Sync] Error syncing iSkole calendar:', e)
  }
}

async function syncMyKid(supabase: AnySupabase, integration: AnyIntegration, creds: { phone: string; password: string }, householdId: string, result: AnyResult) {
  const client = new MyKidClient()
  await client.login(creds.phone, creds.password)

  const now = new Date()
  const futureDate = addDays(now, 90)
  const lastSync = integration.last_sync_at ? new Date(integration.last_sync_at) : addDays(now, -30)

  // Sync calendar events
  try {
    const events = await client.getCalendarEvents(now, futureDate)
    console.log(`[Admin Sync] MyKid calendar events: ${events.length}`)

    for (const event of events) {
      const mapped = MyKidClient.mapCalendarEventToDb(event)
      await supabase.from('external_events').upsert({
        integration_id: integration.id,
        external_id: event.id,
        title: mapped.title,
        event_date: mapped.eventDate,
        end_date: mapped.endDate,
        event_type: mapped.eventType,
        raw_data: event,
      }, { onConflict: 'integration_id,external_id' })
      result.eventsCount++
    }
  } catch (e) {
    console.error('[Admin Sync] Error syncing MyKid calendar:', e)
  }

  // Sync newsletters
  try {
    const newsletters = await client.getNewsletterList()
    console.log(`[Admin Sync] MyKid newsletters: ${newsletters.length}`)

    for (const summary of newsletters.slice(0, 50)) {
      const { data: existing } = await supabase
        .from('external_messages')
        .select('id')
        .eq('integration_id', integration.id)
        .eq('external_id', `newsletter_${summary.id}`)
        .single()

      if (existing) continue

      try {
        const full = await client.getNewsletterContent(summary.id)
        const nlDate = MyKidClient.parseNorwegianDate(full.date)
        if (nlDate && nlDate < lastSync) continue

        await supabase.from('external_messages').insert({
          integration_id: integration.id,
          external_id: `newsletter_${summary.id}`,
          title: full.title,
          body: full.content,
          message_date: nlDate?.toISOString() || new Date().toISOString(),
          source_type: 'newsletter',
          raw_data: full,
        })
        result.messagesCount++
      } catch (e) {
        console.error(`[Admin Sync] Error fetching newsletter ${summary.id}:`, e)
      }
    }
  } catch (e) {
    console.error('[Admin Sync] Error syncing MyKid newsletters:', e)
  }

  // Sync photos
  try {
    const photos = await client.getPhotosFromRecentDays(30)
    console.log(`[Admin Sync] MyKid photos: ${photos.length}`)

    for (const photo of photos.slice(0, 50)) {
      const { data: existing } = await supabase
        .from('external_photos')
        .select('id, storage_path')
        .eq('integration_id', integration.id)
        .eq('external_id', photo.photoId)
        .single()

      if (existing && !existing.storage_path?.startsWith('pending/')) continue

      try {
        const { buffer, contentType } = await client.downloadPhoto(photo.url)
        const compressed = await sharp(buffer).resize(1200).jpeg({ quality: 80 }).toBuffer()
        const { width, height } = await sharp(compressed).metadata()

        const storagePath = `${householdId}/${integration.id}/${photo.photoId}.jpg`
        await supabase.storage.from('external-photos').upload(storagePath, compressed, {
          contentType: 'image/jpeg',
          upsert: true,
        })

        await supabase.from('external_photos').upsert({
          integration_id: integration.id,
          external_id: photo.photoId,
          storage_path: storagePath,
          width,
          height,
          file_size: compressed.length,
          original_content_type: contentType,
          expires_at: addDays(new Date(), 365).toISOString(),
        }, { onConflict: 'integration_id,external_id' })
        result.photosCount++

        await new Promise(r => setTimeout(r, 200))
      } catch (e) {
        console.error(`[Admin Sync] Error syncing photo ${photo.photoId}:`, e)
      }
    }
  } catch (e) {
    console.error('[Admin Sync] Error syncing MyKid photos:', e)
  }
}
