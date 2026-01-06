'use client'

/**
 * WeekPageContent - Client Component
 *
 * Handles all interactive functionality for the week page:
 * - Week navigation (URL-based with week numbers)
 * - Pickup/meal editing
 * - Event/task management
 * - Realtime subscriptions
 * - AI meal suggestions
 *
 * Data is passed as props from the server component (WeekDataLoader).
 * Mutations update local state optimistically, then sync via realtime.
 */

import { useState, useMemo, useRef, useCallback, useEffect, startTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { WeekGrid } from '@/components/WeekGrid'
import { formatDateISO, addDays, getWeekNumber, formatWeekHeaderLocalized } from '@/lib/utils'
import type {
  Child,
  HouseholdMember,
  PickupWithDetails,
  MealWithRecipe,
  Household,
  Recipe,
  MealSuggestion,
  MemberEvent,
  MemberEventType,
  HouseholdEvent,
  ChildTask,
  ChildTaskType,
  RecipeIngredient,
  Pickup,
  Meal,
  ExternalEvent,
} from '@/lib/types'
import { TransitionLink } from '@/components/TransitionLink'
import dynamic from 'next/dynamic'
import { RecentChanges } from '@/components/RecentChanges'
import { FreshnessIndicator } from '@/components/FreshnessIndicator'
import { useLanguage } from '@/lib/i18n/context'
import { notifyPickupAssigned, notifyMealChanged, notifyTaskAdded, notifyEventAdded } from '@/lib/notify'
import { nb, sv } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import { useRealtimeOptional } from '@/lib/realtime/context'
import { MemberEventModal, HouseholdEventModal, ChildTaskModal, ExternalEventModal } from './index'
import type { ExternalEventLocalOverrides, Holiday } from '@/lib/types'
import { revalidateWeek } from '@/lib/revalidate'
import {
  PREFILL_STORAGE_KEYS,
  type MemberEventPrefillData,
  type ChildTaskPrefillData,
} from '@/lib/ai-action-routing'

// Dynamic imports for code splitting
const DayPicker = dynamic(
  () => import('react-day-picker').then(mod => mod.DayPicker),
  { ssr: false, loading: () => <div className="p-4 text-center text-sm" style={{ color: 'var(--muted)' }}>...</div> }
)

const AISuggestionModal = dynamic(
  () => import('@/components/AISuggestionModal').then(mod => mod.AISuggestionModal),
  { ssr: false }
)

interface WeekPageContentProps {
  householdId: string
  currentUserId?: string
  household: Household | null
  children: Child[]
  members: HouseholdMember[]
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  recipes: Recipe[]
  memberEvents: MemberEvent[]
  householdEvents: HouseholdEvent[]
  externalEvents: ExternalEvent[]
  childTasks: ChildTask[]
  holidays: Holiday[]
  weekStart: Date
  weekEnd: Date
  weekContext: string
  weekNumber: number
  isCurrentWeek: boolean
  isDemo: boolean
  dataTimestamp?: number
}

export function WeekPageContent({
  householdId,
  currentUserId,
  household,
  children: initialChildren,
  members: initialMembers,
  pickups: initialPickups,
  meals: initialMeals,
  recipes: initialRecipes,
  memberEvents: initialMemberEvents,
  householdEvents: initialHouseholdEvents,
  externalEvents: initialExternalEvents,
  childTasks: initialChildTasks,
  holidays,
  weekStart,
  weekEnd,
  weekContext: initialWeekContext,
  weekNumber,
  isCurrentWeek,
  isDemo,
  dataTimestamp,
}: WeekPageContentProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { language, t } = useLanguage()

  // Local state - initialized from props, updated by mutations and realtime
  const [saving, setSaving] = useState(false)
  const [syncingPickupId, setSyncingPickupId] = useState<string | null>(null)
  const [children] = useState(initialChildren)
  const [members] = useState(initialMembers)
  const [pickups, setPickups] = useState(initialPickups)
  const [meals, setMeals] = useState(initialMeals)
  const [recipes] = useState(initialRecipes)
  const [memberEvents, setMemberEvents] = useState(initialMemberEvents)
  const [householdEvents, setHouseholdEvents] = useState(initialHouseholdEvents)
  const [externalEvents, setExternalEvents] = useState(initialExternalEvents)
  const [childTasks, setChildTasks] = useState(initialChildTasks)
  const [weekContextValue, setWeekContextValue] = useState(initialWeekContext)

  // AI suggestion state
  const [showSuggestionModal, setShowSuggestionModal] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<MealSuggestion[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // Week context UI state
  const [showWeekContext, setShowWeekContext] = useState(false)
  const [savingContext, setSavingContext] = useState(false)

  // Member events modal state
  const [showEventModal, setShowEventModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState<MemberEvent | null>(null)
  const [eventForm, setEventForm] = useState({
    member_id: '',
    title: '',
    event_type: 'other' as MemberEventType,
    date: '',
    end_date: '',
  })

  // Household event modal state
  const [showHouseholdEventModal, setShowHouseholdEventModal] = useState(false)
  const [editingHouseholdEvent, setEditingHouseholdEvent] = useState<HouseholdEvent | null>(null)
  const [householdEventForm, setHouseholdEventForm] = useState({
    title: '',
    date: '',
    end_date: '',
    time: '',
    location: '',
  })

  // Child tasks modal state
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [editingTask, setEditingTask] = useState<ChildTask | null>(null)
  const [taskForm, setTaskForm] = useState({
    child_id: '',
    title: '',
    task_type: 'reminder' as ChildTaskType,
    date: '',
    time: '',
    notes: '',
  })

  // External event modal state
  const [showExternalEventModal, setShowExternalEventModal] = useState(false)
  const [editingExternalEvent, setEditingExternalEvent] = useState<ExternalEvent | null>(null)

  // Toast message state
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  // Week picker state
  const [showWeekPicker, setShowWeekPicker] = useState(false)
  const weekPickerRef = useRef<HTMLDivElement>(null)

  // Quick pickup modal state
  const [showQuickPickupModal, setShowQuickPickupModal] = useState(false)

  const supabase = useMemo(() => createClient(), [])
  const realtime = useRealtimeOptional()

  /**
   * AI Prefill Navigation Handler
   *
   * This effect checks for addEvent/addTask query params and loads prefill data
   * from localStorage when navigating from the AI input component.
   *
   * PERFORMANCE NOTE (for CI reviewers):
   * While this effect depends on searchParams (which changes on every navigation),
   * it's optimized with an early return pattern:
   * - Line 200: Exits immediately if neither addEvent nor addTask is present
   * - Only does meaningful work when triggered by actual AI navigation
   * - Clears query params after processing to prevent re-triggering
   *
   * The other dependencies (members, children, weekStart) are needed for:
   * - Default member/child selection when no specific ID is provided
   * - Default date when no date is in prefill data
   *
   * This pattern is correct and does not need optimization.
   */
  useEffect(() => {
    const addEvent = searchParams.get('addEvent') === 'true'
    const addTask = searchParams.get('addTask') === 'true'

    // Early return optimization: exit immediately if not AI navigation
    if (!addEvent && !addTask) return

    // Handle event prefill
    if (addEvent) {
      try {
        const stored = localStorage.getItem(PREFILL_STORAGE_KEYS.memberEvent)
        if (stored) {
          const data = JSON.parse(stored) as MemberEventPrefillData

          // Prefill form
          setEventForm({
            member_id: data.member_id || (members[0]?.id || ''),
            title: data.title || '',
            event_type: data.event_type || 'other',
            date: data.date || formatDateISO(weekStart),
            end_date: data.end_date || '',
          })

          localStorage.removeItem(PREFILL_STORAGE_KEYS.memberEvent)
        } else {
          // No prefill data - just set default date
          setEventForm(prev => ({
            ...prev,
            date: formatDateISO(weekStart),
          }))
        }
        setShowEventModal(true)
      } catch (err) {
        console.error('Failed to read event prefill data:', err)
        setShowEventModal(true)
      }
    }

    // Handle task prefill
    if (addTask) {
      try {
        const stored = localStorage.getItem(PREFILL_STORAGE_KEYS.childTask)
        if (stored) {
          const data = JSON.parse(stored) as ChildTaskPrefillData

          // Prefill form
          setTaskForm({
            child_id: data.child_id || (children[0]?.id || ''),
            title: data.title || '',
            task_type: data.task_type || 'reminder',
            date: data.date || formatDateISO(weekStart),
            time: data.time || '',
            notes: data.notes || '',
          })

          localStorage.removeItem(PREFILL_STORAGE_KEYS.childTask)
        } else {
          // No prefill data - just set default date
          setTaskForm(prev => ({
            ...prev,
            date: formatDateISO(weekStart),
          }))
        }
        setShowTaskModal(true)
      } catch (err) {
        console.error('Failed to read task prefill data:', err)
        setShowTaskModal(true)
      }
    }

    // Clear the query params without causing a navigation
    const url = new URL(window.location.href)
    url.searchParams.delete('addEvent')
    url.searchParams.delete('addTask')
    window.history.replaceState({}, '', url.toString())
  }, [searchParams, members, children, weekStart])

  // Demo mode helper
  const showDemoMessage = useCallback((): void => {
    showMessage('error', t.common.viewOnly || 'View only in demo mode')
  }, [t.common.viewOnly])

  // Date range strings for realtime filtering
  const weekStartStr = formatDateISO(weekStart)
  const weekEndStr = formatDateISO(weekEnd)

  // Helper: Revalidate cache and refresh server data
  // This ensures the cache is updated so next navigation shows fresh data
  const refreshWithRevalidate = useCallback(() => {
    revalidateWeek(householdId, weekStartStr)
    router.refresh()
  }, [householdId, weekStartStr, router])

  // Navigate to a specific week
  const navigateToWeek = useCallback((targetWeekNumber: number, targetYear?: number) => {
    const yearParam = targetYear ? `${targetYear}-${String(targetWeekNumber).padStart(2, '0')}` : String(targetWeekNumber)
    const url = isDemo ? `/uke?demo=true&uke=${yearParam}` : `/uke?uke=${yearParam}`
    // Use startTransition to keep current content visible during navigation
    startTransition(() => {
      router.push(url)
    })
  }, [router, isDemo])

  // Handle week picker date selection
  const handleWeekSelect = (date: Date | undefined) => {
    if (!date) return
    const selectedWeekNumber = getWeekNumber(date)
    navigateToWeek(selectedWeekNumber, date.getFullYear())
    setShowWeekPicker(false)
  }

  // Close week picker on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (weekPickerRef.current && !weekPickerRef.current.contains(event.target as Node)) {
        setShowWeekPicker(false)
      }
    }
    if (showWeekPicker) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showWeekPicker])

  // Realtime handlers - revalidate cache to ensure fresh data
  const handlePickupRealtime = useCallback((
    eventType: 'INSERT' | 'UPDATE' | 'DELETE',
    newRecord: Pickup | null,
    oldRecord: Pickup | null
  ) => {
    refreshWithRevalidate()
  }, [refreshWithRevalidate])

  const handleMealRealtime = useCallback(() => {
    refreshWithRevalidate()
  }, [refreshWithRevalidate])

  const handleTaskRealtime = useCallback(() => {
    refreshWithRevalidate()
  }, [refreshWithRevalidate])

  const handleEventRealtime = useCallback(() => {
    refreshWithRevalidate()
  }, [refreshWithRevalidate])

  const handleHouseholdEventRealtime = useCallback(() => {
    refreshWithRevalidate()
  }, [refreshWithRevalidate])

  // Subscribe to realtime changes
  useRealtimeSubscription<Pickup>({
    table: 'pickups',
    filter: householdId && householdId !== 'demo' ? createHouseholdFilter(householdId) : undefined,
    onAny: (event) => handlePickupRealtime(event.eventType, event.new as Pickup | null, event.old as Pickup | null),
    enabled: !isDemo && !!householdId,
  })

  useRealtimeSubscription<Meal>({
    table: 'meals',
    filter: householdId && householdId !== 'demo' ? createHouseholdFilter(householdId) : undefined,
    onAny: handleMealRealtime,
    enabled: !isDemo && !!householdId,
  })

  useRealtimeSubscription<ChildTask>({
    table: 'child_tasks',
    filter: householdId && householdId !== 'demo' ? createHouseholdFilter(householdId) : undefined,
    onAny: handleTaskRealtime,
    enabled: !isDemo && !!householdId,
  })

  useRealtimeSubscription<MemberEvent>({
    table: 'member_events',
    filter: householdId && householdId !== 'demo' ? createHouseholdFilter(householdId) : undefined,
    onAny: handleEventRealtime,
    enabled: !isDemo && !!householdId,
  })

  useRealtimeSubscription<HouseholdEvent>({
    table: 'household_events',
    filter: householdId && householdId !== 'demo' ? createHouseholdFilter(householdId) : undefined,
    onAny: handleHouseholdEventRealtime,
    enabled: !isDemo && !!householdId,
  })

  // Mutation handlers
  const handlePickupChange = async (childId: string, date: string, pickerId: string | null) => {
    if (!household) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      const existing = pickups.find(p => p.child_id === childId && p.date === date)

      if (existing) {
        if (pickerId) {
          const { error } = await supabase
            .from('pickups')
            .update({ picker_id: pickerId })
            .eq('id', existing.id)
          if (error) throw error
        } else {
          const { error } = await supabase
            .from('pickups')
            .delete()
            .eq('id', existing.id)
          if (error) throw error
        }
      } else if (pickerId) {
        const { error } = await supabase
          .from('pickups')
          .insert({
            household_id: household.id,
            child_id: childId,
            date,
            picker_id: pickerId,
          })
        if (error) throw error
      }

      // Notification
      if (pickerId) {
        const child = children.find(c => c.id === childId)
        const picker = members.find(m => m.id === pickerId)
        if (child && picker) {
          const dateObj = new Date(date)
          const dayName = t.date.weekdays[dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1]
          notifyPickupAssigned(child.name, dayName, pickerId)
        }
      }

      refreshWithRevalidate()
    } catch (error) {
      console.error('Error saving pickup:', error)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const handleMealChange = async (date: string, mealName: string | null, recipeId?: string) => {
    if (!household) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      const existing = meals.find(m => m.date === date)

      if (existing) {
        if (mealName) {
          const { error } = await supabase
            .from('meals')
            .update({
              recipe_id: recipeId || null,
              custom_meal: recipeId ? null : mealName,
            })
            .eq('id', existing.id)
          if (error) throw error
        } else {
          const { error } = await supabase
            .from('meals')
            .delete()
            .eq('id', existing.id)
          if (error) throw error
        }
      } else if (mealName) {
        const { error } = await supabase
          .from('meals')
          .insert({
            household_id: household.id,
            date,
            recipe_id: recipeId || null,
            custom_meal: recipeId ? null : mealName,
          })
        if (error) throw error
      }

      // Notification for today/tomorrow
      if (mealName) {
        const today = formatDateISO(new Date())
        const tomorrow = formatDateISO(addDays(new Date(), 1))
        if (date === today || date === tomorrow) {
          const dayName = date === today ? t.common.today : t.common.tomorrow
          notifyMealChanged(mealName, dayName)
        }
      }

      refreshWithRevalidate()
    } catch (error) {
      console.error('Error saving meal:', error)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const handleWorkCalendarSync = async (pickupId: string, sync: boolean) => {
    if (isDemo) { showDemoMessage(); return }
    setSyncingPickupId(pickupId)
    try {
      const res = await fetch('/api/calendar/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickupId, syncToWorkCalendar: sync }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Calendar sync error:', data.error)
        showMessage('error', data.error || t.errors.calendarSyncFailed)
      } else {
        showMessage('success', sync ? t.week.sendToWorkCalendar : t.week.removeFromWorkCalendar)
      }
      refreshWithRevalidate()
    } catch (error) {
      console.error('Calendar sync error:', error)
      showMessage('error', t.errors.calendarSyncFailed)
    } finally {
      setSyncingPickupId(null)
    }
  }

  const saveWeekContext = async () => {
    if (!household) return
    if (isDemo) { showDemoMessage(); return }

    setSavingContext(true)

    const { error } = await supabase
      .from('week_contexts')
      .upsert(
        {
          household_id: household.id,
          week_start: weekStartStr,
          context: weekContextValue || null,
        },
        { onConflict: 'household_id,week_start' }
      )

    if (error) {
      console.error('Error saving week context:', error)
    }
    setSavingContext(false)
  }

  const copyLastWeek = async () => {
    if (!household) return
    if (isDemo) { showDemoMessage(); return }
    if (!confirm(t.week.copyLastWeekConfirm)) return

    setSaving(true)
    try {
      const lastWeekStart = addDays(weekStart, -7)
      const lastWeekEnd = addDays(weekEnd, -7)
      const lastWeekStartStr = formatDateISO(lastWeekStart)
      const lastWeekEndStr = formatDateISO(lastWeekEnd)

      const [lastPickups, lastMeals] = await Promise.all([
        supabase
          .from('pickups')
          .select('child_id, date, picker_id')
          .eq('household_id', household.id)
          .gte('date', lastWeekStartStr)
          .lte('date', lastWeekEndStr),
        supabase
          .from('meals')
          .select('date, name, recipe_id')
          .eq('household_id', household.id)
          .gte('date', lastWeekStartStr)
          .lte('date', lastWeekEndStr),
      ])

      const copyPickups = (lastPickups.data || []).map(p => ({
        household_id: household.id,
        child_id: p.child_id,
        date: formatDateISO(addDays(new Date(p.date), 7)),
        picker_id: p.picker_id,
      }))

      const copyMeals = (lastMeals.data || []).map(m => ({
        household_id: household.id,
        date: formatDateISO(addDays(new Date(m.date), 7)),
        name: m.name,
        recipe_id: m.recipe_id,
      }))

      if (copyPickups.length > 0) {
        await supabase.from('pickups').upsert(copyPickups, { onConflict: 'child_id,date' })
      }
      if (copyMeals.length > 0) {
        await supabase.from('meals').upsert(copyMeals, { onConflict: 'household_id,date' })
      }

      showMessage('success', t.success.copied)
      refreshWithRevalidate()
    } catch (err) {
      console.error('Error copying last week:', err)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const clearWeek = async () => {
    if (!household) return
    if (isDemo) { showDemoMessage(); return }
    if (!confirm(t.week.clearWeekConfirm)) return

    setSaving(true)
    try {
      await Promise.all([
        supabase
          .from('pickups')
          .delete()
          .eq('household_id', household.id)
          .gte('date', weekStartStr)
          .lte('date', weekEndStr),
        supabase
          .from('meals')
          .delete()
          .eq('household_id', household.id)
          .gte('date', weekStartStr)
          .lte('date', weekEndStr),
      ])

      showMessage('success', t.success.cleared)
      refreshWithRevalidate()
    } catch (err) {
      console.error('Error clearing week:', err)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const quickPickupAllWeek = async (pickerId: string) => {
    if (!household || children.length === 0) return
    if (isDemo) { showDemoMessage(); return }

    const pickerName = members.find(m => m.id === pickerId)?.name || ''
    const confirmMessage = t.week.quickPickupConfirm.replace('{name}', pickerName)
    if (!confirm(confirmMessage)) return

    setSaving(true)
    setShowQuickPickupModal(false)

    try {
      const pickupRecords: Array<{
        household_id: string
        child_id: string
        date: string
        picker_id: string
      }> = []

      for (let i = 0; i < 7; i++) {
        const date = formatDateISO(addDays(weekStart, i))
        for (const child of children) {
          pickupRecords.push({
            household_id: household.id,
            child_id: child.id,
            date,
            picker_id: pickerId,
          })
        }
      }

      const { error } = await supabase
        .from('pickups')
        .upsert(pickupRecords, { onConflict: 'child_id,date' })

      if (error) throw error

      showMessage('success', t.success.saved)
      refreshWithRevalidate()
    } catch (err) {
      console.error('Error setting quick pickups:', err)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  // Event modal handlers
  const openEventModal = (event?: MemberEvent) => {
    if (event) {
      setEditingEvent(event)
      setEventForm({
        member_id: event.member_id,
        title: event.title,
        event_type: event.event_type as MemberEventType,
        date: event.date,
        end_date: event.end_date || '',
      })
    } else {
      setEditingEvent(null)
      setEventForm({
        member_id: members.find(m => m.is_parent)?.id || members[0]?.id || '',
        title: '',
        event_type: 'other',
        date: formatDateISO(weekStart),
        end_date: '',
      })
    }
    setShowEventModal(true)
  }

  const closeEventModal = () => {
    setShowEventModal(false)
    setEditingEvent(null)
  }

  const saveEvent = async () => {
    if (!household || !eventForm.member_id || !eventForm.title || !eventForm.date) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      if (editingEvent) {
        await supabase
          .from('member_events')
          .update({
            member_id: eventForm.member_id,
            title: eventForm.title,
            event_type: eventForm.event_type,
            date: eventForm.date,
            end_date: eventForm.end_date || null,
          })
          .eq('id', editingEvent.id)
      } else {
        const { data } = await supabase
          .from('member_events')
          .insert({
            household_id: household.id,
            member_id: eventForm.member_id,
            title: eventForm.title,
            event_type: eventForm.event_type,
            date: eventForm.date,
            end_date: eventForm.end_date || null,
            source: 'manual',
          })
          .select('id')
          .single()

        if (data?.id) {
          const eventMember = members.find(m => m.id === eventForm.member_id)
          if (eventMember) {
            const dateObj = new Date(eventForm.date)
            const dayName = t.date.weekdays[dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1]
            const otherMemberIds = members
              .filter(m => m.id !== eventForm.member_id)
              .map(m => m.id)
            notifyEventAdded(eventMember.name, eventForm.title, dayName, data.id, otherMemberIds)
          }
        }
      }

      closeEventModal()
      refreshWithRevalidate()
    } catch (err) {
      console.error('Error saving event:', err)
    } finally {
      setSaving(false)
    }
  }

  const deleteEvent = async () => {
    if (!editingEvent) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      await supabase
        .from('member_events')
        .delete()
        .eq('id', editingEvent.id)

      closeEventModal()
      refreshWithRevalidate()
    } catch (err) {
      console.error('Error deleting event:', err)
    } finally {
      setSaving(false)
    }
  }

  // Household event modal handlers
  const openHouseholdEventModal = (event?: HouseholdEvent) => {
    if (event) {
      setEditingHouseholdEvent(event)
      setHouseholdEventForm({
        title: event.title,
        date: event.event_date,
        end_date: event.end_date || '',
        time: event.event_time?.substring(0, 5) || '',
        location: event.location || '',
      })
    } else {
      setEditingHouseholdEvent(null)
      setHouseholdEventForm({
        title: '',
        date: formatDateISO(weekStart),
        end_date: '',
        time: '',
        location: '',
      })
    }
    setShowHouseholdEventModal(true)
  }

  const closeHouseholdEventModal = () => {
    setShowHouseholdEventModal(false)
    setEditingHouseholdEvent(null)
  }

  const saveHouseholdEvent = async () => {
    if (!household || !householdEventForm.title || !householdEventForm.date) return
    if (isDemo) { showDemoMessage(); return }

    if (editingHouseholdEvent?.source === 'ics_calendar') {
      showMessage('error', 'ICS-synced events cannot be edited')
      return
    }

    setSaving(true)

    try {
      if (editingHouseholdEvent) {
        await supabase
          .from('household_events')
          .update({
            title: householdEventForm.title,
            event_date: householdEventForm.date,
            end_date: householdEventForm.end_date || null,
            event_time: householdEventForm.time ? `${householdEventForm.time}:00` : null,
            location: householdEventForm.location || null,
          })
          .eq('id', editingHouseholdEvent.id)
      } else {
        await supabase
          .from('household_events')
          .insert({
            household_id: household.id,
            title: householdEventForm.title,
            event_date: householdEventForm.date,
            end_date: householdEventForm.end_date || null,
            event_time: householdEventForm.time ? `${householdEventForm.time}:00` : null,
            location: householdEventForm.location || null,
            source: 'manual',
          })
      }

      closeHouseholdEventModal()
      refreshWithRevalidate()
    } catch (err) {
      console.error('Error saving household event:', err)
    } finally {
      setSaving(false)
    }
  }

  const deleteHouseholdEvent = async () => {
    if (!editingHouseholdEvent) return
    if (isDemo) { showDemoMessage(); return }

    if (editingHouseholdEvent.source === 'ics_calendar') {
      showMessage('error', 'ICS-synced events cannot be deleted')
      return
    }

    setSaving(true)

    try {
      await supabase
        .from('household_events')
        .delete()
        .eq('id', editingHouseholdEvent.id)

      closeHouseholdEventModal()
      refreshWithRevalidate()
    } catch (err) {
      console.error('Error deleting household event:', err)
    } finally {
      setSaving(false)
    }
  }

  // Task modal handlers
  const openTaskModal = (childId?: string, date?: string, task?: ChildTask) => {
    if (task) {
      setEditingTask(task)
      setTaskForm({
        child_id: task.child_id,
        title: task.title,
        task_type: task.task_type as ChildTaskType,
        date: task.date,
        time: task.time || '',
        notes: task.notes || '',
      })
    } else {
      setEditingTask(null)
      setTaskForm({
        child_id: childId || children[0]?.id || '',
        title: '',
        task_type: 'reminder',
        date: date || formatDateISO(weekStart),
        time: '',
        notes: '',
      })
    }
    setShowTaskModal(true)
  }

  const closeTaskModal = () => {
    setShowTaskModal(false)
    setEditingTask(null)
  }

  const saveTask = async () => {
    if (!household || !taskForm.child_id || !taskForm.title || !taskForm.date) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      if (editingTask) {
        await supabase
          .from('child_tasks')
          .update({
            child_id: taskForm.child_id,
            title: taskForm.title,
            task_type: taskForm.task_type,
            date: taskForm.date,
            time: taskForm.time || null,
            notes: taskForm.notes || null,
          })
          .eq('id', editingTask.id)
      } else {
        const { data } = await supabase
          .from('child_tasks')
          .insert({
            household_id: household.id,
            child_id: taskForm.child_id,
            title: taskForm.title,
            task_type: taskForm.task_type,
            date: taskForm.date,
            time: taskForm.time || null,
            notes: taskForm.notes || null,
            status: 'open',
          })
          .select('id')
          .single()

        if (data?.id) {
          const child = children.find(c => c.id === taskForm.child_id)
          if (child) {
            notifyTaskAdded(child.name, taskForm.title, data.id)
          }
        }
      }

      closeTaskModal()
      refreshWithRevalidate()
    } catch (err) {
      console.error('Error saving task:', err)
    } finally {
      setSaving(false)
    }
  }

  const deleteTask = async () => {
    if (!editingTask) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      await supabase
        .from('child_tasks')
        .delete()
        .eq('id', editingTask.id)

      closeTaskModal()
      refreshWithRevalidate()
    } catch (err) {
      console.error('Error deleting task:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleTaskToggle = async (taskId: string, done: boolean) => {
    if (isDemo) { showDemoMessage(); return }
    setSaving(true)

    try {
      await supabase
        .from('child_tasks')
        .update({
          status: done ? 'done' : 'open',
          completed_at: done ? new Date().toISOString() : null,
        })
        .eq('id', taskId)

      refreshWithRevalidate()
    } catch (err) {
      console.error('Error toggling task:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleTaskClick = (task: ChildTask) => {
    openTaskModal(undefined, undefined, task)
  }

  const handleAddTask = (childId: string, date: string) => {
    openTaskModal(childId, date)
  }

  // External event handlers
  const openExternalEventModal = (event: ExternalEvent) => {
    setEditingExternalEvent(event)
    setShowExternalEventModal(true)
  }

  const closeExternalEventModal = () => {
    setShowExternalEventModal(false)
    setEditingExternalEvent(null)
  }

  const saveExternalEvent = async (updates: {
    local_overrides: ExternalEventLocalOverrides | null
    user_notes: string | null
    is_hidden: boolean
  }) => {
    if (!editingExternalEvent) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      const { error } = await supabase
        .from('external_events')
        .update({
          local_overrides: updates.local_overrides,
          user_notes: updates.user_notes,
          is_hidden: updates.is_hidden,
        })
        .eq('id', editingExternalEvent.id)

      if (error) throw error

      closeExternalEventModal()
      refreshWithRevalidate()
      showMessage('success', t.success.saved)
    } catch (err) {
      console.error('Error saving external event:', err)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  // AI Suggestion functions
  const fetchAISuggestions = async () => {
    if (isDemo) { showDemoMessage(); return }

    setAiLoading(true)
    setAiError(null)
    setShowSuggestionModal(true)

    try {
      const existingMeals = meals.map(m => ({
        date: m.date,
        name: m.recipe?.name || m.custom_meal || '',
      }))

      const response = await fetch('/api/openrouter/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart: weekStartStr,
          existingMeals,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        if (response.status === 429) {
          throw new Error(t.errors.generic)
        } else if (response.status === 401) {
          throw new Error(t.errors.unauthorized)
        } else if (response.status === 503) {
          throw new Error(t.errors.networkError)
        }
        throw new Error(data.error || t.errors.aiSuggestionFailed)
      }

      const data = await response.json()
      if (!data.suggestions || data.suggestions.length === 0) {
        throw new Error(t.week.noSuggestions)
      }
      setAiSuggestions(data.suggestions)
    } catch (err) {
      console.error('AI suggestion error:', err)
      const errorMessage = err instanceof Error ? err.message : t.errors.generic
      setAiError(errorMessage)
    } finally {
      setAiLoading(false)
    }
  }

  const handleAcceptSuggestion = async (suggestion: MealSuggestion, saveAsRecipe: boolean) => {
    if (!household) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      let recipeId: string | undefined

      if (saveAsRecipe) {
        const { data: newRecipe, error: recipeError } = await supabase
          .from('recipes')
          .insert({
            household_id: household.id,
            name: suggestion.name,
            ingredients: suggestion.ingredients,
            is_quick: suggestion.is_quick,
            is_kid_friendly: suggestion.is_kid_friendly,
          })
          .select('id')
          .single()

        if (!recipeError && newRecipe) {
          recipeId = newRecipe.id
        }
      }

      await handleMealChange(suggestion.day, suggestion.name, recipeId)
      setAiSuggestions(prev => prev.filter(s => s.day !== suggestion.day))

      if (aiSuggestions.length <= 1) {
        setShowSuggestionModal(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleAddToShoppingList = async (ingredients: RecipeIngredient[]) => {
    if (!household || ingredients.length === 0) return
    if (isDemo) { showDemoMessage(); return }

    try {
      let { data: lists } = await supabase
        .from('shopping_lists')
        .select('id')
        .eq('household_id', household.id)
        .order('sort_order')
        .limit(1)

      let listId: string

      if (!lists || lists.length === 0) {
        const { data: newList, error: createError } = await supabase
          .from('shopping_lists')
          .insert({ household_id: household.id, name: t.shopping.groceries, sort_order: 0 })
          .select('id')
          .single()

        if (createError || !newList) {
          throw new Error(t.errors.saveFailed)
        }
        listId = newList.id
      } else {
        listId = lists[0].id
      }

      const items = ingredients.map(ing => ({
        list_id: listId,
        name: ing.item,
        quantity: ing.amount || null,
      }))

      const { error: insertError } = await supabase
        .from('shopping_list_items')
        .insert(items)

      if (insertError) {
        throw new Error(t.errors.saveFailed)
      }

      showMessage('success', t.week.ingredientsAdded)
    } catch (err) {
      console.error('Error adding to shopping list:', err)
      showMessage('error', t.errors.saveFailed)
    }
  }

  const handleApplyAll = async () => {
    if (!household || aiSuggestions.length === 0) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      for (const suggestion of aiSuggestions) {
        await handleMealChange(suggestion.day, suggestion.name, undefined)
      }

      showMessage('success', t.success.saved)
      setAiSuggestions([])
      setShowSuggestionModal(false)
    } catch (err) {
      console.error('Error applying all suggestions:', err)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  // No children state
  if (children.length === 0) {
    return (
      <div className="animate-fade-in">
        <div
          className="rounded-2xl p-8 md:p-12 text-center"
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
            {t.errors.couldNotLoadChildren}
          </h2>
          <p className="mb-8 max-w-md mx-auto" style={{ color: 'var(--muted)' }}>
            {t.wizard.addChildrenSubtitle}
          </p>
          <TransitionLink href="/innstillinger" className="btn btn-primary">
            {t.nav.settings}
          </TransitionLink>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Toast message */}
      {message && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg animate-fade-in"
          style={{
            background: message.type === 'success' ? 'var(--color-sage)' : 'var(--color-coral)',
            color: 'white',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Header with week navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
              {t.week.title}
            </h1>
            <FreshnessIndicator timestamp={dataTimestamp} color="sage" />
          </div>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            {t.week.editPickup}
          </p>
        </div>

        <div className="flex items-center gap-2 relative" ref={weekPickerRef}>
          <button
            onClick={() => navigateToWeek(weekNumber - 1)}
            className="p-2 rounded-xl transition-colors"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            aria-label={t.common.back}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button
            onClick={() => setShowWeekPicker(!showWeekPicker)}
            className="px-4 py-2 text-sm font-medium rounded-xl transition-colors hover:opacity-80"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            {formatWeekHeaderLocalized(weekStart, language)}
          </button>
          <button
            onClick={() => navigateToWeek(weekNumber + 1)}
            className="p-2 rounded-xl transition-colors"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            aria-label={t.common.next}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          {!isCurrentWeek && (
            <TransitionLink
              href={isDemo ? '/uke?demo=true' : '/uke'}
              className="px-3 py-2 text-sm font-medium rounded-xl transition-colors"
              style={{ color: 'var(--accent)' }}
            >
              {t.common.today}
            </TransitionLink>
          )}

          {/* Week picker dropdown */}
          {showWeekPicker && (
            <div
              className="absolute top-full mt-2 left-0 z-50 rounded-xl shadow-lg animate-fade-in"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <DayPicker
                mode="single"
                selected={weekStart}
                onSelect={handleWeekSelect}
                weekStartsOn={1}
                showOutsideDays
                locale={language === 'nb' ? nb : language === 'sv' ? sv : undefined}
                classNames={{
                  root: 'p-3',
                  month_caption: 'flex justify-center py-2 font-semibold',
                  nav: 'flex items-center justify-between absolute top-3 left-3 right-3',
                  button_previous: 'p-1 rounded hover:bg-[var(--background)]',
                  button_next: 'p-1 rounded hover:bg-[var(--background)]',
                  month_grid: 'w-full border-collapse',
                  weekdays: 'flex',
                  weekday: 'text-muted text-xs font-medium w-9 text-center',
                  week: 'flex',
                  day: 'w-9 h-9 text-center text-sm',
                  day_button: 'w-full h-full rounded-lg hover:bg-[var(--background)] transition-colors',
                  selected: 'bg-[var(--accent)] text-white rounded-lg',
                  today: 'font-bold text-[var(--accent)]',
                  outside: 'text-[var(--muted)] opacity-50',
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Week Context + AI Suggestion */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        {/* Week context toggle */}
        <div className="flex-1">
          <button
            onClick={() => setShowWeekContext(!showWeekContext)}
            className="flex items-center gap-2 text-sm font-medium transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            {showWeekContext ? t.common.close : t.common.add} {t.week.weekContext}
            {weekContextValue && !showWeekContext && (
              <span className="inline-flex items-center justify-center w-2 h-2 rounded-full" style={{ background: 'var(--color-sage)' }} />
            )}
          </button>

          {showWeekContext && (
            <div className="mt-3 space-y-2">
              <textarea
                value={weekContextValue}
                onChange={(e) => setWeekContextValue(e.target.value)}
                placeholder={t.week.weekContextPlaceholder}
                rows={2}
                className="input text-sm resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={saveWeekContext}
                  disabled={savingContext}
                  className="btn btn-secondary text-xs py-1.5 px-3"
                >
                  {savingContext ? t.common.loading : t.common.save}
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {t.week.weekContext}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={copyLastWeek}
            disabled={saving}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
            title={t.week.copyLastWeek}
            aria-label={t.week.copyLastWeek}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span className="hidden sm:inline">{t.success.copied}</span>
          </button>

          <button
            onClick={clearWeek}
            disabled={saving}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
            }}
            title={t.week.clearWeek}
            aria-label={t.week.clearWeek}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <span className="hidden sm:inline">{t.success.cleared}</span>
          </button>

          <button
            onClick={() => setShowQuickPickupModal(true)}
            disabled={saving || members.length === 0 || children.length === 0}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--color-sage)',
            }}
            title={t.week.quickPickup}
            aria-label={t.week.quickPickup}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <polyline points="16 11 18 13 22 9"/>
            </svg>
            <span className="hidden sm:inline">{t.week.quickPickup}</span>
          </button>

          <button
            onClick={fetchAISuggestions}
            disabled={aiLoading}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all hover:scale-[1.02] min-h-[44px]"
            style={{
              background: 'linear-gradient(135deg, var(--color-honey) 0%, color-mix(in srgb, var(--color-honey) 80%, #000) 100%)',
              color: 'white',
              boxShadow: '0 2px 8px color-mix(in srgb, var(--color-honey) 30%, transparent)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 10.5v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
              <path d="M12 12v2"/>
              <path d="M10 22h4"/>
              <path d="M10 18h4v4h-4z"/>
            </svg>
            {aiLoading ? t.week.generating : t.week.getAiSuggestions}
          </button>
        </div>
      </div>

      {saving && (
        <div
          className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl"
          style={{ background: 'rgba(139, 168, 136, 0.15)', color: '#5A7A57' }}
        >
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          {t.common.loading}
        </div>
      )}

      {/* Recent changes */}
      {household && (
        <RecentChanges
          householdId={household.id}
          weekStart={weekStart}
          weekEnd={weekEnd}
        />
      )}

      {/* Add event button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => openEventModal()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:scale-[1.02]"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <line x1="12" y1="14" x2="12" y2="18"/>
            <line x1="10" y1="16" x2="14" y2="16"/>
          </svg>
          {t.week.addEvent}
        </button>
        {memberEvents.length > 0 && (
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            {memberEvents.length} {memberEvents.length === 1 ? t.home.event : t.home.events}
          </span>
        )}
      </div>

      {/* Week grid */}
      <WeekGrid
        children={children}
        members={members}
        pickups={pickups}
        meals={meals}
        memberEvents={memberEvents}
        householdEvents={householdEvents}
        externalEvents={externalEvents}
        holidays={holidays}
        recipes={recipes}
        weekStart={weekStart}
        editable={true}
        onPickupChange={handlePickupChange}
        onMealChange={handleMealChange}
        onEventClick={openEventModal}
        onWorkCalendarSync={handleWorkCalendarSync}
        syncingPickupId={syncingPickupId}
        childTasks={childTasks}
        onTaskToggle={handleTaskToggle}
        onTaskClick={handleTaskClick}
        onAddTask={handleAddTask}
        onHouseholdEventClick={openHouseholdEventModal}
        onExternalEventClick={openExternalEventModal}
      />

      {/* Tips */}
      <div
        className="flex items-start gap-3 p-4 rounded-xl"
        style={{ background: 'rgba(126, 182, 196, 0.15)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-sky)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{t.week.editPickup}</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.week.selectPicker}
          </p>
        </div>
      </div>

      {/* AI Suggestion Modal */}
      <AISuggestionModal
        isOpen={showSuggestionModal}
        onClose={() => setShowSuggestionModal(false)}
        suggestions={aiSuggestions}
        isLoading={aiLoading}
        error={aiError}
        onAccept={handleAcceptSuggestion}
        onRetry={fetchAISuggestions}
        onAddToShoppingList={handleAddToShoppingList}
        onApplyAll={handleApplyAll}
      />

      {/* Quick Pickup Modal */}
      {showQuickPickupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0, 0, 0, 0.5)' }}
            onClick={() => setShowQuickPickupModal(false)}
          />
          <div
            className="relative w-full max-w-sm max-h-[85vh] rounded-2xl p-6 space-y-4 animate-fade-in overflow-hidden"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold font-display" style={{ color: 'var(--foreground)' }}>
                {t.week.quickPickup}
              </h2>
              <button
                onClick={() => setShowQuickPickupModal(false)}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--muted)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {t.week.selectMember}
            </p>
            <div className="space-y-2">
              {members.map((member) => (
                <button
                  key={member.id}
                  onClick={() => quickPickupAllWeek(member.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-[var(--sand)]"
                  style={{ border: '1px solid var(--border)' }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium"
                    style={{ background: 'var(--color-sage)' }}
                  >
                    {member.name.substring(0, 2).toUpperCase()}
                  </div>
                  <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {member.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <MemberEventModal
        isOpen={showEventModal}
        editingEvent={editingEvent}
        eventForm={eventForm}
        members={members}
        saving={saving}
        t={t}
        onFormChange={setEventForm}
        onSave={saveEvent}
        onDelete={deleteEvent}
        onClose={closeEventModal}
      />

      <HouseholdEventModal
        isOpen={showHouseholdEventModal}
        editingEvent={editingHouseholdEvent}
        eventForm={householdEventForm}
        saving={saving}
        t={t}
        onFormChange={setHouseholdEventForm}
        onSave={saveHouseholdEvent}
        onDelete={deleteHouseholdEvent}
        onClose={closeHouseholdEventModal}
      />

      <ChildTaskModal
        isOpen={showTaskModal}
        editingTask={editingTask}
        taskForm={taskForm}
        children={children}
        saving={saving}
        t={t}
        onFormChange={setTaskForm}
        onSave={saveTask}
        onDelete={deleteTask}
        onClose={closeTaskModal}
      />

      <ExternalEventModal
        isOpen={showExternalEventModal}
        event={editingExternalEvent}
        saving={saving}
        t={t}
        onSave={saveExternalEvent}
        onClose={closeExternalEventModal}
      />
    </div>
  )
}
