import webPush from 'web-push'

// Configure web-push with VAPID keys
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@familjen.eu'

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
}

export type NotificationType =
  | 'pickup_assigned'
  | 'meal_changed'
  | 'task_added'
  | 'event_affects_me'

export interface PushSubscription {
  endpoint: string
  p256dh_key: string
  auth_key: string
}

export interface NotificationPayload {
  title: string
  body: string
  url?: string
  tag?: string
  actions?: Array<{
    action: string
    title: string
  }>
}

/**
 * Send a push notification to a subscription
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: NotificationPayload
): Promise<boolean> {
  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh_key,
          auth: subscription.auth_key,
        },
      },
      JSON.stringify(payload)
    )
    return true
  } catch (error: unknown) {
    // Check if subscription is no longer valid (410 Gone or 404 Not Found)
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const statusCode = (error as { statusCode: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        console.log('[Push] Subscription expired or invalid:', subscription.endpoint.slice(0, 50))
        return false // Indicates subscription should be removed
      }
    }
    console.error('[Push] Failed to send notification:', error)
    return true // Keep subscription, might be temporary error
  }
}

/**
 * Get notification title and body based on type
 */
export function getNotificationContent(
  type: NotificationType,
  data: Record<string, string>
): NotificationPayload {
  switch (type) {
    case 'pickup_assigned':
      return {
        title: 'Ny henting tildelt',
        body: `Du skal hente ${data.childName} ${data.date}`,
        url: '/uke',
        tag: `pickup-${data.date}`,
      }
    case 'meal_changed':
      return {
        title: 'Middag oppdatert',
        body: `${data.date}: ${data.mealName}`,
        url: '/',
        tag: `meal-${data.date}`,
      }
    case 'task_added':
      return {
        title: 'Ny oppgave',
        body: `${data.childName}: ${data.taskTitle}`,
        url: '/uke',
        tag: `task-${data.taskId}`,
      }
    case 'event_affects_me':
      return {
        title: 'Ny hendelse',
        body: `${data.memberName}: ${data.eventTitle} (${data.date})`,
        url: '/uke',
        tag: `event-${data.eventId}`,
      }
    default:
      return {
        title: 'Familjen',
        body: 'Du har en ny varsling',
        url: '/',
      }
  }
}

/**
 * Check if a member should receive a notification of this type
 */
export function shouldNotify(
  type: NotificationType,
  memberPrefs: {
    notify_pickup_assigned: boolean
    notify_meal_changed: boolean
    notify_task_added: boolean
    notify_event_affects_me: boolean
  }
): boolean {
  switch (type) {
    case 'pickup_assigned':
      return memberPrefs.notify_pickup_assigned
    case 'meal_changed':
      return memberPrefs.notify_meal_changed
    case 'task_added':
      return memberPrefs.notify_task_added
    case 'event_affects_me':
      return memberPrefs.notify_event_affects_me
    default:
      return false
  }
}
