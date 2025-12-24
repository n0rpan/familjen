'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Child, HouseholdMember, Household, AllowedEmail, ChildColor, SettingsCacheData } from '@/lib/types'
import { getCachedSettingsData, getSettingsCacheKey } from '@/lib/prefetch/fetchers'
import { setCache } from '@/lib/cache'
import { CHILD_COLORS } from '@/lib/colors'
import { User } from '@supabase/supabase-js'
import { useLanguage } from '@/lib/i18n/context'
import { LANGUAGES, type Language } from '@/lib/i18n/types'
import { NotificationSettings } from '@/components/NotificationSettings'
import { InstallPrompt } from '@/components/InstallPrompt'
import { SettingsPageSkeleton } from '@/components/Skeleton'
import { SpondIntegration } from '@/components/integrations/SpondIntegration'
import { KidplanIntegration } from '@/components/integrations/KidplanIntegration'
import { ISkoleIntegration } from '@/components/integrations/ISkoleIntegration'
import { MyKidIntegration } from '@/components/integrations/MyKidIntegration'
import { ManualSourceUrls } from '@/components/integrations/ManualSourceUrls'
import { HomeControlSection } from '@/components/integrations/HomeControlSection'
import {
  ChildrenSection,
  MembersSection,
  AIPreferencesSection,
  HouseholdAdminSection,
} from './sections'
import { SectionHeader, CollapsibleSection } from './components'

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
  const [profileForm, setProfileForm] = useState({ name: '', short_name: '', birth_date: '', work_email: '', allergies: [] as string[], ics_calendar_url: '' })
  const [savingProfile, setSavingProfile] = useState(false)
  const [newProfileAllergy, setNewProfileAllergy] = useState('')
  const [syncingICS, setSyncingICS] = useState(false)

  // Household admin features
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitedEmails, setInvitedEmails] = useState<AllowedEmail[]>([])
  const [savingInvite, setSavingInvite] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // Account deletion
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false)
  const [deleteAccountConfirmText, setDeleteAccountConfirmText] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)

  // Family calendar settings
  const [familyCalendarUrl, setFamilyCalendarUrl] = useState('')
  const [savingFamilyCalendar, setSavingFamilyCalendar] = useState(false)
  const [syncingFamilyCalendar, setSyncingFamilyCalendar] = useState(false)
  const [familyCalendarLastSync, setFamilyCalendarLastSync] = useState<string | null>(null)
  const [familyCalendarError, setFamilyCalendarError] = useState<string | null>(null)
  const [familyCalendarEventCount, setFamilyCalendarEventCount] = useState<number>(0)

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
  const [shareNamesWithAi, setShareNamesWithAi] = useState(true)
  const [savingPrivacy, setSavingPrivacy] = useState(false)
  const [connectedCalendarEmail, setConnectedCalendarEmail] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const { language, setLanguage, t } = useLanguage()

  // Track if we've shown cached data to prevent re-showing skeleton
  const hasShownCacheRef = useRef(false)
  const householdIdRef = useRef<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    // Only show skeleton if we haven't shown cached data yet
    if (!hasShownCacheRef.current) {
      setLoading(true)
    }
    setError(null)

    try {
      // Get current user first
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!currentUser) {
        router.push('/login')
        return
      }
      setUser(currentUser)

      // Find user's household via their membership (works for admins who can see multiple households)
      let { data: myMembership } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', currentUser.id)
        .single()

      // If no membership by user_id, try to claim a pending invite via RPC
      // This handles the case where user navigates to settings before hitting home page
      if (!myMembership) {
        const { data: claimedInvite } = await supabase
          .rpc('claim_invite_for_current_user')

        if (claimedInvite && claimedInvite.length > 0) {
          myMembership = {
            household_id: claimedInvite[0].household_id
          }
        }
      }

      if (!myMembership) {
        // No household - redirect to create page
        router.push('/ny-husstand')
        return
      }

      // Store household ID for cache key
      householdIdRef.current = myMembership.household_id

      // Check cache first - show cached data immediately if available
      if (!hasShownCacheRef.current) {
        const cached = await getCachedSettingsData(myMembership.household_id)
        if (cached) {
          // Populate state from cache instantly
          setHousehold(cached.household)
          setMembers(cached.members)
          setChildren(cached.children)
          setMyProfile(cached.myProfile)
          setConnectedCalendarEmail(cached.connectedCalendarEmail)
          setInvitedEmails(cached.invitedEmails)

          // Set profile form from cached myProfile
          if (cached.myProfile) {
            setProfileForm({
              name: cached.myProfile.name,
              short_name: cached.myProfile.short_name || '',
              birth_date: cached.myProfile.birth_date || '',
              work_email: cached.myProfile.work_email || '',
              allergies: cached.myProfile.allergies || [],
              ics_calendar_url: cached.myProfile.ics_calendar_url || '',
            })
          }

          // Set AI context from cached household
          if (cached.household) {
            setAiMealContext(cached.household.ai_meal_context || '')
            setShareNamesWithAi(cached.household.share_names_with_ai ?? true)
            setFamilyCalendarUrl(cached.household.ics_calendar_url || '')
            setFamilyCalendarLastSync(cached.household.ics_last_sync_at || null)
            setFamilyCalendarError(cached.household.ics_sync_error || null)
          }

          hasShownCacheRef.current = true
          setLoading(false)
          // Continue fetching fresh data in background...
        }
      }

      // Now get the household by ID (exclude encrypted fields)
      const { data: householdData, error: householdError } = await supabase
        .from('households')
        .select('id, name, ai_meal_context, share_names_with_ai, external_integrations_enabled, created_at, ics_calendar_url, ics_last_sync_at, ics_sync_error')
        .eq('id', myMembership.household_id)
        .single()

      if (householdError || !householdData) {
        throw new Error(t.errors.couldNotLoadHousehold)
      }

      setHousehold(householdData)
      setAiMealContext(householdData?.ai_meal_context || '')
      setShareNamesWithAi(householdData?.share_names_with_ai ?? true)

      // Initialize family calendar settings
      setFamilyCalendarUrl(householdData?.ics_calendar_url || '')
      setFamilyCalendarLastSync(householdData?.ics_last_sync_at || null)
      setFamilyCalendarError(householdData?.ics_sync_error || null)

      // Load members and children FIRST - they're at the top of the page now
      // Fetch in parallel for performance
      const [membersResult, childrenResult] = await Promise.all([
        supabase.from('household_members').select('*').eq('household_id', myMembership.household_id).order('is_parent', { ascending: false }).order('name'),
        supabase.from('children').select('*').eq('household_id', myMembership.household_id).order('sort_order'),
      ])

      if (membersResult.error) throw new Error(t.errors.couldNotLoadMembers)
      if (childrenResult.error) throw new Error(t.errors.couldNotLoadChildren)

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
          ics_calendar_url: myMember.ics_calendar_url || '',
        })
      }

      // Variables to store fresh data for cache
      let freshInvitedEmails: AllowedEmail[] = []
      let freshCalendarEmail: string | null = null

      // If household admin, load admin-specific data (lower priority - admin section at bottom)
      if (myMember?.is_household_admin && householdData) {
        // Fetch these in parallel - both needed for admin section
        const [emailsResult, eventCountResult, calendarEmailResult] = await Promise.all([
          supabase
            .from('allowed_emails')
            .select('*')
            .eq('invited_by_household_id', householdData.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('household_events')
            .select('*', { count: 'exact', head: true })
            .eq('household_id', householdData.id),
          supabase.rpc('get_connected_calendar_email'),
        ])

        freshInvitedEmails = emailsResult.data || []
        setInvitedEmails(freshInvitedEmails)
        setFamilyCalendarEventCount(eventCountResult.count || 0)
        if (!calendarEmailResult.error) {
          freshCalendarEmail = calendarEmailResult.data || null
          setConnectedCalendarEmail(freshCalendarEmail)
        }
      } else {
        // Non-admins still need calendar email for the hint
        const { data: calendarEmail, error: calError } = await supabase.rpc('get_connected_calendar_email')
        if (!calError) {
          freshCalendarEmail = calendarEmail || null
          setConnectedCalendarEmail(freshCalendarEmail)
        }
      }

      // Update cache with fresh data
      if (householdIdRef.current && householdData) {
        const cacheKey = getSettingsCacheKey(householdIdRef.current)
        const cacheData: SettingsCacheData = {
          household: householdData,
          members: membersResult.data || [],
          children: childrenResult.data || [],
          myProfile: myMember || null,
          connectedCalendarEmail: freshCalendarEmail,
          invitedEmails: freshInvitedEmails,
          timestamp: Date.now(),
        }
        setCache(cacheKey, cacheData).catch(() => {
          // Ignore cache errors
        })
      }
    } catch (err) {
      console.error('Settings page error:', err)
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  // Profile editing (optimistic update)
  const saveProfile = async () => {
    if (!myProfile) return

    const previousProfile = myProfile
    const previousMembers = members
    const updatedProfile = {
      ...myProfile,
      name: profileForm.name,
      short_name: profileForm.short_name || null,
      birth_date: profileForm.birth_date || null,
      work_email: profileForm.work_email || null,
      allergies: profileForm.allergies,
      ics_calendar_url: profileForm.ics_calendar_url || null,
    }

    // Optimistic update
    setMyProfile(updatedProfile)
    setMembers(members.map(m => m.id === myProfile.id ? updatedProfile : m))
    setEditingProfile(false)
    setNewProfileAllergy('')

    setSavingProfile(true)
    const { error } = await supabase
      .from('household_members')
      .update({
        name: profileForm.name,
        short_name: profileForm.short_name || null,
        birth_date: profileForm.birth_date || null,
        work_email: profileForm.work_email || null,
        allergies: profileForm.allergies,
        ics_calendar_url: profileForm.ics_calendar_url || null,
      })
      .eq('id', myProfile.id)

    if (error) {
      // Rollback on error
      setMyProfile(previousProfile)
      setMembers(previousMembers)
      setEditingProfile(true)
      console.error('Error saving profile:', error)
      showMessage('error', t.errors.saveFailed + ': ' + error.message)
    } else {
      showMessage('success', t.success.saved)
    }
    setSavingProfile(false)
  }

  // Helper functions for profile allergies
  const addProfileAllergy = () => {
    if (!newProfileAllergy.trim()) return
    if (profileForm.allergies.includes(newProfileAllergy.trim())) {
      showMessage('error', t.errors.invalidInput)
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

  // Sync ICS calendar
  const syncICSCalendar = async () => {
    if (!myProfile?.ics_calendar_url) return

    setSyncingICS(true)
    try {
      const response = await fetch('/api/calendar/ics-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: myProfile.id }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Sync failed')
      }

      const result = await response.json()
      if (result.results?.[0]?.success) {
        showMessage('success', `Synkroniserte ${result.results[0].eventsCount} hendelser`)
        // Reload to get updated sync status
        await loadData()
      } else if (result.results?.[0]?.error) {
        throw new Error(result.results[0].error)
      } else {
        showMessage('success', 'Kalendersynk fullført')
        await loadData()
      }
    } catch (error) {
      console.error('ICS sync error:', error)
      showMessage('error', error instanceof Error ? error.message : 'Kunne ikke synkronisere kalender')
    } finally {
      setSyncingICS(false)
    }
  }

  // Validate ICS URL format
  const isValidIcsUrl = (url: string): boolean => {
    if (!url.trim()) return true // Empty is valid (clears the URL)
    try {
      const testUrl = url.trim().replace(/^webcal:\/\//i, 'https://')
      const parsed = new URL(testUrl)
      // Must use https:// or webcal://
      if (!['https:', 'webcals:'].includes(parsed.protocol) && !url.toLowerCase().startsWith('webcal://')) {
        return false
      }
      // Basic check for .ics extension or calendar paths
      const path = parsed.pathname.toLowerCase()
      const isCalendarUrl = path.endsWith('.ics') ||
        path.includes('calendar') ||
        path.includes('ical') ||
        parsed.hostname.includes('calendar') ||
        parsed.hostname.includes('google')
      return isCalendarUrl || path.length > 1 // Allow if it has a path
    } catch {
      return false
    }
  }

  // Save family calendar URL
  const saveFamilyCalendar = async () => {
    if (!household) return

    const trimmedUrl = familyCalendarUrl.trim()

    // Validate URL format before saving
    if (trimmedUrl && !isValidIcsUrl(trimmedUrl)) {
      setFamilyCalendarError(t.errors.invalidUrl || 'Ugyldig kalender-URL. Bruk https:// eller webcal://')
      showMessage('error', t.errors.invalidUrl || 'Ugyldig kalender-URL')
      return
    }

    setSavingFamilyCalendar(true)
    setFamilyCalendarError(null)

    try {
      const { error } = await supabase
        .from('households')
        .update({ ics_calendar_url: trimmedUrl || null })
        .eq('id', household.id)

      if (error) throw error

      showMessage('success', t.success.saved)

      // If URL was cleared, reset sync status
      if (!trimmedUrl) {
        setFamilyCalendarLastSync(null)
      }
    } catch (error) {
      console.error('Save family calendar error:', error)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSavingFamilyCalendar(false)
    }
  }

  // Sync family calendar
  const syncFamilyCalendar = async () => {
    if (!household?.id || !familyCalendarUrl) return

    setSyncingFamilyCalendar(true)
    setFamilyCalendarError(null)

    try {
      const response = await fetch('/api/calendar/household-ics-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdId: household.id }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || t.errors.saveFailed)
      }

      if (result.success) {
        const successMsg = t.success.syncedEvents?.replace('{count}', String(result.eventsCount)) ||
          `Synkroniserte ${result.eventsCount} familiehendelser`
        showMessage('success', successMsg)
        setFamilyCalendarLastSync(new Date().toISOString())
        setFamilyCalendarError(null)
        setFamilyCalendarEventCount(result.eventsCount || 0)
      } else if (result.error) {
        setFamilyCalendarError(result.error)
        throw new Error(result.error)
      } else {
        showMessage('success', t.success.saved)
        setFamilyCalendarLastSync(new Date().toISOString())
      }
    } catch (error) {
      console.error('Family calendar sync error:', error)
      const errorMessage = error instanceof Error ? error.message : t.errors.saveFailed
      setFamilyCalendarError(errorMessage)
      showMessage('error', errorMessage)
    } finally {
      setSyncingFamilyCalendar(false)
    }
  }

  // Invite user to household (avoid full reload)
  const inviteUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim() || !household) return

    setSavingInvite(true)
    const { data, error } = await supabase
      .from('allowed_emails')
      .insert({
        email: inviteEmail.toLowerCase().trim(),
        invited_by_household_id: household.id,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        showMessage('error', t.admin.emailExists)
      } else {
        showMessage('error', t.errors.saveFailed)
      }
    } else if (data) {
      setInvitedEmails([data, ...invitedEmails])
      showMessage('success', t.success.emailAdded)
      setInviteEmail('')
    }
    setSavingInvite(false)
  }

  // Remove invite (optimistic update)
  const removeInvite = async (emailId: string) => {
    if (!confirm(t.common.confirmDelete)) return

    const previousEmails = invitedEmails
    setInvitedEmails(invitedEmails.filter(e => e.id !== emailId))

    const { error } = await supabase
      .from('allowed_emails')
      .delete()
      .eq('id', emailId)

    if (error) {
      setInvitedEmails(previousEmails)
      showMessage('error', t.errors.deleteFailed)
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
      showMessage('error', t.errors.deleteFailed)
    } else {
      // Redirect to home after deletion
      window.location.href = '/'
    }
  }

  // Delete my account
  const deleteMyAccount = async () => {
    const confirmWord = language === 'nb' ? 'SLETT' : language === 'sv' ? 'RADERA' : 'DELETE'
    if (deleteAccountConfirmText !== confirmWord) return

    setDeletingAccount(true)
    try {
      const { error } = await supabase.rpc('delete_my_account')

      if (error) {
        console.error('Delete account error:', error)
        showMessage('error', t.errors.deleteFailed)
        return
      }

      // Sign out and redirect to login
      await supabase.auth.signOut()
      window.location.href = '/login'
    } catch (err) {
      console.error('Delete account error:', err)
      showMessage('error', t.errors.generic)
    } finally {
      setDeletingAccount(false)
    }
  }

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMember.name || !household) return

    setSaving(true)
    const emailToAdd = newMember.email?.toLowerCase().trim() || null

    // Create the member
    const { data, error } = await supabase.from('household_members').insert({
      household_id: household.id,
      name: newMember.name,
      short_name: newMember.short_name || newMember.name.substring(0, 3),
      is_parent: newMember.is_parent,
      email: emailToAdd,
      birth_date: newMember.birth_date || null,
      work_email: newMember.work_email || null,
    }).select().single()

    if (error) {
      if (error.code === '23505' && error.message.includes('email')) {
        showMessage('error', t.admin.emailExists)
      } else {
        showMessage('error', t.errors.couldNotAddMember)
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

    if (data) {
      setMembers([...members, data])
    }
    setNewMember({ name: '', short_name: '', is_parent: false, email: '', birth_date: '', work_email: '' })
    showMessage('success', t.success.memberAdded)
    setSaving(false)
  }

  const deleteMember = async (id: string) => {
    if (!confirm(t.common.confirmDelete)) return

    const previousMembers = members
    setMembers(members.filter(m => m.id !== id))

    const { error } = await supabase.from('household_members').delete().eq('id', id)
    if (error) {
      setMembers(previousMembers)
      showMessage('error', t.errors.deleteFailed)
    }
  }

  const addChild = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newChild.name || !household) return

    setSaving(true)
    const { data, error } = await supabase.from('children').insert({
      household_id: household.id,
      name: newChild.name,
      location_name: newChild.location_name || null,
      location_type: newChild.location_type,
      sort_order: children.length,
      birth_date: newChild.birth_date || null,
      color: newChild.color,
    }).select().single()

    if (error) {
      showMessage('error', t.errors.couldNotAddChild)
    } else if (data) {
      setChildren([...children, data])
      setNewChild({ name: '', location_name: '', location_type: 'kindergarten', birth_date: '', color: 'sky' })
      showMessage('success', t.success.childAdded)
    }
    setSaving(false)
  }

  const updateChildColor = async (childId: string, color: ChildColor) => {
    const previousChildren = children
    setChildren(children.map(c => c.id === childId ? { ...c, color } : c))

    const { error } = await supabase
      .from('children')
      .update({ color })
      .eq('id', childId)

    if (error) {
      setChildren(previousChildren)
      showMessage('error', t.errors.saveFailed)
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

    const previousChildren = children
    const updatedChild = children.find(c => c.id === editingChildId)
    if (!updatedChild) return

    // Optimistic update
    setChildren(children.map(c => c.id === editingChildId ? {
      ...c,
      name: editingChildForm.name,
      location_name: editingChildForm.location_name || null,
      location_type: editingChildForm.location_type,
      birth_date: editingChildForm.birth_date || null,
      color: editingChildForm.color,
      allergies: editingChildForm.allergies,
    } : c))
    setEditingChildId(null)

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
      // Rollback on error
      setChildren(previousChildren)
      setEditingChildId(editingChildId)
      console.error('Error updating child:', error)
      showMessage('error', t.errors.saveFailed + ': ' + error.message)
    } else {
      showMessage('success', t.success.saved)
    }
    setSaving(false)
  }

  const addAllergyToForm = () => {
    if (!newAllergy.trim()) return
    if (editingChildForm.allergies.includes(newAllergy.trim())) {
      showMessage('error', t.errors.invalidInput)
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
      showMessage('error', t.errors.saveFailed)
    } else {
      showMessage('success', t.success.saved)
    }
    setSavingAiContext(false)
  }

  const toggleShareNamesWithAi = async () => {
    if (!household) return

    const newValue = !shareNamesWithAi
    // Optimistic update
    setShareNamesWithAi(newValue)

    setSavingPrivacy(true)
    const { error } = await supabase
      .from('households')
      .update({ share_names_with_ai: newValue })
      .eq('id', household.id)

    if (error) {
      // Rollback on error
      setShareNamesWithAi(!newValue)
      showMessage('error', t.errors.saveFailed)
    } else {
      showMessage('success', t.success.saved)
    }
    setSavingPrivacy(false)
  }

  const deleteChild = async (id: string) => {
    if (!confirm(t.common.confirmDelete)) return

    const previousChildren = children
    setChildren(children.filter(c => c.id !== id))

    const { error } = await supabase.from('children').delete().eq('id', id)
    if (error) {
      setChildren(previousChildren)
      showMessage('error', t.errors.deleteFailed)
    }
  }

  if (loading) {
    return <SettingsPageSkeleton />
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
            {t.settings.tryReloadPage}
          </p>
          <button onClick={loadData} className="btn btn-primary">
            {t.common.retry}
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
          {t.settings.title}
        </h1>
        <p className="mt-2" style={{ color: 'var(--muted)' }}>
          {t.settings.subtitle}
        </p>
      </div>

      {/* Toast message */}
      {message && (
        <div
          className="fixed z-50 px-5 py-3 rounded-xl shadow-lg animate-slide-up left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm"
          style={{
            top: 'max(1rem, env(safe-area-inset-top, 0px) + 0.5rem)',
            background: message.type === 'success' ? 'var(--color-sage)' : 'var(--color-coral)',
            color: 'white',
          }}
        >
          {message.text}
        </div>
      )}

      {/* ========== GROUP 1: FAMILY ========== */}
      <SectionHeader
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        }
        title={t.settings.familyTitle || 'Familie'}
        description={t.settings.familyDesc || 'Administrer barn og husstandsmedlemmer'}
        color="var(--color-honey)"
      />

      {/* Children */}
      <ChildrenSection
        children={children}
        editingChildId={editingChildId}
        editingChildForm={editingChildForm}
        newChild={newChild}
        newAllergy={newAllergy}
        saving={saving}
        t={t}
        onEditingChildFormChange={setEditingChildForm}
        onNewChildChange={setNewChild}
        onNewAllergyChange={setNewAllergy}
        onStartEdit={startEditChild}
        onCancelEdit={cancelEditChild}
        onSaveEdit={saveEditingChild}
        onAddChild={addChild}
        onDeleteChild={deleteChild}
        onAddAllergy={addAllergyToForm}
        onRemoveAllergy={removeAllergyFromForm}
      />

      {/* Household Members */}
      <MembersSection
        members={members}
        newMember={newMember}
        saving={saving}
        t={t}
        onNewMemberChange={setNewMember}
        onAddMember={addMember}
        onDeleteMember={deleteMember}
      />

      {/* ========== GROUP 2: MY SETTINGS ========== */}
      <SectionHeader
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        }
        title={t.settings.mySettingsTitle || 'Mine innstillinger'}
        description={t.settings.mySettingsDesc || 'Personlige preferanser og profil'}
        color="var(--color-sky)"
      />

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
                  {t.settings.profile}
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
                {t.common.edit}
              </button>
            )}
          </div>

          {editingProfile ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.memberName}</label>
                  <input
                    type="text"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.memberShortName}</label>
                  <input
                    type="text"
                    value={profileForm.short_name}
                    onChange={(e) => setProfileForm({ ...profileForm, short_name: e.target.value })}
                    className="input"
                    placeholder={t.settings.shortNamePlaceholder}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.memberBirthDate}</label>
                  <input
                    type="date"
                    value={profileForm.birth_date}
                    onChange={(e) => setProfileForm({ ...profileForm, birth_date: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.memberWorkEmail}</label>
                  <input
                    type="email"
                    value={profileForm.work_email}
                    onChange={(e) => setProfileForm({ ...profileForm, work_email: e.target.value })}
                    className="input"
                    placeholder={t.settings.workEmailPlaceholder}
                  />
                </div>
              </div>

              {/* ICS Calendar URL */}
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                  Kalender-URL (ICS)
                </label>
                <input
                  type="url"
                  value={profileForm.ics_calendar_url}
                  onChange={(e) => setProfileForm({ ...profileForm, ics_calendar_url: e.target.value })}
                  className="input"
                  placeholder="https://outlook.office365.com/owa/calendar/..."
                />
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Publiser kalenderen din som ICS-fil for å vise møter i ukeoversikten
                </p>
              </div>

              {/* Allergies section */}
              <div>
                <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>{t.settings.memberAllergies}</label>
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
                        aria-label={t.common.remove}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </span>
                  ))}
                  {profileForm.allergies.length === 0 && (
                    <span className="text-sm" style={{ color: 'var(--muted)' }}>{t.settings.noAllergies}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={t.settings.allergyPlaceholder}
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
                    {t.settings.addAllergy}
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={saveProfile}
                  disabled={savingProfile || !profileForm.name}
                  className="btn btn-primary"
                >
                  {savingProfile ? t.common.saving : t.common.save}
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
                      ics_calendar_url: myProfile.ics_calendar_url || '',
                    })
                  }}
                  className="btn btn-secondary"
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.settings.memberName}</p>
                  <p className="font-medium" style={{ color: 'var(--foreground)' }}>{myProfile.name}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.settings.memberShortName}</p>
                  <p className="font-medium" style={{ color: 'var(--foreground)' }}>{myProfile.short_name || '-'}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.settings.memberBirthDate}</p>
                  <p className="font-medium" style={{ color: 'var(--foreground)' }}>{myProfile.birth_date || '-'}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.settings.memberWorkEmail}</p>
                  <p className="font-medium truncate" style={{ color: 'var(--foreground)' }}>{myProfile.work_email || '-'}</p>
                </div>
              </div>

              {/* Allergies display */}
              <div className="mt-4">
                <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>{t.settings.memberAllergies}</p>
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
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.settings.noRegistered}</p>
                )}
              </div>

              {/* ICS Calendar display */}
              {myProfile.ics_calendar_url && (
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Kalender-URL (ICS)</p>
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)', maxWidth: '300px' }}>
                        {myProfile.ics_calendar_url.replace(/https?:\/\//, '').split('/')[0]}
                      </p>
                      {myProfile.ics_last_sync_at && (
                        <p className="text-xs mt-1" style={{ color: 'var(--color-sage)' }}>
                          Sist synkronisert: {new Date(myProfile.ics_last_sync_at).toLocaleString('nb-NO')}
                        </p>
                      )}
                      {myProfile.ics_sync_error && (
                        <p className="text-xs mt-1" style={{ color: 'var(--color-coral)' }}>
                          Feil: {myProfile.ics_sync_error}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={syncICSCalendar}
                      disabled={syncingICS}
                      className="btn btn-secondary text-sm"
                    >
                      {syncingICS ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                          </svg>
                          Synkroniserer...
                        </span>
                      ) : (
                        'Synk nå'
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {myProfile.is_household_admin && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <span className="badge badge-honey">{t.settings.householdAdminBadge}</span>
            </div>
          )}
        </section>
      )}

      {/* Calendar Sync Hint */}
      {connectedCalendarEmail && (
        <section
          className="rounded-2xl p-6"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(229, 185, 94, 0.2)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div>
              <h3 className="font-medium" style={{ color: 'var(--foreground)' }}>
                {t.settings?.calendarSyncHint || 'Automatisk kalendersynk'}
              </h3>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                {t.settings?.calendarSyncDesc || 'Send kalenderinvitasjoner til denne adressen for å automatisk legge dem til i familieplanen:'}
              </p>
              <div
                className="mt-2 px-3 py-2 rounded-lg text-sm font-mono inline-block"
                style={{ background: 'var(--background)', color: 'var(--foreground)' }}
              >
                {connectedCalendarEmail}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ========== GROUP 3: INTEGRATIONS ========== */}
      {household?.external_integrations_enabled && (
        <>
          <SectionHeader
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            }
            title={t.settings.integrationsTitle || 'Integrasjoner'}
            description={t.settings.integrationsDesc || 'Koble til eksterne tjenester'}
            color="var(--color-sage)"
          />

          {/* Spond Integration */}
          <CollapsibleSection
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            }
            title="Spond"
            description="Synkroniser hendelser og meldinger fra Spond"
            color="var(--color-sky)"
          >
            <SpondIntegration
              householdId={household.id}
              children={children}
              members={members}
              onMessage={showMessage}
            />
          </CollapsibleSection>

          {/* Kidplan Integration */}
          <CollapsibleSection
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            }
            title="Kidplan"
            description="Synkroniser meldinger og bilder fra barnehagen"
            color="var(--color-sage)"
          >
            <KidplanIntegration
              householdId={household.id}
              children={children}
              onMessage={showMessage}
            />
          </CollapsibleSection>

          {/* iSkole Integration */}
          <CollapsibleSection
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                <path d="M6 12v5c3 3 9 3 12 0v-5"/>
              </svg>
            }
            title="iSkole"
            description="Synkroniser meldinger og timeplan fra skolen"
            color="var(--color-sky)"
          >
            <ISkoleIntegration
              householdId={household.id}
              children={children}
              onMessage={showMessage}
            />
          </CollapsibleSection>

          {/* MyKid Integration */}
          <CollapsibleSection
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
              </svg>
            }
            title="MyKid"
            description="Synkroniser kalender, nyhetsbrev og bilder fra barnehagen"
            color="var(--color-sage)"
          >
            <MyKidIntegration
              householdId={household.id}
              children={children}
              onMessage={showMessage}
            />
          </CollapsibleSection>

          {/* Manual Source URLs */}
          <CollapsibleSection
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            }
            title="Kalenderkilder"
            description="Legg til eksterne kalendere og skoleruter"
            color="var(--color-lavender)"
          >
            <ManualSourceUrls
              householdId={household.id}
              children={children}
              onMessage={showMessage}
            />
          </CollapsibleSection>

          {/* Home Control (Somfy) */}
          <CollapsibleSection
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
            }
            title="Smarthus"
            description="Styr screens og persienner via Somfy TaHoma"
            color="var(--color-honey)"
          >
            <HomeControlSection
              householdId={household.id}
              onMessage={showMessage}
            />
          </CollapsibleSection>
        </>
      )}

      {/* Notification Settings */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(232, 120, 109, 0.2)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              {t.notifications?.title || 'Varsler'}
            </h2>
          </div>
        </div>
        <NotificationSettings />
      </section>

      {/* Install App */}
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              {t.install?.title || 'Installer app'}
            </h2>
          </div>
        </div>
        <InstallPrompt />
      </section>

      {/* Language Settings */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(178, 154, 198, 0.2)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-lavender)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              {t.settings.language}
            </h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {t.settings.selectLanguage}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={async () => {
                setLanguage(lang.code)
                // Also save to database if user has a profile
                if (myProfile?.id) {
                  await supabase
                    .from('household_members')
                    .update({ language_preference: lang.code })
                    .eq('id', myProfile.id)
                }
                showMessage('success', t.success.saved)
              }}
              className="flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-200 hover:scale-[1.02]"
              style={{
                background: language === lang.code ? 'var(--accent)' : 'var(--background)',
                color: language === lang.code ? 'white' : 'var(--foreground)',
                border: `1px solid ${language === lang.code ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              <span className="text-xl">{lang.flag}</span>
              <span className="font-medium">{lang.name}</span>
              {language === lang.code && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20,6 9,17 4,12"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Account Section - Delete Account */}
      <section
        className="rounded-2xl p-6 md:p-8"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(232, 120, 109, 0.2)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
              <line x1="18" y1="11" x2="18" y2="17"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              {t.account?.title || 'Konto'}
            </h2>
          </div>
        </div>

        {!showDeleteAccountConfirm ? (
          <div>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              {t.account?.deleteAccountDesc || 'Fjerner deg fra husstanden og sletter dine data'}
            </p>
            <button
              onClick={() => setShowDeleteAccountConfirm(true)}
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-coral)' }}
            >
              {t.account?.deleteAccount || 'Slett min konto'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className="p-4 rounded-xl"
              style={{ background: 'rgba(232, 120, 109, 0.1)' }}
            >
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-coral)' }}>
                {t.account?.deleteAccount || 'Slett min konto'}
              </p>
              <ul className="text-sm space-y-1" style={{ color: 'var(--muted)' }}>
                <li>• {t.account?.deleteAccountWarning1 || 'Fjerne deg fra husstanden'}</li>
                <li>• {t.account?.deleteAccountWarning2 || 'Slette alle dine personlige data'}</li>
                <li>• {t.account?.deleteAccountWarning3 || 'Logge deg ut permanent'}</li>
              </ul>
            </div>
            <div>
              <label className="block text-sm mb-2" style={{ color: 'var(--foreground)' }}>
                {t.account?.deleteAccountConfirm || `Skriv "${language === 'nb' ? 'SLETT' : language === 'sv' ? 'RADERA' : 'DELETE'}" for å bekrefte:`}
              </label>
              <input
                type="text"
                value={deleteAccountConfirmText}
                onChange={(e) => setDeleteAccountConfirmText(e.target.value)}
                className="input"
                placeholder={language === 'nb' ? 'SLETT' : language === 'sv' ? 'RADERA' : 'DELETE'}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteAccountConfirm(false)
                  setDeleteAccountConfirmText('')
                }}
                className="btn btn-secondary"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={deleteMyAccount}
                disabled={deletingAccount || deleteAccountConfirmText !== (language === 'nb' ? 'SLETT' : language === 'sv' ? 'RADERA' : 'DELETE')}
                className="btn text-white disabled:opacity-50"
                style={{ background: 'var(--color-coral)' }}
              >
                {deletingAccount ? t.common.loading : (t.account?.deleteAccountButton || 'Slett konto')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ========== GROUP 4: AI PREFERENCES ========== */}
      <SectionHeader
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
            <circle cx="8" cy="14" r="2"/>
            <circle cx="16" cy="14" r="2"/>
          </svg>
        }
        title={t.settings.aiPreferencesTitle || 'AI-preferanser'}
        description={t.settings.aiPreferencesDesc || 'Tilpass AI-assistenten for din familie'}
        color="var(--color-lavender)"
      />

      <AIPreferencesSection
        shareNamesWithAi={shareNamesWithAi}
        savingPrivacy={savingPrivacy}
        aiMealContext={aiMealContext}
        savingAiContext={savingAiContext}
        t={t}
        onToggleShareNames={toggleShareNamesWithAi}
        onAiContextChange={setAiMealContext}
        onSaveAiContext={saveAiContext}
      />

      {/* ========== GROUP 5: ADMINISTRATION (Admin only) ========== */}
      {myProfile?.is_household_admin && (
        <>
          <SectionHeader
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            }
            title={t.settings.administrationTitle || 'Administrasjon'}
            description={t.settings.administrationDesc || 'Husstandsinnstillinger og tilgang'}
            color="var(--color-coral)"
          />

          <HouseholdAdminSection
            household={household}
            inviteEmail={inviteEmail}
            invitedEmails={invitedEmails}
            savingInvite={savingInvite}
            familyCalendarUrl={familyCalendarUrl}
            savingFamilyCalendar={savingFamilyCalendar}
            syncingFamilyCalendar={syncingFamilyCalendar}
            familyCalendarLastSync={familyCalendarLastSync}
            familyCalendarError={familyCalendarError}
            familyCalendarEventCount={familyCalendarEventCount}
            showDeleteConfirm={showDeleteConfirm}
            deleteConfirmText={deleteConfirmText}
            language={language}
            t={t}
            onInviteEmailChange={setInviteEmail}
            onInviteUser={inviteUser}
            onRemoveInvite={removeInvite}
            onFamilyCalendarUrlChange={setFamilyCalendarUrl}
            onSaveFamilyCalendar={saveFamilyCalendar}
            onSyncFamilyCalendar={syncFamilyCalendar}
            onShowDeleteConfirmChange={setShowDeleteConfirm}
            onDeleteConfirmTextChange={setDeleteConfirmText}
            onDeleteHousehold={deleteHousehold}
          />
        </>
      )}
    </div>
  )
}
