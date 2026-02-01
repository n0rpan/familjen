'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { HouseholdMember } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'

// Toast types
export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface RealtimeToast {
  id: string
  message: string
  type: ToastType
  timestamp: number
}

// API key name cache entry
interface ApiKeyName {
  id: string
  name: string
}

// Context value
interface RealtimeContextValue {
  householdId: string | null
  currentUserId: string | null
  members: HouseholdMember[]
  apiKeyNames: ApiKeyName[]
  toasts: RealtimeToast[]
  showToast: (message: string, type?: ToastType) => void
  dismissToast: (id: string) => void
  getMemberName: (memberId: string | null | undefined) => string
  getChangerName: (updatedBy: string | null | undefined, apiKeyId: string | null | undefined) => string
  isOwnChange: (updatedBy: string | null | undefined) => boolean
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

interface RealtimeProviderProps {
  children: React.ReactNode
  householdId: string | null
  currentUserId: string | null
  initialMembers?: HouseholdMember[]
}

const TOAST_DURATION = 4000 // Auto-dismiss after 4 seconds
const MAX_TOASTS = 3 // Maximum visible toasts

export function RealtimeProvider({
  children,
  householdId,
  currentUserId,
  initialMembers = [],
}: RealtimeProviderProps) {
  const [toasts, setToasts] = useState<RealtimeToast[]>([])
  const [members, setMembers] = useState<HouseholdMember[]>(initialMembers)
  const [apiKeyNames, setApiKeyNames] = useState<ApiKeyName[]>([])
  const toastIdRef = useRef(0)
  const supabase = useMemo(() => createClient(), [])
  const { t } = useLanguage()

  // Fetch members if not provided and householdId exists
  useEffect(() => {
    if (!householdId || initialMembers.length > 0) return

    const fetchMembers = async () => {
      const { data } = await supabase
        .from('household_members')
        .select('*')
        .eq('household_id', householdId)

      if (data) {
        setMembers(data)
      }
    }

    fetchMembers()
  }, [householdId, initialMembers.length, supabase])

  // Fetch API key names for the household (for realtime attribution)
  useEffect(() => {
    if (!householdId) return

    const fetchApiKeyNames = async () => {
      const { data } = await supabase
        .from('household_api_keys')
        .select('id, name')
        .eq('household_id', householdId)
        .is('revoked_at', null)  // Active keys have null revoked_at

      if (data) {
        setApiKeyNames(data)
      }
    }

    fetchApiKeyNames()
  }, [householdId, supabase])

  // Generate unique toast ID
  const generateToastId = useCallback(() => {
    toastIdRef.current += 1
    return `toast-${toastIdRef.current}-${Date.now()}`
  }, [])

  // Show a toast notification
  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const newToast: RealtimeToast = {
      id: generateToastId(),
      message,
      type,
      timestamp: Date.now(),
    }

    setToasts(prev => {
      // Add new toast and limit to MAX_TOASTS
      const updated = [newToast, ...prev].slice(0, MAX_TOASTS)
      return updated
    })

    // Auto-dismiss after duration
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== newToast.id))
    }, TOAST_DURATION)
  }, [generateToastId])

  // Dismiss a specific toast
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // Get member name by ID
  const getMemberName = useCallback((memberId: string | null | undefined): string => {
    if (!memberId) return t.common.someone
    const member = members.find(m => m.id === memberId)
    return member?.short_name || member?.name || t.common.someone
  }, [members, t.common.someone])

  // Get the name of who made a change (supports both members and API keys)
  const getChangerName = useCallback((
    updatedBy: string | null | undefined,
    apiKeyId: string | null | undefined
  ): string => {
    // If change was made via API key, show API key name
    if (apiKeyId) {
      const apiKey = apiKeyNames.find(k => k.id === apiKeyId)
      return apiKey?.name || t.common.aiAssistant
    }
    // Otherwise fall back to member name
    return getMemberName(updatedBy)
  }, [apiKeyNames, getMemberName, t.common.aiAssistant])

  // Check if a change was made by the current user
  const isOwnChange = useCallback((updatedBy: string | null | undefined): boolean => {
    if (!currentUserId || !updatedBy) return false
    // Check both user_id match and if the updatedBy matches current user's member ID
    const currentMember = members.find(m => m.user_id === currentUserId)
    return updatedBy === currentUserId || (currentMember !== undefined && updatedBy === currentMember.id)
  }, [currentUserId, members])

  const value: RealtimeContextValue = {
    householdId,
    currentUserId,
    members,
    apiKeyNames,
    toasts,
    showToast,
    dismissToast,
    getMemberName,
    getChangerName,
    isOwnChange,
  }

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  )
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext)
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider')
  }
  return context
}

// Helper hook that only returns a no-op if not in provider (for optional usage)
export function useRealtimeOptional(): RealtimeContextValue | null {
  return useContext(RealtimeContext)
}
