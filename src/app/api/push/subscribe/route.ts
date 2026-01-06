import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateOrigin } from '@/lib/config'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

export async function POST(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return ApiErrors.unauthorized()
    }

    const body = await request.json()
    const { subscription } = body

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return ApiErrors.validation('Ugyldig subscription')
    }

    // Store the subscription
    const { error: insertError } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh_key: subscription.keys.p256dh,
        auth_key: subscription.keys.auth,
        user_agent: request.headers.get('user-agent') || null,
        last_used_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,endpoint',
      })

    if (insertError) {
      console.error('Error saving push subscription:', insertError)
      return ApiErrors.internal({ internalMessage: insertError.message })
    }

    // Enable notifications for this member
    await supabase
      .from('household_members')
      .update({ notifications_enabled: true })
      .eq('user_id', user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'push subscribe')
  }
}

export async function DELETE(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return ApiErrors.unauthorized()
    }

    const body = await request.json()
    const { endpoint } = body

    if (!endpoint) {
      return ApiErrors.validation('Mangler endpoint')
    }

    // Remove the subscription
    const { error: deleteError } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint)

    if (deleteError) {
      console.error('Error removing push subscription:', deleteError)
      return ApiErrors.internal({ internalMessage: deleteError.message })
    }

    // Check if user has any remaining subscriptions
    const { data: remaining } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)

    // If no subscriptions left, disable notifications
    if (!remaining || remaining.length === 0) {
      await supabase
        .from('household_members')
        .update({ notifications_enabled: false })
        .eq('user_id', user.id)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'push unsubscribe')
  }
}
