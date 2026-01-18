import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/google-calendar'
import { sendInviteRequestSchema, validateRequest } from '@/lib/schemas'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { validateOrigin } from '@/lib/config'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

// POST /api/calendar/send-invite - Send pickup invite to work calendar
export async function POST(request: Request) {
  try {
    // CSRF protection - validate same-origin request
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return ApiErrors.unauthorized()
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'calendarInvite')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.calendarInvite)
    if (rateLimit.limited) {
      return ApiErrors.rateLimit(rateLimit.retryAfter)
    }

    // Validate request body
    const validation = await validateRequest(request, sendInviteRequestSchema)
    if (!validation.success) {
      return ApiErrors.validation(validation.error || 'Ugyldig forespørsel')
    }
    const { pickupId, syncToWorkCalendar } = validation.data

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
      return ApiErrors.notFound('Hentingen')
    }

    // Get calendar tokens via RPC (bypasses admin-only RLS)
    const { data: tokensArray, error: tokensError } = await supabase
      .rpc('get_household_calendar_tokens')

    if (tokensError || !tokensArray || tokensArray.length === 0) {
      return ApiErrors.validation('Kalender er ikke tilkoblet')
    }
    const tokens = tokensArray[0]

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
      return ApiErrors.validation('Henteren har ingen jobb-e-post konfigurert')
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
    return handleApiError(error, 'send invite')
  }
}
