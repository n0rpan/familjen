'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { ChildColor } from '@/lib/types'
import { CHILD_COLORS } from '@/lib/colors'
import { useLanguage } from '@/lib/i18n/context'

type WizardStep = 'household' | 'children' | 'partner' | 'done'

interface NewChild {
  name: string
  birth_date: string
  location_name: string
  location_type: 'school' | 'kindergarten'
  color: ChildColor
  allergies: string
}

export default function CreateHouseholdPage() {
  const { t } = useLanguage()
  const [step, setStep] = useState<WizardStep>('household')
  const [householdId, setHouseholdId] = useState<string | null>(null)

  // Step 1: Household info
  const [householdName, setHouseholdName] = useState('')
  const [myName, setMyName] = useState('')
  const [myBirthDate, setMyBirthDate] = useState('')
  const [myAllergies, setMyAllergies] = useState('')

  // Step 2: Children
  const [children, setChildren] = useState<NewChild[]>([])
  const [newChild, setNewChild] = useState<NewChild>({
    name: '',
    birth_date: '',
    location_name: '',
    location_type: 'kindergarten',
    color: 'sky',
    allergies: '',
  })

  // Step 3: Partner
  const [partnerName, setPartnerName] = useState('')
  const [partnerEmail, setPartnerEmail] = useState('')

  // State
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
        router.push('/')
        return
      }

      // Check if user's email allows creating household
      console.log('[ny-husstand] Checking permission for:', user.email.toLowerCase())
      const { data: allowedEmail, error: allowedError } = await supabase
        .from('allowed_emails')
        .select('can_create_household')
        .eq('email', user.email.toLowerCase())
        .maybeSingle()

      if (allowedError) {
        console.error('[ny-husstand] Error fetching allowed_emails:', allowedError)
      }
      console.log('[ny-husstand] Result:', allowedEmail, 'can_create:', allowedEmail?.can_create_household)

      setCanCreate(allowedEmail?.can_create_household === true)
    } catch (err) {
      console.error('Error checking permission:', err)
    } finally {
      setLoading(false)
    }
  }

  // Step 1: Create household
  const createHousehold = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!householdName.trim() || !myName.trim()) return

    setSaving(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error(t.errors.unauthorized)

      // Use RPC function to create household and member atomically
      // All member data is passed to the RPC to ensure it's set in one SECURITY DEFINER call
      const { data: newHouseholdId, error: createError } = await supabase
        .rpc('create_household_with_admin', {
          p_household_name: householdName.trim(),
          p_member_name: myName.trim(),
          p_member_email: user.email?.toLowerCase() || '',
          p_birth_date: myBirthDate || null,
          p_allergies: myAllergies.trim() || null,
        })

      if (createError) {
        console.error('Create household error:', createError)
        throw new Error(t.errors.couldNotCreateHousehold)
      }

      setHouseholdId(newHouseholdId)
      setStep('children')
    } catch (err) {
      console.error('Create household error:', err)
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setSaving(false)
    }
  }

  // Add a child to the list
  const addChild = () => {
    if (!newChild.name.trim()) return
    setChildren([...children, { ...newChild }])
    setNewChild({
      name: '',
      birth_date: '',
      location_name: '',
      location_type: 'kindergarten',
      color: CHILD_COLORS[(children.length + 1) % CHILD_COLORS.length].value,
      allergies: '',
    })
  }

  const removeChild = (index: number) => {
    setChildren(children.filter((_, i) => i !== index))
  }

  // Step 2: Save children
  const saveChildren = async () => {
    if (!householdId || children.length === 0) {
      setStep('partner')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const childrenData = children.map(c => ({
        household_id: householdId,
        name: c.name.trim(),
        birth_date: c.birth_date || null,
        location_name: c.location_name.trim() || null,
        location_type: c.location_type,
        color: c.color,
        allergies: c.allergies.trim() || null,
      }))

      const { error: childError } = await supabase.from('children').insert(childrenData)
      if (childError) throw new Error(t.errors.couldNotAddChild)

      setStep('partner')
    } catch (err) {
      console.error('Save children error:', err)
      setError(err instanceof Error ? err.message : 'En feil oppstod')
    } finally {
      setSaving(false)
    }
  }

  // Step 3: Invite partner
  const savePartner = async () => {
    if (!householdId) {
      setStep('done')
      return
    }

    // Skip if no partner info
    if (!partnerName.trim() && !partnerEmail.trim()) {
      setStep('done')
      return
    }

    setSaving(true)
    setError(null)

    try {
      // Add partner as household member (without user_id - they'll link on login)
      const { error: memberError } = await supabase.from('household_members').insert({
        household_id: householdId,
        name: partnerName.trim(),
        short_name: partnerName.trim().substring(0, 3),
        is_parent: true,
        is_household_admin: false,
        email: partnerEmail.trim().toLowerCase() || null,
      })

      if (memberError) throw new Error(t.errors.couldNotAddMember)

      // If email provided, add to allowed_emails so they can log in
      if (partnerEmail.trim()) {
        await supabase.from('allowed_emails').upsert({
          email: partnerEmail.trim().toLowerCase(),
          can_create_household: false,
          invited_by_household_id: householdId,
        }, { onConflict: 'email' })
      }

      setStep('done')
    } catch (err) {
      console.error('Save partner error:', err)
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

  // User cannot create household
  if (!canCreate) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center animate-fade-in">
        <div className="w-full max-w-md rounded-2xl p-8 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'rgba(126, 182, 196, 0.2)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold font-display mb-2" style={{ color: 'var(--foreground)' }}>
            {t.wizard.waitingForInvite}
          </h1>
          <p className="mb-6" style={{ color: 'var(--muted)' }}>
            {t.wizard.waitingForInviteDesc}
          </p>
          <button onClick={() => router.push('/')} className="btn btn-secondary">
            {t.wizard.backToHome}
          </button>
        </div>
      </div>
    )
  }

  // Progress indicator
  const steps = ['household', 'children', 'partner', 'done'] as const
  const currentIndex = steps.indexOf(step)

  return (
    <div className="min-h-[60vh] flex items-center justify-center animate-fade-in py-8">
      <div className="w-full max-w-lg">
        {/* Progress bar */}
        {step !== 'done' && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-1.5 w-16 rounded-full transition-colors"
                style={{ background: i <= currentIndex ? 'var(--accent)' : 'var(--sand)' }}
              />
            ))}
          </div>
        )}

        <div className="rounded-2xl p-8" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          {error && (
            <div className="mb-6 p-4 rounded-xl text-sm" style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}>
              {error}
            </div>
          )}

          {/* Step 1: Household */}
          {step === 'household' && (
            <>
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'rgba(229, 185, 94, 0.2)' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                </div>
                <h1 className="text-2xl font-semibold font-display mb-2" style={{ color: 'var(--foreground)' }}>
                  {t.wizard.welcome}
                </h1>
                <p style={{ color: 'var(--muted)' }}>{t.wizard.welcomeSubtitle}</p>
              </div>

              <form onSubmit={createHousehold} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                    {t.wizard.householdName} *
                  </label>
                  <input
                    type="text"
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                    placeholder={t.wizard.householdNamePlaceholder}
                    className="input"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                    {t.wizard.yourName} *
                  </label>
                  <input
                    type="text"
                    value={myName}
                    onChange={(e) => setMyName(e.target.value)}
                    placeholder="F.eks. Mor eller Kari"
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                    {t.wizard.yourBirthDate} <span style={{ color: 'var(--muted)', fontWeight: 'normal' }}>({t.common.optional})</span>
                  </label>
                  <input
                    type="date"
                    value={myBirthDate}
                    onChange={(e) => setMyBirthDate(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                    {t.wizard.yourAllergies} <span style={{ color: 'var(--muted)', fontWeight: 'normal' }}>({t.common.optional})</span>
                  </label>
                  <input
                    type="text"
                    value={myAllergies}
                    onChange={(e) => setMyAllergies(e.target.value)}
                    placeholder={t.wizard.allergiesPlaceholder}
                    className="input"
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    {t.wizard.allergiesHint}
                  </p>
                </div>
                <button type="submit" disabled={saving || !householdName.trim() || !myName.trim()} className="btn btn-primary w-full">
                  {saving ? t.common.creating : t.common.next}
                </button>
              </form>
            </>
          )}

          {/* Step 2: Children */}
          {step === 'children' && (
            <>
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'rgba(126, 182, 196, 0.2)' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <h1 className="text-2xl font-semibold font-display mb-2" style={{ color: 'var(--foreground)' }}>
                  {t.wizard.addChildren}
                </h1>
                <p style={{ color: 'var(--muted)' }}>{t.wizard.addChildrenSubtitle}</p>
              </div>

              {/* Added children list */}
              {children.length > 0 && (
                <div className="space-y-2 mb-6">
                  {children.map((child, i) => {
                    const colorConfig = CHILD_COLORS.find(c => c.value === child.color)
                    const age = child.birth_date ? Math.floor((Date.now() - new Date(child.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null
                    return (
                      <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--sand)' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium" style={{ background: colorConfig?.bg, color: colorConfig?.text }}>
                            {child.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                              {child.name}
                              {age !== null && <span className="text-xs ml-1" style={{ color: 'var(--muted)' }}>({age} {t.wizard.yearsOld})</span>}
                            </div>
                            <div className="text-xs" style={{ color: 'var(--muted)' }}>
                              {child.location_name && `${child.location_type === 'school' ? t.settings.childLocationTypes.school : t.settings.childLocationTypes.kindergarten}: ${child.location_name}`}
                              {child.location_name && child.allergies && ' · '}
                              {child.allergies && `Allergier: ${child.allergies}`}
                            </div>
                          </div>
                        </div>
                        <button onClick={() => removeChild(i)} className="p-1 rounded" style={{ color: 'var(--muted)' }} aria-label="Fjern">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add child form */}
              <div className="space-y-4 mb-6 p-4 rounded-xl" style={{ background: 'var(--sand)' }}>
                <input
                  type="text"
                  value={newChild.name}
                  onChange={(e) => setNewChild({ ...newChild, name: e.target.value })}
                  placeholder="Barnets navn"
                  className="input"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Fødselsdato (valgfritt)</label>
                    <input
                      type="date"
                      value={newChild.birth_date}
                      onChange={(e) => setNewChild({ ...newChild, birth_date: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Allergier (valgfritt)</label>
                    <input
                      type="text"
                      value={newChild.allergies}
                      onChange={(e) => setNewChild({ ...newChild, allergies: e.target.value })}
                      placeholder="F.eks. melk, egg"
                      className="input"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={newChild.location_type}
                    onChange={(e) => setNewChild({ ...newChild, location_type: e.target.value as 'school' | 'kindergarten' })}
                    className="input"
                  >
                    <option value="kindergarten">{t.settings.childLocationTypes.kindergarten}</option>
                    <option value="school">{t.settings.childLocationTypes.school}</option>
                  </select>
                  <input
                    type="text"
                    value={newChild.location_name}
                    onChange={(e) => setNewChild({ ...newChild, location_name: e.target.value })}
                    placeholder={t.wizard.locationNamePlaceholder}
                    className="input"
                  />
                </div>
                <div className="flex gap-2">
                  {CHILD_COLORS.slice(0, 6).map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setNewChild({ ...newChild, color: color.value })}
                      className="w-8 h-8 rounded-full transition-transform"
                      style={{
                        background: color.bg,
                        border: newChild.color === color.value ? `2px solid ${color.text}` : '2px solid transparent',
                        transform: newChild.color === color.value ? 'scale(1.1)' : 'scale(1)',
                      }}
                      title={color.label}
                      aria-label={color.label}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addChild}
                  disabled={!newChild.name.trim()}
                  className="btn btn-secondary w-full"
                >
                  + {t.settings.addChild}
                </button>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep('partner')} className="btn btn-secondary flex-1">
                  {t.common.skip}
                </button>
                <button type="button" onClick={saveChildren} disabled={saving} className="btn btn-primary flex-1">
                  {saving ? t.common.saving : t.common.next}
                </button>
              </div>
            </>
          )}

          {/* Step 3: Partner */}
          {step === 'partner' && (
            <>
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'rgba(131, 166, 151, 0.2)' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/>
                    <line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                </div>
                <h1 className="text-2xl font-semibold font-display mb-2" style={{ color: 'var(--foreground)' }}>
                  {t.wizard.invitePartner}
                </h1>
                <p style={{ color: 'var(--muted)' }}>{t.wizard.invitePartnerSubtitle}</p>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                    {t.wizard.partnerName}
                  </label>
                  <input
                    type="text"
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                    placeholder={t.wizard.partnerNamePlaceholder}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                    {t.wizard.partnerEmail}
                  </label>
                  <input
                    type="email"
                    value={partnerEmail}
                    onChange={(e) => setPartnerEmail(e.target.value)}
                    placeholder={t.wizard.partnerEmailPlaceholder}
                    className="input"
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    {t.wizard.partnerEmailHint}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep('done')} className="btn btn-secondary flex-1">
                  {t.common.skip}
                </button>
                <button type="button" onClick={savePartner} disabled={saving} className="btn btn-primary flex-1">
                  {saving ? t.common.saving : t.common.finish}
                </button>
              </div>
            </>
          )}

          {/* Step 4: Done */}
          {step === 'done' && (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-6" style={{ background: 'rgba(131, 166, 151, 0.2)' }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold font-display mb-2" style={{ color: 'var(--foreground)' }}>
                {t.wizard.allDone}
              </h1>
              <p className="mb-8" style={{ color: 'var(--muted)' }}>
                {t.wizard.allDoneSubtitle}
              </p>
              <button onClick={() => router.push('/uke')} className="btn btn-primary">
                {t.wizard.goToWeekPlan}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
