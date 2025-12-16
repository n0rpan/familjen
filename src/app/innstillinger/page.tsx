'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Child, HouseholdMember, Household, AllowedEmail, ChildColor } from '@/lib/types'
import { CHILD_COLORS } from '@/lib/colors'
import { User } from '@supabase/supabase-js'

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Current user's profile
  const [myProfile, setMyProfile] = useState<HouseholdMember | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({ name: '', short_name: '', birth_date: '', work_email: '', allergies: [] as string[] })
  const [savingProfile, setSavingProfile] = useState(false)
  const [newProfileAllergy, setNewProfileAllergy] = useState('')

  // Household admin features
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitedEmails, setInvitedEmails] = useState<AllowedEmail[]>([])
  const [savingInvite, setSavingInvite] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // New item forms
  const [newMember, setNewMember] = useState({ name: '', short_name: '', is_parent: false, email: '', birth_date: '', work_email: '' })
  const [newChild, setNewChild] = useState<{ name: string; location_name: string; location_type: 'school' | 'kindergarten'; birth_date: string; color: ChildColor }>({
    name: '',
    location_name: '',
    location_type: 'kindergarten',
    birth_date: '',
    color: 'sky',
  })

  // Editing child
  const [editingChildId, setEditingChildId] = useState<string | null>(null)
  const [editingChildForm, setEditingChildForm] = useState<{
    name: string
    location_name: string
    location_type: 'school' | 'kindergarten'
    birth_date: string
    color: ChildColor
    allergies: string[]
  }>({
    name: '',
    location_name: '',
    location_type: 'kindergarten',
    birth_date: '',
    color: 'sky',
    allergies: [],
  })
  const [newAllergy, setNewAllergy] = useState('')

  const [aiMealContext, setAiMealContext] = useState('')
  const [savingAiContext, setSavingAiContext] = useState(false)

  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      // Get or create household
      let { data: householdData, error: householdError } = await supabase
        .from('households')
        .select('*')
        .single()

      if (householdError && householdError.code !== 'PGRST116') {
        // PGRST116 = no rows returned, which is ok for new users
        throw new Error('Kunne ikke laste husstand')
      }

      if (!householdData) {
        // No household - redirect to create page (which enforces can_create_household)
        router.push('/ny-husstand')
        return
      }

      setHousehold(householdData)
      setAiMealContext(householdData?.ai_meal_context || '')

      // Get current user
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      setUser(currentUser)

      // Load members and children
      const [membersResult, childrenResult] = await Promise.all([
        supabase.from('household_members').select('*').order('is_parent', { ascending: false }).order('name'),
        supabase.from('children').select('*').order('sort_order'),
      ])

      if (membersResult.error) throw new Error('Kunne ikke laste familiemedlemmer')
      if (childrenResult.error) throw new Error('Kunne ikke laste barn')

      setMembers(membersResult.data || [])
      setChildren(childrenResult.data || [])

      // Find current user's profile
      const myMember = (membersResult.data || []).find(m => m.user_id === currentUser?.id)
      setMyProfile(myMember || null)
      if (myMember) {
        setProfileForm({
          name: myMember.name,
          short_name: myMember.short_name || '',
          birth_date: myMember.birth_date || '',
          work_email: myMember.work_email || '',
          allergies: myMember.allergies || [],
        })
      }

      // If household admin, load invited emails
      if (myMember?.is_household_admin && householdData) {
        const { data: emailsData } = await supabase
          .from('allowed_emails')
          .select('*')
          .eq('invited_by_household_id', householdData.id)
          .order('created_at', { ascending: false })
        setInvitedEmails(emailsData || [])
      }
    } catch (err) {
      console.error('Settings page error:', err)
      setError(err instanceof Error ? err.message : 'En feil oppstod')
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  // Profile editing
  const saveProfile = async () => {
    if (!myProfile) return

    setSavingProfile(true)
    const { error } = await supabase
      .from('household_members')
      .update({
        name: profileForm.name,
        short_name: profileForm.short_name || null,
        birth_date: profileForm.birth_date || null,
        work_email: profileForm.work_email || null,
        allergies: profileForm.allergies,
      })
      .eq('id', myProfile.id)

    if (error) {
      console.error('Error saving profile:', error)
      showMessage('error', 'Kunne ikke lagre profil: ' + error.message)
    } else {
      showMessage('success', 'Profil lagret!')
      setEditingProfile(false)
      setNewProfileAllergy('')
      loadData()
    }
    setSavingProfile(false)
  }

  // Helper functions for profile allergies
  const addProfileAllergy = () => {
    if (!newProfileAllergy.trim()) return
    if (profileForm.allergies.includes(newProfileAllergy.trim())) {
      showMessage('error', 'Allergien er allerede lagt til')
      return
    }
    setProfileForm({
      ...profileForm,
      allergies: [...profileForm.allergies, newProfileAllergy.trim()],
    })
    setNewProfileAllergy('')
  }

  const removeProfileAllergy = (allergy: string) => {
    setProfileForm({
      ...profileForm,
      allergies: profileForm.allergies.filter(a => a !== allergy),
    })
  }

  // Invite user to household
  const inviteUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim() || !household) return

    setSavingInvite(true)
    const { error } = await supabase
      .from('allowed_emails')
      .insert({
        email: inviteEmail.toLowerCase().trim(),
        invited_by_household_id: household.id,
      })

    if (error) {
      if (error.code === '23505') {
        showMessage('error', 'Denne e-posten er allerede invitert')
      } else {
        showMessage('error', 'Kunne ikke invitere bruker')
      }
    } else {
      showMessage('success', 'Invitasjon sendt!')
      setInviteEmail('')
      loadData()
    }
    setSavingInvite(false)
  }

  // Remove invite
  const removeInvite = async (emailId: string) => {
    if (!confirm('Er du sikker på at du vil fjerne denne invitasjonen?')) return

    const { error } = await supabase
      .from('allowed_emails')
      .delete()
      .eq('id', emailId)

    if (error) {
      showMessage('error', 'Kunne ikke fjerne invitasjon')
    } else {
      loadData()
    }
  }

  // Delete household
  const deleteHousehold = async () => {
    if (!household || deleteConfirmText !== household.name) return

    const { error } = await supabase
      .from('households')
      .delete()
      .eq('id', household.id)

    if (error) {
      showMessage('error', 'Kunne ikke slette husstand')
    } else {
      // Redirect to home after deletion
      window.location.href = '/'
    }
  }

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMember.name || !household) return

    setSaving(true)
    const emailToAdd = newMember.email?.toLowerCase().trim() || null

    // Create the member
    const { error } = await supabase.from('household_members').insert({
      household_id: household.id,
      name: newMember.name,
      short_name: newMember.short_name || newMember.name.substring(0, 3),
      is_parent: newMember.is_parent,
      email: emailToAdd,
      birth_date: newMember.birth_date || null,
      work_email: newMember.work_email || null,
    })

    if (error) {
      if (error.code === '23505' && error.message.includes('email')) {
        showMessage('error', 'Denne e-posten er allerede i bruk')
      } else {
        showMessage('error', 'Kunne ikke legge til medlem')
      }
      setSaving(false)
      return
    }

    // If email provided, also add to allowed_emails for login access
    if (emailToAdd) {
      const { error: emailError } = await supabase.from('allowed_emails').insert({
        email: emailToAdd,
        invited_by_household_id: household.id,
      })

      if (emailError && emailError.code !== '23505') {
        // Ignore duplicate error (email already in allowed_emails)
        console.error('Could not add to allowed_emails:', emailError)
      }
    }

    setNewMember({ name: '', short_name: '', is_parent: false, email: '', birth_date: '', work_email: '' })
    loadData()
    showMessage('success', emailToAdd ? `${newMember.name} lagt til og invitert!` : 'Medlem lagt til!')
    setSaving(false)
  }

  const deleteMember = async (id: string) => {
    if (!confirm('Er du sikker på at du vil slette dette medlemmet?')) return

    const { error } = await supabase.from('household_members').delete().eq('id', id)
    if (error) {
      showMessage('error', 'Kunne ikke slette medlem')
    } else {
      loadData()
    }
  }

  const addChild = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newChild.name || !household) return

    setSaving(true)
    const { error } = await supabase.from('children').insert({
      household_id: household.id,
      name: newChild.name,
      location_name: newChild.location_name || null,
      location_type: newChild.location_type,
      sort_order: children.length,
      birth_date: newChild.birth_date || null,
      color: newChild.color,
    })

    if (error) {
      showMessage('error', 'Kunne ikke legge til barn')
    } else {
      setNewChild({ name: '', location_name: '', location_type: 'kindergarten', birth_date: '', color: 'sky' })
      loadData()
      showMessage('success', 'Barn lagt til!')
    }
    setSaving(false)
  }

  const updateChildColor = async (childId: string, color: ChildColor) => {
    const { error } = await supabase
      .from('children')
      .update({ color })
      .eq('id', childId)

    if (error) {
      showMessage('error', 'Kunne ikke oppdatere farge')
    } else {
      loadData()
    }
  }

  const startEditChild = (child: Child) => {
    setEditingChildId(child.id)
    setEditingChildForm({
      name: child.name,
      location_name: child.location_name || '',
      location_type: child.location_type || 'kindergarten',
      birth_date: child.birth_date || '',
      color: child.color,
      allergies: child.allergies || [],
    })
    setNewAllergy('')
  }

  const cancelEditChild = () => {
    setEditingChildId(null)
    setNewAllergy('')
  }

  const saveEditingChild = async () => {
    if (!editingChildId || !editingChildForm.name) return

    setSaving(true)
    const { error } = await supabase
      .from('children')
      .update({
        name: editingChildForm.name,
        location_name: editingChildForm.location_name || null,
        location_type: editingChildForm.location_type,
        birth_date: editingChildForm.birth_date || null,
        color: editingChildForm.color,
        allergies: editingChildForm.allergies,
      })
      .eq('id', editingChildId)

    if (error) {
      console.error('Error updating child:', error)
      showMessage('error', 'Kunne ikke oppdatere barn: ' + error.message)
    } else {
      showMessage('success', 'Barn oppdatert!')
      setEditingChildId(null)
      loadData()
    }
    setSaving(false)
  }

  const addAllergyToForm = () => {
    if (!newAllergy.trim()) return
    if (editingChildForm.allergies.includes(newAllergy.trim())) {
      showMessage('error', 'Allergien er allerede lagt til')
      return
    }
    setEditingChildForm({
      ...editingChildForm,
      allergies: [...editingChildForm.allergies, newAllergy.trim()],
    })
    setNewAllergy('')
  }

  const removeAllergyFromForm = (allergy: string) => {
    setEditingChildForm({
      ...editingChildForm,
      allergies: editingChildForm.allergies.filter(a => a !== allergy),
    })
  }

  const saveAiContext = async () => {
    if (!household) return

    setSavingAiContext(true)
    const { error } = await supabase
      .from('households')
      .update({ ai_meal_context: aiMealContext || null })
      .eq('id', household.id)

    if (error) {
      showMessage('error', 'Kunne ikke lagre AI-preferanser')
    } else {
      showMessage('success', 'AI-preferanser lagret!')
    }
    setSavingAiContext(false)
  }

  const deleteChild = async (id: string) => {
    if (!confirm('Er du sikker på at du vil slette dette barnet?')) return

    const { error } = await supabase.from('children').delete().eq('id', id)
    if (error) {
      showMessage('error', 'Kunne ikke slette barn')
    } else {
      loadData()
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 rounded-xl w-48" style={{ background: 'var(--sand)' }} />
        <div className="h-64 rounded-2xl" style={{ background: 'var(--sand)' }} />
        <div className="h-64 rounded-2xl" style={{ background: 'var(--sand)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-8 animate-fade-in">
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
            style={{ background: 'rgba(232, 120, 109, 0.15)' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h2 className="text-2xl font-semibold font-display mb-3" style={{ color: 'var(--foreground)' }}>
            {error}
          </h2>
          <p className="mb-8" style={{ color: 'var(--muted)' }}>
            Prøv å laste siden på nytt.
          </p>
          <button onClick={loadData} className="btn btn-primary">
            Prøv igjen
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          Innstillinger
        </h1>
        <p className="mt-2" style={{ color: 'var(--muted)' }}>
          Administrer familien din
        </p>
      </div>

      {/* Toast message */}
      {message && (
        <div
          className="fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg animate-slide-up"
          style={{
            background: message.type === 'success' ? 'var(--color-sage)' : 'var(--color-coral)',
            color: 'white',
          }}
        >
          {message.text}
        </div>
      )}

      {/* My Profile */}
      {myProfile && (
        <section
          className="rounded-2xl p-6 md:p-8"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(126, 182, 196, 0.2)' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
                  Min profil
                </h2>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  {user?.email}
                </p>
              </div>
            </div>
            {!editingProfile && (
              <button
                onClick={() => setEditingProfile(true)}
                className="btn btn-secondary text-sm"
              >
                Rediger
              </button>
            )}
          </div>

          {editingProfile ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Navn</label>
                  <input
                    type="text"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Kortnavn</label>
                  <input
                    type="text"
                    value={profileForm.short_name}
                    onChange={(e) => setProfileForm({ ...profileForm, short_name: e.target.value })}
                    className="input"
                    placeholder="F.eks. Far"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Fødselsdato</label>
                  <input
                    type="date"
                    value={profileForm.birth_date}
                    onChange={(e) => setProfileForm({ ...profileForm, birth_date: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Jobb-epost (for kalender)</label>
                  <input
                    type="email"
                    value={profileForm.work_email}
                    onChange={(e) => setProfileForm({ ...profileForm, work_email: e.target.value })}
                    className="input"
                    placeholder="jobb@firma.no"
                  />
                </div>
              </div>

              {/* Allergies section */}
              <div>
                <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>Allergier / Diettrestriksjoner</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {profileForm.allergies.map((allergy) => (
                    <span
                      key={allergy}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm"
                      style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
                    >
                      {allergy}
                      <button
                        type="button"
                        onClick={() => removeProfileAllergy(allergy)}
                        className="hover:bg-red-100 rounded-full p-0.5"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </span>
                  ))}
                  {profileForm.allergies.length === 0 && (
                    <span className="text-sm" style={{ color: 'var(--muted)' }}>Ingen allergier registrert</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="F.eks. nøtter, melk, gluten..."
                    value={newProfileAllergy}
                    onChange={(e) => setNewProfileAllergy(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addProfileAllergy()
                      }
                    }}
                    className="input"
                    style={{ flex: '1 1 auto', minWidth: 0 }}
                  />
                  <button
                    type="button"
                    onClick={addProfileAllergy}
                    disabled={!newProfileAllergy.trim()}
                    className="btn btn-secondary"
                  >
                    + Legg til
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={saveProfile}
                  disabled={savingProfile || !profileForm.name}
                  className="btn btn-primary"
                >
                  {savingProfile ? 'Lagrer...' : 'Lagre'}
                </button>
                <button
                  onClick={() => {
                    setEditingProfile(false)
                    setNewProfileAllergy('')
                    setProfileForm({
                      name: myProfile.name,
                      short_name: myProfile.short_name || '',
                      birth_date: myProfile.birth_date || '',
                      work_email: myProfile.work_email || '',
                      allergies: myProfile.allergies || [],
                    })
                  }}
                  className="btn btn-secondary"
                >
                  Avbryt
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Navn</p>
                  <p className="font-medium" style={{ color: 'var(--foreground)' }}>{myProfile.name}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Kortnavn</p>
                  <p className="font-medium" style={{ color: 'var(--foreground)' }}>{myProfile.short_name || '-'}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Fødselsdato</p>
                  <p className="font-medium" style={{ color: 'var(--foreground)' }}>{myProfile.birth_date || '-'}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Jobb-epost</p>
                  <p className="font-medium truncate" style={{ color: 'var(--foreground)' }}>{myProfile.work_email || '-'}</p>
                </div>
              </div>

              {/* Allergies display */}
              <div className="mt-4">
                <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>Allergier</p>
                {myProfile.allergies && myProfile.allergies.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {myProfile.allergies.map((allergy) => (
                      <span
                        key={allergy}
                        className="text-xs px-2 py-1 rounded-full"
                        style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
                      >
                        {allergy}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>Ingen registrert</p>
                )}
              </div>
            </>
          )}

          {myProfile.is_household_admin && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <span className="badge badge-honey">Husstandsadmin</span>
            </div>
          )}
        </section>
      )}

      {/* Household Admin Panel */}
      {myProfile?.is_household_admin && (
        <section
          className="rounded-2xl p-6 md:p-8"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(229, 185, 94, 0.2)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
                Administrer husstand
              </h2>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                Inviter medlemmer og administrer husstanden
              </p>
            </div>
          </div>

          {/* Invite form */}
          <form onSubmit={inviteUser} className="mb-6">
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Inviter ny bruker
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="epost@eksempel.no"
                className="input"
                style={{ flex: '1 1 auto', minWidth: 0 }}
                required
              />
              <button
                type="submit"
                disabled={savingInvite || !inviteEmail.trim()}
                className="btn btn-primary"
              >
                {savingInvite ? 'Sender...' : 'Inviter'}
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              Personen vil kunne logge inn og bli med i husstanden din
            </p>
          </form>

          {/* Invited emails list */}
          {invitedEmails.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>
                Inviterte brukere
              </p>
              <div className="space-y-2">
                {invitedEmails.map((email) => (
                  <div
                    key={email.id}
                    className="flex items-center justify-between p-3 rounded-xl"
                    style={{ background: 'var(--background)' }}
                  >
                    <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                      {email.email}
                    </span>
                    <button
                      onClick={() => removeInvite(email.id)}
                      className="p-1 rounded hover:bg-red-50 transition-colors"
                      style={{ color: 'var(--muted)' }}
                      title="Fjern invitasjon"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Delete household */}
          <div className="pt-6" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-coral)' }}>
              Faresone
            </p>
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="btn text-sm"
                style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
              >
                Slett husstand
              </button>
            ) : (
              <div className="p-4 rounded-xl" style={{ background: 'rgba(232, 120, 109, 0.1)', border: '1px solid var(--color-coral)' }}>
                <p className="text-sm mb-3" style={{ color: 'var(--foreground)' }}>
                  <strong>Advarsel:</strong> Dette vil slette hele husstanden, inkludert alle medlemmer, barn, oppskrifter, og data. Denne handlingen kan ikke angres.
                </p>
                <p className="text-sm mb-3" style={{ color: 'var(--foreground)' }}>
                  Skriv &quot;<strong>{household?.name}</strong>&quot; for å bekrefte:
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={household?.name || ''}
                  className="input mb-3"
                />
                <div className="flex gap-2">
                  <button
                    onClick={deleteHousehold}
                    disabled={deleteConfirmText !== household?.name}
                    className="btn"
                    style={{
                      background: deleteConfirmText === household?.name ? 'var(--color-coral)' : 'var(--muted)',
                      color: 'white',
                    }}
                  >
                    Slett permanent
                  </button>
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false)
                      setDeleteConfirmText('')
                    }}
                    className="btn btn-secondary"
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Household Members */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(232, 120, 109, 0.15)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              Familiemedlemmer
            </h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Personer som kan hente barna
            </p>
          </div>
        </div>

        {/* Existing members */}
        <div className="space-y-2 mb-6">
          {members.length === 0 ? (
            <p className="text-center py-8" style={{ color: 'var(--muted)' }}>
              Ingen medlemmer ennå
            </p>
          ) : (
            members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 rounded-xl transition-colors"
                style={{ background: 'var(--background)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                    style={{
                      background: member.is_parent ? 'var(--color-coral)' : 'var(--color-sage)',
                      color: 'white',
                    }}
                  >
                    {member.short_name || member.name.substring(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                        {member.name}
                      </span>
                      {member.is_parent && (
                        <span className="badge badge-coral">Forelder</span>
                      )}
                      {member.user_id ? (
                        <span className="badge badge-sage">Aktiv</span>
                      ) : member.email ? (
                        <span className="badge badge-honey">Invitert</span>
                      ) : null}
                    </div>
                    {member.email && (
                      <span className="text-sm" style={{ color: 'var(--muted)' }}>
                        {member.email}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteMember(member.id)}
                  className="p-2 rounded-lg transition-colors hover:bg-red-50"
                  style={{ color: 'var(--muted)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3,6 5,6 21,6"/>
                    <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add new member form */}
        <form onSubmit={addMember} className="pt-6" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-sm font-medium mb-4" style={{ color: 'var(--foreground)' }}>
            Legg til nytt medlem
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <input
              type="text"
              placeholder="Navn (f.eks. Bestemor)"
              value={newMember.name}
              onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
              className="input"
              required
            />
            <input
              type="text"
              placeholder="Kortnavn (f.eks. B.mor)"
              value={newMember.short_name}
              onChange={(e) => setNewMember({ ...newMember, short_name: e.target.value })}
              className="input"
            />
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                Privat e-post (for innlogging)
              </label>
              <input
                type="email"
                placeholder="navn@gmail.com"
                value={newMember.email}
                onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                className="input"
              />
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                Gir tilgang til husstanden
              </p>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Fødselsdato (valgfritt)</label>
              <input
                type="date"
                value={newMember.birth_date}
                onChange={(e) => setNewMember({ ...newMember, birth_date: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Jobb-epost (for kalender)</label>
              <input
                type="email"
                placeholder="navn@firma.no"
                value={newMember.work_email}
                onChange={(e) => setNewMember({ ...newMember, work_email: e.target.value })}
                className="input"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newMember.is_parent}
                onChange={(e) => setNewMember({ ...newMember, is_parent: e.target.checked })}
                className="w-5 h-5 rounded"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="text-sm" style={{ color: 'var(--foreground)' }}>Er forelder</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--sand)', color: 'var(--muted)' }}>
                Vises som hovedkontakt
              </span>
            </label>
            <button
              type="submit"
              disabled={saving || !newMember.name}
              className="btn btn-primary ml-auto"
            >
              + Legg til
            </button>
          </div>
        </form>
      </section>

      {/* Children */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(126, 182, 196, 0.2)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 14c0-4-3.5-6-7-6s-7 2-7 6v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4Z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              Barn
            </h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Legg til barna med barnehage/skole
            </p>
          </div>
        </div>

        {/* Existing children */}
        <div className="space-y-3 mb-6">
          {children.length === 0 ? (
            <p className="text-center py-8" style={{ color: 'var(--muted)' }}>
              Ingen barn lagt til ennå
            </p>
          ) : (
            children.map((child) => {
              const colorConfig = CHILD_COLORS.find(c => c.value === child.color) || CHILD_COLORS[0]
              const isEditing = editingChildId === child.id

              if (isEditing) {
                const editColor = CHILD_COLORS.find(c => c.value === editingChildForm.color) || CHILD_COLORS[0]
                return (
                  <div
                    key={child.id}
                    className="p-4 rounded-xl space-y-4"
                    style={{ background: 'var(--background)', border: '2px solid var(--accent)' }}
                  >
                    {/* Edit header */}
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-semibold"
                        style={{ background: editColor.bg, color: editColor.text }}
                      >
                        {editingChildForm.name.charAt(0) || '?'}
                      </div>
                      <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                        Rediger {child.name}
                      </span>
                    </div>

                    {/* Edit form */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Navn *</label>
                        <input
                          type="text"
                          value={editingChildForm.name}
                          onChange={(e) => setEditingChildForm({ ...editingChildForm, name: e.target.value })}
                          className="input"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Sted</label>
                        <input
                          type="text"
                          placeholder="Barnehage/skole navn"
                          value={editingChildForm.location_name}
                          onChange={(e) => setEditingChildForm({ ...editingChildForm, location_name: e.target.value })}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Fødselsdato</label>
                        <input
                          type="date"
                          value={editingChildForm.birth_date}
                          onChange={(e) => setEditingChildForm({ ...editingChildForm, birth_date: e.target.value })}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Type</label>
                        <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                          <button
                            type="button"
                            onClick={() => setEditingChildForm({ ...editingChildForm, location_type: 'kindergarten' })}
                            className="flex-1 py-2 px-3 text-sm font-medium transition-colors"
                            style={{
                              background: editingChildForm.location_type === 'kindergarten' ? 'var(--color-sage)' : 'transparent',
                              color: editingChildForm.location_type === 'kindergarten' ? 'white' : 'var(--muted)',
                            }}
                          >
                            Barnehage
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingChildForm({ ...editingChildForm, location_type: 'school' })}
                            className="flex-1 py-2 px-3 text-sm font-medium transition-colors"
                            style={{
                              background: editingChildForm.location_type === 'school' ? 'var(--color-sky)' : 'transparent',
                              color: editingChildForm.location_type === 'school' ? 'white' : 'var(--muted)',
                            }}
                          >
                            Skole
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Color picker */}
                    <div>
                      <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>Farge</label>
                      <div className="flex gap-2">
                        {CHILD_COLORS.map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            onClick={() => setEditingChildForm({ ...editingChildForm, color: color.value })}
                            className="w-8 h-8 rounded-full transition-all"
                            style={{
                              background: color.bg,
                              border: editingChildForm.color === color.value ? `3px solid ${color.text}` : '3px solid transparent',
                              transform: editingChildForm.color === color.value ? 'scale(1.1)' : 'scale(1)',
                            }}
                            title={color.label}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Allergies */}
                    <div>
                      <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>Allergier / Diettrestriksjoner</label>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {editingChildForm.allergies.map((allergy) => (
                          <span
                            key={allergy}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm"
                            style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
                          >
                            {allergy}
                            <button
                              type="button"
                              onClick={() => removeAllergyFromForm(allergy)}
                              className="hover:bg-red-100 rounded-full p-0.5"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </span>
                        ))}
                        {editingChildForm.allergies.length === 0 && (
                          <span className="text-sm" style={{ color: 'var(--muted)' }}>Ingen allergier registrert</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="F.eks. nøtter, melk, gluten..."
                          value={newAllergy}
                          onChange={(e) => setNewAllergy(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addAllergyToForm()
                            }
                          }}
                          className="input"
                          style={{ flex: '1 1 auto', minWidth: 0 }}
                        />
                        <button
                          type="button"
                          onClick={addAllergyToForm}
                          disabled={!newAllergy.trim()}
                          className="btn btn-secondary"
                        >
                          + Legg til
                        </button>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={saveEditingChild}
                        disabled={saving || !editingChildForm.name}
                        className="btn btn-primary"
                      >
                        {saving ? 'Lagrer...' : 'Lagre'}
                      </button>
                      <button
                        onClick={cancelEditChild}
                        className="btn btn-secondary"
                      >
                        Avbryt
                      </button>
                      <button
                        onClick={() => {
                          cancelEditChild()
                          deleteChild(child.id)
                        }}
                        className="btn ml-auto"
                        style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
                      >
                        Slett
                      </button>
                    </div>
                  </div>
                )
              }

              // View mode
              return (
                <div
                  key={child.id}
                  className="p-4 rounded-xl transition-colors cursor-pointer hover:shadow-md"
                  style={{ background: 'var(--background)' }}
                  onClick={() => startEditChild(child)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-semibold"
                        style={{ background: colorConfig.bg, color: colorConfig.text }}
                      >
                        {child.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                            {child.name}
                          </span>
                          {child.birth_date && (
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--sand)', color: 'var(--muted)' }}>
                              {new Date(child.birth_date).toLocaleDateString('nb-NO')}
                            </span>
                          )}
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              background: child.location_type === 'school' ? 'rgba(126, 182, 196, 0.2)' : 'rgba(131, 166, 151, 0.2)',
                              color: child.location_type === 'school' ? 'var(--color-sky)' : 'var(--color-sage)',
                            }}
                          >
                            {child.location_type === 'school' ? 'Skole' : 'Barnehage'}
                          </span>
                        </div>
                        {child.location_name && (
                          <span className="text-sm" style={{ color: 'var(--muted)' }}>
                            {child.location_name}
                          </span>
                        )}
                        {child.allergies && child.allergies.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {child.allergies.map((allergy) => (
                              <span
                                key={allergy}
                                className="text-xs px-2 py-0.5 rounded-full"
                                style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
                              >
                                {allergy}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Add new child form */}
        <form onSubmit={addChild} className="pt-6" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-sm font-medium mb-4" style={{ color: 'var(--foreground)' }}>
            Legg til nytt barn
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <input
              type="text"
              placeholder="Navn"
              value={newChild.name}
              onChange={(e) => setNewChild({ ...newChild, name: e.target.value })}
              className="input"
              required
            />
            <input
              type="text"
              placeholder="Barnehage/skole navn"
              value={newChild.location_name}
              onChange={(e) => setNewChild({ ...newChild, location_name: e.target.value })}
              className="input"
            />
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Fødselsdato</label>
              <input
                type="date"
                value={newChild.birth_date}
                onChange={(e) => setNewChild({ ...newChild, birth_date: e.target.value })}
                className="input"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {/* Location type toggle */}
            <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => setNewChild({ ...newChild, location_type: 'kindergarten' })}
                className="py-2 px-4 text-sm font-medium transition-colors"
                style={{
                  background: newChild.location_type === 'kindergarten' ? 'var(--color-sage)' : 'transparent',
                  color: newChild.location_type === 'kindergarten' ? 'white' : 'var(--muted)',
                }}
              >
                Barnehage
              </button>
              <button
                type="button"
                onClick={() => setNewChild({ ...newChild, location_type: 'school' })}
                className="py-2 px-4 text-sm font-medium transition-colors"
                style={{
                  background: newChild.location_type === 'school' ? 'var(--color-sky)' : 'transparent',
                  color: newChild.location_type === 'school' ? 'white' : 'var(--muted)',
                }}
              >
                Skole
              </button>
            </div>
            {/* Color picker */}
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--muted)' }}>Farge:</span>
              <div className="flex gap-1">
                {CHILD_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => setNewChild({ ...newChild, color: color.value })}
                    className="w-6 h-6 rounded-full transition-all"
                    style={{
                      background: color.bg,
                      border: newChild.color === color.value ? `2px solid ${color.text}` : '2px solid transparent',
                      transform: newChild.color === color.value ? 'scale(1.1)' : 'scale(1)',
                    }}
                    title={color.label}
                  />
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={saving || !newChild.name}
              className="btn btn-primary ml-auto"
            >
              + Legg til
            </button>
          </div>
        </form>
      </section>

      {/* AI Meal Preferences */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(229, 185, 94, 0.2)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 10.5v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
              <path d="M12 12v2"/>
              <path d="M10 22h4"/>
              <path d="M10 18h4v4h-4z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              AI Middagsforslag
            </h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Gi AI kontekst om familiens preferanser
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Standard preferanser
            </label>
            <textarea
              value={aiMealContext}
              onChange={(e) => setAiMealContext(e.target.value)}
              placeholder="F.eks: Vi foretrekker enkle retter med få ingredienser. Barna liker ikke sterk mat. Vi prøver å spise fisk 2x i uken. Far er allergisk mot nøtter."
              rows={4}
              className="input resize-none"
            />
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              Denne informasjonen brukes når AI foreslår middager for uken.
            </p>
          </div>

          <button
            onClick={saveAiContext}
            disabled={savingAiContext}
            className="btn btn-primary"
          >
            {savingAiContext ? 'Lagrer...' : 'Lagre preferanser'}
          </button>
        </div>
      </section>
    </div>
  )
}
