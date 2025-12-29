// Client-side helper to trigger push notifications after mutations

import type { NotificationType } from './push-notifications'

/**
 * Send a notification to household members
 * Call this after successful mutations (pickup assigned, meal changed, etc.)
 */
export async function notifyHousehold(
  type: NotificationType,
  data: Record<string, string>,
  targetMemberIds?: string[]
): Promise<{ sent: number } | null> {
  try {
    const response = await fetch('/api/push/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data, targetMemberIds }),
    })

    if (!response.ok) {
      console.warn('[Notify] Failed to send notification:', await response.text())
      return null
    }

    return await response.json()
  } catch (error) {
    // Don't throw - notifications are best-effort
    console.warn('[Notify] Error sending notification:', error)
    return null
  }
}

// Convenience functions for common notification types

export function notifyPickupAssigned(
  childName: string,
  date: string,
  pickerMemberId: string
) {
  return notifyHousehold(
    'pickup_assigned',
    { childName, date },
    [pickerMemberId]
  )
}

export function notifyMealChanged(
  mealName: string,
  date: string
) {
  return notifyHousehold('meal_changed', { mealName, date })
}

export function notifyTaskAdded(
  childName: string,
  taskTitle: string,
  taskId: string
) {
  return notifyHousehold('task_added', { childName, taskTitle, taskId })
}

export function notifyEventAdded(
  memberName: string,
  eventTitle: string,
  date: string,
  eventId: string,
  targetMemberIds?: string[]
) {
  return notifyHousehold(
    'event_affects_me',
    { memberName, eventTitle, date, eventId },
    targetMemberIds
  )
}
