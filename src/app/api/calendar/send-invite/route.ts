import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/google-calendar'

// POST /api/calendar/send-invite - Send pickup invite to work calendar
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { pickupId, syncToWorkCalendar } = body

    if (!pickupId) {
      return NextResponse.json({ error: 'Missing pickupId' }, { status: 400 })
    }

    // Get pickup with child and picker details
    const { data: pickup, error: pickupError } = await supabase
      .from('pickups')
      .select(`
        *,
        child:children(name, location_name),
        picker:household_members(name, work_email)
      `)
      .eq('id', pickupId)
      .single()

    if (pickupError || !pickup) {
      return NextResponse.json({ error: 'Pickup not found' }, { status: 404 })
    }

    // Get calendar tokens
    const { data: tokens } = await supabase
      .from('google_calendar_tokens')
      .select('*')
      .limit(1)
      .single()

    if (!tokens) {
      return NextResponse.json({ error: 'Calendar not connected' }, { status: 400 })
    }

    const picker = pickup.picker as { name: string; work_email: string | null } | null
    const child = pickup.child as { name: string; location_name: string | null } | null

    // If turning OFF sync, delete the calendar event
    if (!syncToWorkCalendar) {
      if (pickup.work_calendar_event_id) {
        try {
          await deleteCalendarEvent(tokens, pickup.work_calendar_event_id)
        } catch (e) {
          console.error('Failed to delete calendar event:', e)
          // Continue anyway - event might already be deleted
        }
      }

      // Update pickup to remove sync
      await supabase
        .from('pickups')
        .update({
          sync_to_work_calendar: false,
          work_calendar_event_id: null
        })
        .eq('id', pickupId)

      return NextResponse.json({ success: true, action: 'removed' })
    }

    // If turning ON sync, create/update calendar event
    if (!picker?.work_email) {
      return NextResponse.json(
        { error: 'Picker has no work email configured' },
        { status: 400 }
      )
    }

    const eventDate = new Date(pickup.date)
    const summary = `Henting: ${child?.name || 'Barn'}`
    const description = `Henting av ${child?.name || 'barn'}${child?.location_name ? ` fra ${child.location_name}` : ''}\n\nTildelt: ${picker.name}\n\n—\nSendt fra Familjen-appen`

    // Default pickup time: 16:00-16:30 (can be customized later)
    const startTime = new Date(eventDate)
    startTime.setHours(16, 0, 0, 0)
    const endTime = new Date(eventDate)
    endTime.setHours(16, 30, 0, 0)

    const eventData = {
      summary,
      description,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'Europe/Oslo',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'Europe/Oslo',
      },
      attendees: [
        { email: picker.work_email }
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
        ],
      },
    }

    let eventId: string | null = null

    if (pickup.work_calendar_event_id) {
      // Update existing event
      try {
        const updated = await updateCalendarEvent(tokens, pickup.work_calendar_event_id, eventData)
        eventId = updated.id || pickup.work_calendar_event_id
      } catch (e) {
        console.error('Failed to update, creating new:', e)
        // If update fails, create new
        const created = await createCalendarEvent(tokens, eventData)
        eventId = created.id || null
      }
    } else {
      // Create new event
      const created = await createCalendarEvent(tokens, eventData)
      eventId = created.id || null
    }

    // Update pickup with sync status
    await supabase
      .from('pickups')
      .update({
        sync_to_work_calendar: true,
        work_calendar_event_id: eventId
      })
      .eq('id', pickupId)

    return NextResponse.json({
      success: true,
      action: 'created',
      eventId,
      sentTo: picker.work_email
    })

  } catch (error) {
    console.error('Send invite error:', error)
    return NextResponse.json(
      { error: 'Failed to send calendar invite' },
      { status: 500 }
    )
  }
}
