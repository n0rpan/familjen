'use client'

/**
 * useAdmin Hook
 *
 * Abstracts admin data fetching for both demo and production modes.
 * Admin data includes households, allowed emails, and AI settings.
 */

import { useState, useEffect, useCallback } from 'react'
import { useDataSource } from './useDataSource'
import type { Household, AllowedEmail } from '@/lib/types'
import type { AdminHousehold } from '@/lib/demo/types'

export interface AdminHouseholdWithStats {
  id: string
  name: string | null
  memberCount: number
  childrenCount: number
  created_at: string
}

export interface UseAdminReturn {
  households: AdminHouseholdWithStats[]
  allowedEmails: AllowedEmail[]
  isAdmin: boolean
  loading: boolean
  error: string | null
  addAllowedEmail: (email: string, canCreateHousehold: boolean) => Promise<void>
  deleteAllowedEmail: (emailId: string) => Promise<void>
  refetch: () => void
}

/**
 * Hook to get admin data
 */
export function useAdmin(): UseAdminReturn {
  const { isDemo, supabase, demoState } = useDataSource()

  const [households, setHouseholds] = useState<AdminHouseholdWithStats[]>([])
  const [allowedEmails, setAllowedEmails] = useState<AllowedEmail[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (isDemo || !supabase) return

    setLoading(true)
    setError(null)

    try {
      // Check if user is admin
      const { data: adminCheck } = await supabase.rpc('is_admin')
      const userIsAdmin = adminCheck === true

      setIsAdmin(userIsAdmin)

      if (!userIsAdmin) {
        setLoading(false)
        return
      }

      // Fetch all households with member and children counts
      const { data: householdsData, error: householdsError } = await supabase
        .from('households')
        .select(`
          id,
          name,
          created_at,
          household_members(count),
          children(count)
        `)
        .order('created_at', { ascending: false })

      if (householdsError) throw householdsError

      const householdsWithStats = (householdsData || []).map(h => ({
        id: h.id,
        name: h.name,
        memberCount: h.household_members?.[0]?.count || 0,
        childrenCount: h.children?.[0]?.count || 0,
        created_at: h.created_at,
      }))

      setHouseholds(householdsWithStats)

      // Fetch allowed emails
      const { data: emailsData, error: emailsError } = await supabase
        .from('allowed_emails')
        .select('*')
        .order('created_at', { ascending: false })

      if (emailsError) throw emailsError

      setAllowedEmails(emailsData || [])
    } catch (err) {
      console.error('Error fetching admin data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }, [isDemo, supabase])

  // Initial fetch for production mode
  useEffect(() => {
    if (!isDemo) {
      fetchData()
    }
  }, [isDemo, fetchData])

  // Add allowed email mutation
  const addAllowedEmail = useCallback(async (email: string, canCreateHousehold: boolean) => {
    if (isDemo) {
      console.log('Demo mode: Would add allowed email', email)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('allowed_emails')
        .insert({
          email: email.toLowerCase(),
          can_create_household: canCreateHousehold,
        })

      await fetchData()
    } catch (err) {
      console.error('Error adding email:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Delete allowed email mutation
  const deleteAllowedEmail = useCallback(async (emailId: string) => {
    if (isDemo) {
      console.log('Demo mode: Would delete allowed email', emailId)
      return
    }

    if (!supabase) return

    try {
      await supabase
        .from('allowed_emails')
        .delete()
        .eq('id', emailId)

      await fetchData()
    } catch (err) {
      console.error('Error deleting email:', err)
      throw err
    }
  }, [isDemo, supabase, fetchData])

  // Demo mode: return demo data
  if (isDemo && demoState) {
    const demoHouseholdsWithStats = demoState.adminHouseholds.map((h: AdminHousehold) => ({
      id: h.id,
      name: h.name,
      memberCount: h.members.length,
      childrenCount: h.children.length,
      created_at: h.created_at,
    }))

    return {
      households: demoHouseholdsWithStats,
      allowedEmails: demoState.adminAllowedEmails,
      isAdmin: true, // Always admin in demo
      loading: false,
      error: null,
      addAllowedEmail,
      deleteAllowedEmail,
      refetch: () => {}, // No-op in demo
    }
  }

  return {
    households,
    allowedEmails,
    isAdmin,
    loading,
    error,
    addAllowedEmail,
    deleteAllowedEmail,
    refetch: fetchData,
  }
}
