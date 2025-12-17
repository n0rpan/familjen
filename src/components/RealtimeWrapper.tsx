'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RealtimeProvider } from '@/lib/realtime/context'
import { RealtimeToastContainer } from '@/components/RealtimeToast'
import type { HouseholdMember } from '@/lib/types'

interface RealtimeWrapperProps {
  children: React.ReactNode
}

export function RealtimeWrapper({ children }: RealtimeWrapperProps) {
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let mounted = true

    const loadUserContext = async () => {
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser()

        if (!mounted) return

        if (!user) {
          setIsLoaded(true)
          return
        }

        setCurrentUserId(user.id)

        // Get user's household membership
        const { data: membership } = await supabase
          .from('household_members')
          .select('household_id')
          .eq('user_id', user.id)
          .single()

        if (!mounted) return

        if (membership?.household_id) {
          setHouseholdId(membership.household_id)

          // Fetch all household members for name resolution
          const { data: membersData } = await supabase
            .from('household_members')
            .select('*')
            .eq('household_id', membership.household_id)

          if (!mounted) return

          if (membersData) {
            setMembers(membersData)
          }
        }

        setIsLoaded(true)
      } catch (error) {
        console.error('Failed to load realtime context:', error)
        if (mounted) {
          setIsLoaded(true)
        }
      }
    }

    loadUserContext()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setCurrentUserId(session.user.id)
        // Reload context on auth change
        loadUserContext()
      } else {
        setCurrentUserId(null)
        setHouseholdId(null)
        setMembers([])
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  // Always render children, but only provide realtime context when loaded
  if (!isLoaded) {
    return <>{children}</>
  }

  return (
    <RealtimeProvider
      householdId={householdId}
      currentUserId={currentUserId}
      initialMembers={members}
    >
      {children}
      <RealtimeToastContainer />
    </RealtimeProvider>
  )
}
