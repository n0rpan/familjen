import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateOrigin } from '@/lib/config'
import { NextResponse } from 'next/server'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

// GET - Fetch all allowed emails (admin only)
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Check admin status from JWT
    if (!user || user.app_metadata?.is_admin !== true) {
      return ApiErrors.adminRequired()
    }

    // Use admin client to bypass RLS
    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('allowed_emails')
      .select('*')
      .order('created_at')

    if (error) {
      return ApiErrors.internal({ internalMessage: error.message })
    }

    return NextResponse.json(data)
  } catch (error) {
    return handleApiError(error, 'get allowed emails')
  }
}

// POST - Add new allowed email (admin only)
export async function POST(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.app_metadata?.is_admin !== true) {
      return ApiErrors.adminRequired()
    }

    const body = await request.json()
    const { email, can_create_household } = body

    if (!email) {
      return ApiErrors.validation('E-post er påkrevd')
    }

    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('allowed_emails')
      .insert({
        email: email.toLowerCase().trim(),
        added_by: user.id,
        can_create_household: can_create_household || false,
      })
      .select()
      .single()

    if (error) {
      return ApiErrors.internal({ internalMessage: error.message })
    }

    return NextResponse.json(data)
  } catch (error) {
    return handleApiError(error, 'add allowed email')
  }
}

// DELETE - Remove allowed email (admin only)
export async function DELETE(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.app_metadata?.is_admin !== true) {
      return ApiErrors.adminRequired()
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return ApiErrors.validation('ID er påkrevd')
    }

    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from('allowed_emails')
      .delete()
      .eq('id', id)

    if (error) {
      return ApiErrors.internal({ internalMessage: error.message })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'delete allowed email')
  }
}
