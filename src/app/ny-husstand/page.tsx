'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function CreateHouseholdPage() {
  const [householdName, setHouseholdName] = useState('')
  const [myName, setMyName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [canCreate, setCanCreate] = useState(false)

  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  useEffect(() => {
    checkPermission()
  }, [])

  const checkPermission = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) {
        router.push('/login')
        return
      }

      // Check if user already has a household
      const { data: existingMember } = await supabase
        .from('household_members')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (existingMember) {
        // Already in a household, redirect home
        router.push('/')
        return
      }

      // Check if user's email allows creating household
      const { data: allowedEmail } = await supabase
        .from('allowed_emails')
        .select('can_create_household')
        .eq('email', user.email.toLowerCase())
        .single()

      setCanCreate(allowedEmail?.can_create_household === true)
    } catch (err) {
      console.error('Error checking permission:', err)
    } finally {
      setLoading(false)
    }
  }

  const createHousehold = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!householdName.trim() || !myName.trim()) return

    setSaving(true)
    setError(null)

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('Du må være logget inn')
      }

      // Double-check permission
      const { data: allowedEmail } = await supabase
        .from('allowed_emails')
        .select('can_create_household')
        .eq('email', user.email?.toLowerCase())
        .single()

      if (!allowedEmail?.can_create_household) {
        throw new Error('Du har ikke tilgang til å opprette husstand')
      }

      // Check if user already has a household
      const { data: existingMember } = await supabase
        .from('household_members')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (existingMember) {
        throw new Error('Du er allerede med i en husstand')
      }

      // Create the household
      const { data: newHousehold, error: householdError } = await supabase
        .from('households')
        .insert({ name: householdName.trim() })
        .select()
        .single()

      if (householdError) {
        throw new Error('Kunne ikke opprette husstand')
      }

      // Create the user as household admin
      const { error: memberError } = await supabase
        .from('household_members')
        .insert({
          household_id: newHousehold.id,
          name: myName.trim(),
          short_name: myName.trim().substring(0, 3),
          is_parent: true,
          is_household_admin: true,
          user_id: user.id,
          email: user.email?.toLowerCase(),
        })

      if (memberError) {
        // Rollback household creation
        await supabase.from('households').delete().eq('id', newHousehold.id)
        throw new Error('Kunne ikke legge til deg som medlem')
      }

      // Success - redirect to home
      router.push('/')
    } catch (err) {
      console.error('Create household error:', err)
      setError(err instanceof Error ? err.message : 'En feil oppstod')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4" style={{ background: 'var(--sand)' }} />
          <div className="h-6 w-32 rounded mx-auto" style={{ background: 'var(--sand)' }} />
        </div>
      </div>
    )
  }

  // User cannot create household - must be invited
  if (!canCreate) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center animate-fade-in">
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'rgba(126, 182, 196, 0.2)' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold font-display mb-2" style={{ color: 'var(--foreground)' }}>
            Venter på invitasjon
          </h1>
          <p className="mb-6" style={{ color: 'var(--muted)' }}>
            Du må bli invitert til en husstand av noen som allerede bruker appen.
            Be dem legge deg til som familiemedlem i innstillingene sine.
          </p>
          <button
            onClick={() => router.push('/')}
            className="btn btn-secondary"
          >
            Tilbake til forsiden
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center animate-fade-in">
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'rgba(229, 185, 94, 0.2)' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold font-display mb-2" style={{ color: 'var(--foreground)' }}>
            Opprett husstand
          </h1>
          <p style={{ color: 'var(--muted)' }}>
            Start med å gi husstanden din et navn
          </p>
        </div>

        {error && (
          <div
            className="mb-6 p-4 rounded-xl text-sm"
            style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
          >
            {error}
          </div>
        )}

        <form onSubmit={createHousehold} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Navn på husstand *
            </label>
            <input
              type="text"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              placeholder="F.eks. Familien Hansen"
              className="input"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Ditt navn *
            </label>
            <input
              type="text"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="F.eks. Mor eller Kari"
              className="input"
              required
            />
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Dette vises når du blir tildelt henting
            </p>
          </div>

          <button
            type="submit"
            disabled={saving || !householdName.trim() || !myName.trim()}
            className="btn btn-primary w-full"
          >
            {saving ? 'Oppretter...' : 'Opprett husstand'}
          </button>
        </form>

        <p className="text-xs text-center mt-6" style={{ color: 'var(--muted)' }}>
          Du blir automatisk administrator og kan invitere andre
        </p>
      </div>
    </div>
  )
}
