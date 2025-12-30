/**
 * Shared deletion detection and notification logic for external integrations
 *
 * This module handles:
 * - Detecting events deleted from external sources
 * - Creating undo-able deletion records
 * - Sending push notifications for deletions
 * - Tracking event changes (date/title modifications)
 *
 * SAFETY: Includes safeguards against partial API responses causing false deletions.
 * If an API returns suspiciously few events, deletion detection is skipped.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { sendPushNotification, type NotificationType } from '@/lib/push-notifications'

// Safety thresholds to prevent false deletions from partial API responses
const MIN_EVENTS_FOR_DELETION_CHECK = 1 // At least some events must be returned
const MAX_DELETION_RATIO = 0.5 // Skip if >50% of events would be deleted (likely API error)
const MAX_ABSOLUTE_DELETIONS = 10 // Skip if >10 deletions in one sync (likely API error)

export interface ExternalEventRecord {
  id: string
  integration_id: string
  external_id: string
  title: string
  event_date: string
  event_time: string | null
  end_date: string | null
  end_time: string | null
  location: string | null
  description: string | null
  event_type: string | null
  child_id: string | null
  local_overrides: Record<string, unknown> | null
  user_notes: string | null
  is_hidden: boolean
}

export interface SyncedEvent {
  external_id: string
  title: string
  event_date: string
  event_time: string | null
  end_date: string | null
  location: string | null
}

export interface DeletionResult {
  deletedCount: number
  modifiedCount: number
  notificationsCreated: number
}

/**
 * Detect and handle deleted/modified events from an external sync
 *
 * @param supabase - Supabase client
 * @param integrationId - The integration ID
 * @param householdId - The household ID for notifications
 * @param currentEvents - Events currently returned by the external API
 * @param serviceName - Service name for display (e.g., "Spond", "Kidplan")
 */
export async function handleEventDeletionsAndChanges(
  supabase: SupabaseClient,
  integrationId: string,
  householdId: string,
  currentEvents: SyncedEvent[],
  serviceName: string
): Promise<DeletionResult> {
  const result: DeletionResult = {
    deletedCount: 0,
    modifiedCount: 0,
    notificationsCreated: 0,
  }

  // Get today's date for filtering (only care about future events)
  const today = new Date().toISOString().split('T')[0]

  // Fetch existing events from this integration (future events only)
  const { data: existingEvents, error: fetchError } = await supabase
    .from('external_events')
    .select('id, integration_id, external_id, title, event_date, event_time, end_date, end_time, location, description, event_type, child_id, local_overrides, user_notes, is_hidden')
    .eq('integration_id', integrationId)
    .gte('event_date', today) as { data: ExternalEventRecord[] | null; error: unknown }

  if (fetchError || !existingEvents) {
    console.error('Error fetching existing events for deletion check:', fetchError)
    return result
  }

  // SAFETY CHECK: If API returned no events but we have existing events,
  // this is likely an API error - skip deletion detection entirely
  if (currentEvents.length < MIN_EVENTS_FOR_DELETION_CHECK && existingEvents.length > 0) {
    console.warn(
      `[${serviceName}] Skipping deletion detection: API returned ${currentEvents.length} events but DB has ${existingEvents.length}. Possible API error.`
    )
    return result
  }

  // Create a map of current external_ids for quick lookup
  const currentExternalIds = new Set(currentEvents.map(e => e.external_id))
  const currentEventsMap = new Map(currentEvents.map(e => [e.external_id, e]))

  // Find deleted events (exist in DB but not in current sync)
  const deletedEvents = existingEvents.filter(e => !currentExternalIds.has(e.external_id))

  // SAFETY CHECK: Prevent mass deletions from partial API responses
  if (deletedEvents.length > 0 && existingEvents.length > 0) {
    const deletionRatio = deletedEvents.length / existingEvents.length

    // If more than 50% would be deleted OR more than 10 absolute deletions, skip
    if (deletionRatio > MAX_DELETION_RATIO || deletedEvents.length > MAX_ABSOLUTE_DELETIONS) {
      console.warn(
        `[${serviceName}] Skipping deletion detection: ${deletedEvents.length}/${existingEvents.length} events would be deleted (${(deletionRatio * 100).toFixed(0)}%). Possible partial API response.`
      )
      return result
    }
  }

  // Find modified events (exist in both but details changed)
  const modifiedEvents: Array<{ existing: ExternalEventRecord; current: SyncedEvent }> = []

  for (const existing of existingEvents) {
    const current = currentEventsMap.get(existing.external_id)
    if (current) {
      // Check if date or title changed
      const dateChanged = existing.event_date !== current.event_date
      const titleChanged = existing.title !== current.title

      if (dateChanged || titleChanged) {
        modifiedEvents.push({ existing, current })
      }
    }
  }

  // Process deleted events
  for (const event of deletedEvents) {
    try {
      // Create a deletion notification (allows undo)
      const { error: notifError } = await supabase
        .from('event_change_notifications')
        .insert({
          household_id: householdId,
          change_type: 'removed',
          source_name: serviceName,
          original_title: event.local_overrides?.title as string || event.title,
          original_date: event.event_date,
          original_end_date: event.end_date,
          original_time: event.event_time,
          original_description: event.description,
          child_id: event.child_id,
          status: 'unread',
          // Store the full event data for restoration
          raw_event_data: {
            ...event,
            _source: 'external_integration',
            _integration_id: integrationId,
          },
        })

      if (!notifError) {
        result.notificationsCreated++
      }

      // Actually delete the event
      await supabase
        .from('external_events')
        .delete()
        .eq('id', event.id)

      result.deletedCount++

      // Send push notification
      await sendDeletionNotification(supabase, householdId, serviceName, event.title, event.event_date)
    } catch (err) {
      console.error('Error processing deleted event:', err)
    }
  }

  // Process modified events (date/title changes)
  for (const { existing, current } of modifiedEvents) {
    try {
      const dateChanged = existing.event_date !== current.event_date
      const titleChanged = existing.title !== current.title

      // Create modification notification
      const { error: notifError } = await supabase
        .from('event_change_notifications')
        .insert({
          household_id: householdId,
          change_type: dateChanged ? 'date_changed' : 'title_changed',
          source_name: serviceName,
          original_title: existing.title,
          original_date: existing.event_date,
          original_time: existing.event_time,
          new_title: titleChanged ? current.title : null,
          new_date: dateChanged ? current.event_date : null,
          child_id: existing.child_id,
          status: 'unread',
        })

      if (!notifError) {
        result.notificationsCreated++
      }

      result.modifiedCount++

      // Send push notification for date changes (more important than title changes)
      if (dateChanged) {
        await sendDateChangeNotification(
          supabase,
          householdId,
          serviceName,
          existing.title,
          existing.event_date,
          current.event_date
        )
      }
    } catch (err) {
      console.error('Error processing modified event:', err)
    }
  }

  return result
}

/**
 * Send push notification for a deleted event
 */
async function sendDeletionNotification(
  supabase: SupabaseClient,
  householdId: string,
  serviceName: string,
  eventTitle: string,
  eventDate: string
): Promise<void> {
  try {
    // Get all household members' push subscriptions
    const { data: members } = await supabase
      .from('household_members')
      .select('user_id')
      .eq('household_id', householdId)

    if (!members || members.length === 0) return

    const userIds = members.map(m => m.user_id).filter(Boolean)

    // Get push subscriptions
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds)

    if (!subscriptions || subscriptions.length === 0) return

    // Format date for display
    const formattedDate = new Date(eventDate).toLocaleDateString('nb-NO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })

    // Send to each subscription
    for (const sub of subscriptions) {
      try {
        await sendPushNotification(sub, {
          title: `${serviceName}: Hendelse fjernet`,
          body: `"${eventTitle}" (${formattedDate}) ble fjernet`,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-72.png',
          tag: `event-deleted-${eventDate}`,
          data: {
            type: 'event_deleted' as NotificationType,
            url: '/feed',
          },
        })
      } catch {
        // Individual notification failure, continue with others
      }
    }
  } catch (err) {
    console.error('Error sending deletion notification:', err)
  }
}

/**
 * Send push notification for a date change
 */
async function sendDateChangeNotification(
  supabase: SupabaseClient,
  householdId: string,
  serviceName: string,
  eventTitle: string,
  oldDate: string,
  newDate: string
): Promise<void> {
  try {
    const { data: members } = await supabase
      .from('household_members')
      .select('user_id')
      .eq('household_id', householdId)

    if (!members || members.length === 0) return

    const userIds = members.map(m => m.user_id).filter(Boolean)

    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds)

    if (!subscriptions || subscriptions.length === 0) return

    const formatDate = (d: string) => new Date(d).toLocaleDateString('nb-NO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })

    for (const sub of subscriptions) {
      try {
        await sendPushNotification(sub, {
          title: `${serviceName}: Dato endret`,
          body: `"${eventTitle}" flyttet fra ${formatDate(oldDate)} til ${formatDate(newDate)}`,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-72.png',
          tag: `event-changed-${newDate}`,
          data: {
            type: 'event_changed' as NotificationType,
            url: '/uke',
          },
        })
      } catch {
        // Continue with other subscriptions
      }
    }
  } catch (err) {
    console.error('Error sending date change notification:', err)
  }
}

/**
 * Send push notification for a new event
 */
export async function sendNewEventNotification(
  supabase: SupabaseClient,
  householdId: string,
  serviceName: string,
  eventTitle: string,
  eventDate: string
): Promise<void> {
  try {
    const { data: members } = await supabase
      .from('household_members')
      .select('user_id')
      .eq('household_id', householdId)

    if (!members || members.length === 0) return

    const userIds = members.map(m => m.user_id).filter(Boolean)

    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds)

    if (!subscriptions || subscriptions.length === 0) return

    const formattedDate = new Date(eventDate).toLocaleDateString('nb-NO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })

    for (const sub of subscriptions) {
      try {
        await sendPushNotification(sub, {
          title: `${serviceName}: Ny hendelse`,
          body: `"${eventTitle}" - ${formattedDate}`,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-72.png',
          tag: `event-new-${eventDate}`,
          data: {
            type: 'event_added' as NotificationType,
            url: '/uke',
          },
        })
      } catch {
        // Continue with other subscriptions
      }
    }
  } catch (err) {
    console.error('Error sending new event notification:', err)
  }
}
