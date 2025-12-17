import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendPushNotification,
  getNotificationContent,
  shouldNotify,
  type NotificationType,
} from '@/lib/push-notifications'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 })
    }

    const body = await request.json()
    const { type, data, targetMemberIds } = body as {
      type: NotificationType
      data: Record<string, string>
      targetMemberIds?: string[] // Optional: specific members to notify
    }

    if (!type || !data) {
      return NextResponse.json({ error: 'Mangler type eller data' }, { status: 400 })
    }

    // Get user's household
    const { data: member } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .single()

    if (!member) {
      return NextResponse.json({ error: 'Ikke medlem av husstand' }, { status: 403 })
    }

    // Get all push subscriptions for household members with notifications enabled
    const { data: subscriptions, error: subError } = await supabase
      .rpc('get_household_push_subscriptions', { p_household_id: member.household_id })

    if (subError) {
      console.error('Error getting subscriptions:', subError)
      return NextResponse.json({ error: 'Kunne ikke hente subscriptions' }, { status: 500 })
    }

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ sent: 0, message: 'Ingen subscriptions' })
    }

    // Filter subscriptions based on notification type preferences
    const filteredSubs = subscriptions.filter((sub: {
      user_id: string
      member_id: string
      notify_pickup_assigned: boolean
      notify_meal_changed: boolean
      notify_task_added: boolean
      notify_event_affects_me: boolean
    }) => {
      // Don't notify the user who made the change
      if (sub.user_id === user.id) return false

      // If specific members are targeted, only notify them
      if (targetMemberIds && !targetMemberIds.includes(sub.member_id)) return false

      // Check member's notification preferences
      return shouldNotify(type, {
        notify_pickup_assigned: sub.notify_pickup_assigned,
        notify_meal_changed: sub.notify_meal_changed,
        notify_task_added: sub.notify_task_added,
        notify_event_affects_me: sub.notify_event_affects_me,
      })
    })

    if (filteredSubs.length === 0) {
      return NextResponse.json({ sent: 0, message: 'Ingen medlemmer å varsle' })
    }

    // Get notification content
    const payload = getNotificationContent(type, data)

    // Send notifications
    const results = await Promise.all(
      filteredSubs.map(async (sub: {
        endpoint: string
        p256dh_key: string
        auth_key: string
      }) => {
        const success = await sendPushNotification(
          {
            endpoint: sub.endpoint,
            p256dh_key: sub.p256dh_key,
            auth_key: sub.auth_key,
          },
          payload
        )

        // If subscription is invalid, remove it
        if (!success) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint)
        }

        return success
      })
    )

    const sent = results.filter(Boolean).length

    return NextResponse.json({ sent, total: filteredSubs.length })
  } catch (error) {
    console.error('Push notify error:', error)
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 })
  }
}
