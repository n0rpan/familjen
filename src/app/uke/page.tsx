'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { WeekGrid } from '@/components/WeekGrid'
import { formatDateISO, getWeekStart, addDays, formatWeekHeaderLocalized, type Holiday } from '@/lib/utils'
import type { Child, HouseholdMember, PickupWithDetails, MealWithRecipe, Household, Recipe, MealSuggestion, MemberEvent, MemberEventType, HouseholdEvent, ChildTask, ChildTaskType, RecipeIngredient, Pickup, Meal, ExternalEvent, WeekCacheData } from '@/lib/types'
import { TransitionLink } from '@/components/TransitionLink'
import dynamic from 'next/dynamic'
import { RecentChanges } from '@/components/RecentChanges'
import { useLanguage } from '@/lib/i18n/context'
import { notifyPickupAssigned, notifyMealChanged, notifyTaskAdded, notifyEventAdded } from '@/lib/notify'
import { nb, sv } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import { WeekPagePartialSkeleton } from '@/components/Skeleton'
import { useRealtimeSubscription, createHouseholdFilter } from '@/hooks/useRealtimeSubscription'
import { useRealtimeOptional } from '@/lib/realtime/context'
import { getCachedWeekData, getWeekCacheKey, prefetchWeekData } from '@/lib/prefetch/fetchers'
import { setCache } from '@/lib/cache'
import { MemberEventModal, HouseholdEventModal, ChildTaskModal, ExternalEventModal } from './components'
import type { ExternalEventLocalOverrides } from '@/lib/types'
import { useWeekData } from '@/hooks/data'

// Dynamic imports for code splitting
const DayPicker = dynamic(
  () => import('react-day-picker').then(mod => mod.DayPicker),
  { ssr: false, loading: () => <div className="p-4 text-center text-sm" style={{ color: 'var(--muted)' }}>...</div> }
)

const AISuggestionModal = dynamic(
  () => import('@/components/AISuggestionModal').then(mod => mod.AISuggestionModal),
  { ssr: false }
)

export default function WeekEditPage() {
  // Check for demo mode - must be before any hooks
  const searchParams = useSearchParams()
  const isDemo = searchParams.get('demo') === 'true'

  // All hooks must be called unconditionally (React rules of hooks)
  const { language, t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncingPickupId, setSyncingPickupId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [children, setChildren] = useState<Child[]>([])
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [pickups, setPickups] = useState<PickupWithDetails[]>([])
  const [meals, setMeals] = useState<MealWithRecipe[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [weekOffset, setWeekOffset] = useState(0)
  const [reloadTrigger, setReloadTrigger] = useState(0)

  // AI suggestion state
  const [showSuggestionModal, setShowSuggestionModal] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<MealSuggestion[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // Week context state
  const [weekContext, setWeekContext] = useState('')
  const [showWeekContext, setShowWeekContext] = useState(false)
  const [savingContext, setSavingContext] = useState(false)

  // Member events state
  const [memberEvents, setMemberEvents] = useState<MemberEvent[]>([])
  const [householdEvents, setHouseholdEvents] = useState<HouseholdEvent[]>([])
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

  // Child tasks state
  const [childTasks, setChildTasks] = useState<ChildTask[]>([])
  const [showTaskModal, setShowTaskModal] = useState(false)

  // External events state (from Spond, etc.)
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([])
  const [showExternalEventModal, setShowExternalEventModal] = useState(false)
  const [editingExternalEvent, setEditingExternalEvent] = useState<ExternalEvent | null>(null)

  // Holidays state (system + birthdays)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [editingTask, setEditingTask] = useState<ChildTask | null>(null)
  const [taskForm, setTaskForm] = useState({
    child_id: '',
    title: '',
    task_type: 'reminder' as ChildTaskType,
    date: '',
    time: '',
    notes: '',
  })

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

  // Demo mode data hook - only used when isDemo is true
  const demoData = useWeekData({ weekOffset })

  // Demo mode helper - shows info message and returns void
  // Note: Handlers must check isDemo and return early after calling this
  const showDemoMessage = useCallback((): void => {
    showMessage('error', t.common.viewOnly || 'View only in demo mode')
  }, [t.common.viewOnly])

  // Track pending changes to prevent duplicate handling
  const pendingChanges = useRef<Set<string>>(new Set())

  // Track last weekOffset to reset cache flag on week change
  const lastWeekOffsetRef = useRef(weekOffset)

  const { weekStart, weekEnd } = useMemo(() => {
    const start = addDays(getWeekStart(new Date()), weekOffset * 7)
    const end = addDays(start, 6)
    return { weekStart: start, weekEnd: end }
  }, [weekOffset])

  // Handle week picker date selection
  const handleWeekSelect = (date: Date | undefined) => {
    if (!date) return
    const selectedWeekStart = getWeekStart(date)
    const currentWeekStart = getWeekStart(new Date())
    const diffTime = selectedWeekStart.getTime() - currentWeekStart.getTime()
    const diffWeeks = Math.round(diffTime / (7 * 24 * 60 * 60 * 1000))
    setWeekOffset(diffWeeks)
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

  // Track householdId for cache operations
  const householdIdRef = useRef<string | null>(null)
  // Track if we've shown cached data to prevent re-showing skeleton
  const hasShownCacheRef = useRef(false)

  // Demo mode: populate state from hook data
  useEffect(() => {
    if (!isDemo) return

    // Update state from demo data hook
    if (!demoData.loading) {
      if (demoData.household) {
        setHousehold(demoData.household as Household)
      }
      setChildren(demoData.children)
      setMembers(demoData.members)
      setPickups(demoData.pickups)
      setMeals(demoData.meals)
      setRecipes(demoData.recipes)
      setChildTasks(demoData.tasks)
      setMemberEvents(demoData.memberEvents)
      setHouseholdEvents(demoData.householdEvents)
      setExternalEvents(demoData.externalEvents)
      setHolidays(demoData.holidays)
      setLoading(false)
    }
  }, [isDemo, demoData.loading, demoData.household, demoData.children, demoData.members,
      demoData.pickups, demoData.meals, demoData.recipes, demoData.tasks,
      demoData.memberEvents, demoData.householdEvents, demoData.externalEvents, demoData.holidays])

  useEffect(() => {
    // Skip data loading in demo mode - data comes from hooks
    if (isDemo) return

    let cancelled = false

    const loadData = async () => {
      setError(null)

      try {
        // First get user's membership to find their specific household
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          throw new Error(t.errors.unauthorized)
        }

        const { data: membership } = await supabase
          .from('household_members')
          .select('household_id')
          .eq('user_id', user.id)
          .maybeSingle()

        if (!membership) {
          setHousehold(null)
          setLoading(false)
          return
        }

        if (cancelled) return

        householdIdRef.current = membership.household_id

        // Check cache first for instant display (before network fetch)
        if (!hasShownCacheRef.current) {
          try {
            const cached = await getCachedWeekData(membership.household_id, weekOffset)
            if (cached && !cancelled) {
              // Populate state from cache immediately (no skeleton!)
              setHousehold(cached.household)
              setChildren(cached.children)
              setMembers(cached.members)
              setPickups(cached.pickups)
              setMeals(cached.meals)
              setRecipes(cached.recipes)
              setMemberEvents(cached.memberEvents)
              setHouseholdEvents(cached.householdEvents)
              setChildTasks(cached.childTasks)
              setExternalEvents(cached.externalEvents)
              setHolidays(cached.holidays)
              setWeekContext(cached.weekContext)
              setLoading(false)
              hasShownCacheRef.current = true
            }
          } catch (err) {
            console.warn('[Week] Cache check failed:', err)
          }
        }

        // Still show loading if no cache was found for this week
        // Note: We check only hasShownCacheRef, not household state, because
        // household might still contain stale data from the previous week
        if (!hasShownCacheRef.current) {
          setLoading(true)
        }

        if (cancelled) return

        const weekStartStr = formatDateISO(weekStart)
        const weekEndStr = formatDateISO(weekEnd)

        // Fetch all data in parallel, using the specific household_id to prevent admin seeing other households
        const [householdResult, childrenResult, membersResult, pickupsResult, mealsResult, recipesResult, eventsResult, householdEventsResult, tasksResult, externalEventsResult, holidaysResult] = await Promise.all([
          supabase.from('households').select('id, name, ai_meal_context, share_names_with_ai, external_integrations_enabled, created_at').eq('id', membership.household_id).single(),
          supabase.from('children').select('*').eq('household_id', membership.household_id).order('sort_order'),
          supabase.from('household_members').select('*').eq('household_id', membership.household_id),
          supabase.from('pickups').select(`*, child:children(*), picker:household_members(*)`).eq('household_id', membership.household_id).gte('date', weekStartStr).lte('date', weekEndStr),
          supabase.from('meals').select(`*, recipe:recipes(*)`).eq('household_id', membership.household_id).gte('date', weekStartStr).lte('date', weekEndStr),
          supabase.from('recipes').select('*').eq('household_id', membership.household_id).order('name'),
          // Fetch events that overlap with this week (start <= weekEnd AND (end >= weekStart OR end IS NULL))
          supabase.from('member_events').select('*').eq('household_id', membership.household_id).lte('date', weekEndStr).or(`end_date.gte.${weekStartStr},end_date.is.null`),
          // Fetch household events that overlap with this week
          supabase.from('household_events').select('*').eq('household_id', membership.household_id).lte('event_date', weekEndStr).or(`end_date.gte.${weekStartStr},end_date.is.null`).order('event_date').order('event_time'),
          // Fetch child tasks for this week
          supabase.from('child_tasks').select('*').eq('household_id', membership.household_id).gte('date', weekStartStr).lte('date', weekEndStr).order('date').order('time'),
          // Fetch external events (from Spond, etc.) - join with integrations to get service info
          supabase.from('external_events').select(`*, integration:external_integrations!inner(service, display_name, household_id)`).eq('external_integrations.household_id', membership.household_id).eq('is_hidden', false).gte('event_date', weekStartStr).lte('event_date', weekEndStr).order('event_date').order('event_time'),
          // Fetch holidays (system-wide and household-specific)
          supabase.from('calendar_events').select('date, name').or(`household_id.is.null,household_id.eq.${membership.household_id}`).gte('date', weekStartStr).lte('date', weekEndStr).eq('event_type', 'holiday'),
        ])

        // Check for critical errors
        if (householdResult.error) {
          throw new Error(t.errors.couldNotLoadHousehold)
        }
        if (childrenResult.error) throw new Error(t.errors.couldNotLoadChildren)
        if (membersResult.error) throw new Error(t.errors.couldNotLoadMembers)
        if (pickupsResult.error) throw new Error(t.errors.couldNotLoadPickups)
        if (mealsResult.error) throw new Error(t.errors.couldNotLoadMeals)
        if (recipesResult.error) throw new Error(t.errors.couldNotLoadRecipes)
        if (eventsResult.error) throw new Error(t.errors.couldNotLoadEvents)
        if (householdEventsResult.error) console.warn('Non-critical: Could not load household events', householdEventsResult.error)
        if (tasksResult.error) throw new Error(t.errors.couldNotLoadTasks)

        // Non-critical: holidays
        if (holidaysResult.error) {
          console.warn('Non-critical: Could not load holidays', holidaysResult.error)
        }

        setHousehold(householdResult.data)
        setChildren(childrenResult.data || [])
        setMembers(membersResult.data || [])
        setPickups(pickupsResult.data || [])
        setMeals(mealsResult.data || [])
        setRecipes(recipesResult.data || [])
        setMemberEvents(eventsResult.data || [])
        setHouseholdEvents(householdEventsResult.data || [])
        setChildTasks(tasksResult.data || [])
        setExternalEvents(externalEventsResult.data || [])

        // Generate birthdays from members and children with birth_date
        const currentYear = new Date().getFullYear()
        const birthdays: Holiday[] = []

        // Add member birthdays
        membersResult.data?.forEach(member => {
          if (member.birth_date) {
            const birthDate = new Date(member.birth_date)
            const thisYearBirthday = `${currentYear}-${String(birthDate.getMonth() + 1).padStart(2, '0')}-${String(birthDate.getDate()).padStart(2, '0')}`
            if (thisYearBirthday >= weekStartStr && thisYearBirthday <= weekEndStr) {
              birthdays.push({
                date: thisYearBirthday,
                name: member.name,
                type: 'birthday',
              })
            }
          }
        })

        // Add children birthdays
        childrenResult.data?.forEach(child => {
          if (child.birth_date) {
            const birthDate = new Date(child.birth_date)
            const thisYearBirthday = `${currentYear}-${String(birthDate.getMonth() + 1).padStart(2, '0')}-${String(birthDate.getDate()).padStart(2, '0')}`
            if (thisYearBirthday >= weekStartStr && thisYearBirthday <= weekEndStr) {
              birthdays.push({
                date: thisYearBirthday,
                name: child.name,
                type: 'birthday',
              })
            }
          }
        })

        // Merge holidays and birthdays
        const rawHolidays = holidaysResult.data || []
        setHolidays([
          ...rawHolidays.map(h => ({ ...h, type: 'holiday' as const })),
          ...birthdays,
        ])

        // Fetch week context for this week
        let weekContextValue = ''
        if (householdResult.data) {
          const { data: contextData } = await supabase
            .from('week_contexts')
            .select('context')
            .eq('household_id', householdResult.data.id)
            .eq('week_start', weekStartStr)
            .maybeSingle()
          weekContextValue = contextData?.context || ''
          setWeekContext(weekContextValue)
        }

        // Update cache with fresh data
        const allHolidays = [
          ...rawHolidays.map(h => ({ ...h, type: 'holiday' as const })),
          ...birthdays,
        ]
        const cacheData: WeekCacheData = {
          household: householdResult.data,
          children: childrenResult.data || [],
          members: membersResult.data || [],
          pickups: pickupsResult.data || [],
          meals: mealsResult.data || [],
          recipes: recipesResult.data || [],
          memberEvents: eventsResult.data || [],
          householdEvents: householdEventsResult.data || [],
          childTasks: tasksResult.data || [],
          externalEvents: externalEventsResult.data || [],
          holidays: allHolidays,
          weekContext: weekContextValue,
          weekStartStr,
          weekEndStr,
          timestamp: Date.now(),
        }
        const cacheKey = getWeekCacheKey(membership.household_id, weekOffset)
        setCache(cacheKey, cacheData).catch(err => {
          console.warn('[Week] Failed to update cache:', err)
        })
      } catch (err) {
        console.error('Week edit page error:', err)
        setError(err instanceof Error ? err.message : t.errors.generic)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    // Reset cache flag when week changes
    if (lastWeekOffsetRef.current !== weekOffset) {
      hasShownCacheRef.current = false
      lastWeekOffsetRef.current = weekOffset
    }

    loadData()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translation strings are stable, only reload on core deps
  }, [supabase, weekStart, weekEnd, reloadTrigger, weekOffset, isDemo])

  // Immediate reload for user-initiated actions
  const triggerReload = () => setReloadTrigger(prev => prev + 1)

  // Debounced reload for realtime events - collects bursts into single reload
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedReload = useCallback(() => {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current)
    }
    reloadTimerRef.current = setTimeout(() => {
      setReloadTrigger(prev => prev + 1)
      reloadTimerRef.current = null
    }, 250) // 250ms debounce window
  }, [])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current)
      }
    }
  }, [])

  // Prefetch adjacent weeks for instant navigation
  const hasPrefetchedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!household || loading) return

    // Prefetch previous and next weeks in background
    const prefetchAdjacent = async () => {
      const prevKey = `${household.id}:${weekOffset - 1}`
      const nextKey = `${household.id}:${weekOffset + 1}`

      // Bound set size to prevent memory leak
      if (hasPrefetchedRef.current.size > 20) {
        hasPrefetchedRef.current.clear()
      }

      if (!hasPrefetchedRef.current.has(prevKey)) {
        hasPrefetchedRef.current.add(prevKey)
        prefetchWeekData(household.id, weekOffset - 1).catch(() => {})
      }
      if (!hasPrefetchedRef.current.has(nextKey)) {
        hasPrefetchedRef.current.add(nextKey)
        prefetchWeekData(household.id, weekOffset + 1).catch(() => {})
      }
    }

    // Delay prefetch to not compete with main content
    const timer = setTimeout(prefetchAdjacent, 1000)
    return () => clearTimeout(timer)
  }, [household, weekOffset, loading])

  // Refetch data when app returns to foreground (catches changes missed while backgrounded)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !loading) {
        triggerReload()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [loading])

  // Date range strings for filtering realtime events
  const weekStartStr = formatDateISO(weekStart)
  const weekEndStr = formatDateISO(weekEnd)

  // Realtime handlers for pickups
  const handlePickupRealtime = useCallback((
    eventType: 'INSERT' | 'UPDATE' | 'DELETE',
    newRecord: Pickup | null,
    oldRecord: Pickup | null
  ) => {
    const record = newRecord || oldRecord
    if (!record) return

    // Skip if this is our own change
    if (pendingChanges.current.has(record.id)) {
      pendingChanges.current.delete(record.id)
      return
    }

    // Only process changes for current week
    const recordDate = record.date
    if (recordDate < weekStartStr || recordDate > weekEndStr) return

    // Show toast for changes from other users
    const updatedBy = (newRecord as unknown as { updated_by?: string })?.updated_by
    if (realtime && newRecord && !realtime.isOwnChange(updatedBy)) {
      const child = children.find(c => c.id === newRecord.child_id)
      const picker = members.find(m => m.id === newRecord.picker_id)
      if (child && picker) {
        const dateObj = new Date(newRecord.date)
        const dayName = t.date.weekdays[dateObj.getDay()]
        realtime.showToast(
          `${realtime.getMemberName(updatedBy)} satt ${picker.short_name || picker.name} til henting av ${child.name} ${dayName}`,
          'info'
        )
      }
    }

    // Reload data to get full pickup details with relations (debounced for bursts)
    debouncedReload()
  }, [weekStartStr, weekEndStr, realtime, children, members, t.date.weekdays, debouncedReload])

  // Realtime handlers for meals
  const handleMealRealtime = useCallback((
    eventType: 'INSERT' | 'UPDATE' | 'DELETE',
    newRecord: Meal | null,
    oldRecord: Meal | null
  ) => {
    const record = newRecord || oldRecord
    if (!record) return

    // Skip if this is our own change
    if (pendingChanges.current.has(record.id)) {
      pendingChanges.current.delete(record.id)
      return
    }

    // Only process changes for current week
    const recordDate = record.date
    if (recordDate < weekStartStr || recordDate > weekEndStr) return

    // Show toast for changes from other users
    const updatedBy = (newRecord as unknown as { updated_by?: string })?.updated_by
    if (realtime && newRecord && !realtime.isOwnChange(updatedBy)) {
      const mealName = newRecord.custom_meal || 'middag'
      const dateObj = new Date(newRecord.date)
      const dayName = t.date.weekdays[dateObj.getDay()]
      realtime.showToast(
        `${realtime.getMemberName(updatedBy)} endret ${dayName} til ${mealName}`,
        'info'
      )
    }

    // Reload data to get full meal details with recipe (debounced for bursts)
    debouncedReload()
  }, [weekStartStr, weekEndStr, realtime, t.date.weekdays, debouncedReload])

  // Realtime handlers for child tasks
  const handleTaskRealtime = useCallback((
    eventType: 'INSERT' | 'UPDATE' | 'DELETE',
    newRecord: ChildTask | null,
    oldRecord: ChildTask | null
  ) => {
    const record = newRecord || oldRecord
    if (!record) return

    // Skip if this is our own change
    if (pendingChanges.current.has(record.id)) {
      pendingChanges.current.delete(record.id)
      return
    }

    // Only process changes for current week
    const recordDate = record.date
    if (recordDate < weekStartStr || recordDate > weekEndStr) return

    // Show toast for changes from other users
    const updatedBy = (record as unknown as { updated_by?: string }).updated_by
    if (realtime && !realtime.isOwnChange(updatedBy)) {
      const child = children.find(c => c.id === record.child_id)
      if (eventType === 'INSERT' && child) {
        realtime.showToast(
          `${realtime.getMemberName(updatedBy)} la til oppgave for ${child.name}`,
          'info'
        )
      } else if (eventType === 'UPDATE' && record.status === 'done' && child) {
        realtime.showToast(
          `${realtime.getMemberName(updatedBy)} fullførte ${record.title}`,
          'success'
        )
      }
    }

    // Reload data (debounced for bursts)
    debouncedReload()
  }, [weekStartStr, weekEndStr, realtime, children, debouncedReload])

  // Realtime handlers for member events
  const handleEventRealtime = useCallback((
    eventType: 'INSERT' | 'UPDATE' | 'DELETE',
    newRecord: MemberEvent | null,
    oldRecord: MemberEvent | null
  ) => {
    const record = newRecord || oldRecord
    if (!record) return

    // Skip if this is our own change
    if (pendingChanges.current.has(record.id)) {
      pendingChanges.current.delete(record.id)
      return
    }

    // Show toast for new events from other users
    const updatedBy = (newRecord as unknown as { updated_by?: string })?.updated_by
    if (realtime && eventType === 'INSERT' && newRecord && !realtime.isOwnChange(updatedBy)) {
      const member = members.find(m => m.id === newRecord.member_id)
      if (member) {
        realtime.showToast(
          `${realtime.getMemberName(updatedBy)} la til ${newRecord.title} for ${member.short_name || member.name}`,
          'info'
        )
      }
    }

    // Reload data (debounced for bursts)
    debouncedReload()
  }, [realtime, members, debouncedReload])

  // Realtime handlers for household events
  const handleHouseholdEventRealtime = useCallback((
    eventType: 'INSERT' | 'UPDATE' | 'DELETE',
    newRecord: HouseholdEvent | null,
    oldRecord: HouseholdEvent | null
  ) => {
    const record = newRecord || oldRecord
    if (!record) return

    // Skip if this is our own change
    if (pendingChanges.current.has(record.id)) {
      pendingChanges.current.delete(record.id)
      return
    }

    // Show toast for new events from other users
    const updatedBy = (newRecord as unknown as { updated_by?: string })?.updated_by
    if (realtime && eventType === 'INSERT' && newRecord && !realtime.isOwnChange(updatedBy)) {
      realtime.showToast(
        `${realtime.getMemberName(updatedBy)} la til familiehendelse: ${newRecord.title}`,
        'info'
      )
    }

    // Reload data (debounced for bursts)
    debouncedReload()
  }, [realtime, debouncedReload])

  // Subscribe to realtime changes
  useRealtimeSubscription<Pickup>({
    table: 'pickups',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    onAny: (event) => handlePickupRealtime(event.eventType, event.new as Pickup | null, event.old as Pickup | null),
    enabled: !loading && !!household?.id,
  })

  useRealtimeSubscription<Meal>({
    table: 'meals',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    onAny: (event) => handleMealRealtime(event.eventType, event.new as Meal | null, event.old as Meal | null),
    enabled: !loading && !!household?.id,
  })

  useRealtimeSubscription<ChildTask>({
    table: 'child_tasks',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    onAny: (event) => handleTaskRealtime(event.eventType, event.new as ChildTask | null, event.old as ChildTask | null),
    enabled: !loading && !!household?.id,
  })

  useRealtimeSubscription<MemberEvent>({
    table: 'member_events',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    onAny: (event) => handleEventRealtime(event.eventType, event.new as MemberEvent | null, event.old as MemberEvent | null),
    enabled: !loading && !!household?.id,
  })

  useRealtimeSubscription<HouseholdEvent>({
    table: 'household_events',
    filter: household?.id ? createHouseholdFilter(household.id) : undefined,
    onAny: (event) => handleHouseholdEventRealtime(event.eventType, event.new as HouseholdEvent | null, event.old as HouseholdEvent | null),
    enabled: !loading && !!household?.id,
  })

  const handlePickupChange = async (childId: string, date: string, pickerId: string | null) => {
    if (!household) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      // Find existing pickup
      const existing = pickups.find(p => p.child_id === childId && p.date === date)

      if (existing) {
        if (pickerId) {
          // Update existing
          const { error } = await supabase
            .from('pickups')
            .update({ picker_id: pickerId })
            .eq('id', existing.id)
          if (error) throw error
        } else {
          // Delete if picker is null
          const { error } = await supabase
            .from('pickups')
            .delete()
            .eq('id', existing.id)
          if (error) throw error
        }
      } else if (pickerId) {
        // Insert new
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

      // Send notification if pickup was assigned to someone
      if (pickerId) {
        const child = children.find(c => c.id === childId)
        const picker = members.find(m => m.id === pickerId)
        if (child && picker) {
          const dateObj = new Date(date)
          const dayName = t.date.weekdays[dateObj.getDay()]
          notifyPickupAssigned(child.name, dayName, pickerId)
        }
      }

      // Reload data
      triggerReload()
    } catch (error) {
      console.error('Error saving pickup:', error)
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
      triggerReload()
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
    const weekStartStr = formatDateISO(weekStart)

    // Upsert the week context
    const { error } = await supabase
      .from('week_contexts')
      .upsert(
        {
          household_id: household.id,
          week_start: weekStartStr,
          context: weekContext || null,
        },
        { onConflict: 'household_id,week_start' }
      )

    if (error) {
      console.error('Error saving week context:', error)
    }
    setSavingContext(false)
  }

  // Copy pickups and meals from last week
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

      // Fetch last week's pickups and meals
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

      // Calculate date offset (7 days)
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

      // Upsert to avoid duplicates
      if (copyPickups.length > 0) {
        await supabase.from('pickups').upsert(copyPickups, { onConflict: 'child_id,date' })
      }
      if (copyMeals.length > 0) {
        await supabase.from('meals').upsert(copyMeals, { onConflict: 'household_id,date' })
      }

      showMessage('success', t.success.copied)
      triggerReload()
    } catch (err) {
      console.error('Error copying last week:', err)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  // Clear all pickups and meals for this week
  const clearWeek = async () => {
    if (!household) return
    if (isDemo) { showDemoMessage(); return }
    if (!confirm(t.week.clearWeekConfirm)) return

    setSaving(true)
    try {
      const weekStartStr = formatDateISO(weekStart)
      const weekEndStr = formatDateISO(weekEnd)

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
      triggerReload()
    } catch (err) {
      console.error('Error clearing week:', err)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  // Quick set pickup for all children all week
  const quickPickupAllWeek = async (pickerId: string) => {
    if (!household || children.length === 0) return
    if (isDemo) { showDemoMessage(); return }

    const pickerName = members.find(m => m.id === pickerId)?.name || ''
    const confirmMessage = t.week.quickPickupConfirm.replace('{name}', pickerName)
    if (!confirm(confirmMessage)) return

    setSaving(true)
    setShowQuickPickupModal(false)

    try {
      // Generate all pickup records for the week
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

      // Upsert all pickups
      const { error } = await supabase
        .from('pickups')
        .upsert(pickupRecords, { onConflict: 'child_id,date' })

      if (error) throw error

      showMessage('success', t.success.saved)
      triggerReload()
    } catch (err) {
      console.error('Error setting quick pickups:', err)
      showMessage('error', t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  // Event handlers
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
    setEventForm({
      member_id: '',
      title: '',
      event_type: 'other',
      date: '',
      end_date: '',
    })
  }

  const saveEvent = async () => {
    if (!household || !eventForm.member_id || !eventForm.title || !eventForm.date) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      let eventId: string | undefined

      if (editingEvent) {
        // Update existing
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
        // Insert new
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
        eventId = data?.id

        // Send notification for new events to other household members
        const eventMember = members.find(m => m.id === eventForm.member_id)
        if (eventMember && eventId) {
          const dateObj = new Date(eventForm.date)
          const dayName = t.date.weekdays[dateObj.getDay()]
          // Notify all members except the one the event is about
          const otherMemberIds = members
            .filter(m => m.id !== eventForm.member_id)
            .map(m => m.id)
          notifyEventAdded(eventMember.name, eventForm.title, dayName, eventId, otherMemberIds)
        }
      }

      closeEventModal()
      triggerReload()
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
      triggerReload()
    } catch (err) {
      console.error('Error deleting event:', err)
    } finally {
      setSaving(false)
    }
  }

  // Household event handlers
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
    setHouseholdEventForm({
      title: '',
      date: '',
      end_date: '',
      time: '',
      location: '',
    })
  }

  const saveHouseholdEvent = async () => {
    if (!household || !householdEventForm.title || !householdEventForm.date) return
    if (isDemo) { showDemoMessage(); return }

    // Don't allow editing ICS-synced events
    if (editingHouseholdEvent?.source === 'ics_calendar') {
      showMessage('error', 'ICS-synced events cannot be edited')
      return
    }

    setSaving(true)

    try {
      if (editingHouseholdEvent) {
        // Update existing
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
        // Create new
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
      triggerReload()
    } catch (err) {
      console.error('Error saving household event:', err)
    } finally {
      setSaving(false)
    }
  }

  const deleteHouseholdEvent = async () => {
    if (!editingHouseholdEvent) return
    if (isDemo) { showDemoMessage(); return }

    // Don't allow deleting ICS-synced events
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
      triggerReload()
    } catch (err) {
      console.error('Error deleting household event:', err)
    } finally {
      setSaving(false)
    }
  }

  // Task handlers
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
    setTaskForm({
      child_id: '',
      title: '',
      task_type: 'reminder',
      date: '',
      time: '',
      notes: '',
    })
  }

  const saveTask = async () => {
    if (!household || !taskForm.child_id || !taskForm.title || !taskForm.date) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      let taskId: string | undefined

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
        taskId = data?.id

        // Send notification for new tasks
        const child = children.find(c => c.id === taskForm.child_id)
        if (child && taskId) {
          notifyTaskAdded(child.name, taskForm.title, taskId)
        }
      }

      closeTaskModal()
      triggerReload()
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
      triggerReload()
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

      triggerReload()
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
      triggerReload()
      showMessage('success', t.success.saved)
    } catch (err) {
      console.error('Error saving external event:', err)
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
      // Find existing meal
      const existing = meals.find(m => m.date === date)

      if (existing) {
        if (mealName) {
          // Update existing - use recipe_id if provided, otherwise custom_meal
          const { error } = await supabase
            .from('meals')
            .update({
              recipe_id: recipeId || null,
              custom_meal: recipeId ? null : mealName,
            })
            .eq('id', existing.id)
          if (error) throw error
        } else {
          // Delete if meal is null
          const { error } = await supabase
            .from('meals')
            .delete()
            .eq('id', existing.id)
          if (error) throw error
        }
      } else if (mealName) {
        // Insert new - use recipe_id if provided, otherwise custom_meal
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

      // Send notification for meal changes (today or tomorrow only)
      if (mealName) {
        const today = formatDateISO(new Date())
        const tomorrow = formatDateISO(addDays(new Date(), 1))
        if (date === today || date === tomorrow) {
          const dayName = date === today ? t.common.today : t.common.tomorrow
          notifyMealChanged(mealName, dayName)
        }
      }

      // Reload data
      triggerReload()
    } catch (error) {
      console.error('Error saving meal:', error)
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
      // Build existing meals list
      const existingMeals = meals.map(m => ({
        date: m.date,
        name: m.recipe?.name || m.custom_meal || '',
      }))

      const response = await fetch('/api/openrouter/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart: formatDateISO(weekStart),
          existingMeals,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        // Provide user-friendly error messages
        if (response.status === 429) {
          throw new Error(t.errors.generic) // Rate limited
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

      // Save as recipe if requested
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

        if (recipeError) {
          console.error('Error saving recipe:', recipeError)
        } else {
          recipeId = newRecipe.id
        }
      }

      // Save the meal
      await handleMealChange(suggestion.day, suggestion.name, recipeId)

      // Remove this suggestion from the list
      setAiSuggestions(prev => prev.filter(s => s.day !== suggestion.day))

      // Close modal if no more suggestions
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
      // Get or create the default shopping list
      let { data: lists } = await supabase
        .from('shopping_lists')
        .select('id')
        .eq('household_id', household.id)
        .order('sort_order')
        .limit(1)

      let listId: string

      if (!lists || lists.length === 0) {
        // Create default list
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

      // Add all ingredients to the shopping list
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

  // Apply all AI suggestions at once
  const handleApplyAll = async () => {
    if (!household || aiSuggestions.length === 0) return
    if (isDemo) { showDemoMessage(); return }

    setSaving(true)

    try {
      // Apply each suggestion without saving as recipe
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

  // Only show skeleton if loading AND no cached data yet
  // Once we have household data (from cache or fetch), render content
  if (loading && !household) {
    return <WeekPagePartialSkeleton t={t} />
  }

  if (error) {
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
            {error}
          </h2>
          <p className="mb-8" style={{ color: 'var(--muted)' }}>
            {t.errors.generic}
          </p>
          <button onClick={triggerReload} className="btn btn-primary">
            {t.common.retry}
          </button>
        </div>
      </div>
    )
  }

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
          <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.week.title}
          </h1>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            {t.week.editPickup}
          </p>
        </div>

        <div className="flex items-center gap-2 relative" ref={weekPickerRef}>
          <button
            onClick={() => setWeekOffset(weekOffset - 1)}
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
            onClick={() => setWeekOffset(weekOffset + 1)}
            className="p-2 rounded-xl transition-colors"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            aria-label={t.common.next}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="px-3 py-2 text-sm font-medium rounded-xl transition-colors"
              style={{ color: 'var(--accent)' }}
            >
              {t.common.today}
            </button>
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
            {weekContext && !showWeekContext && (
              <span className="inline-flex items-center justify-center w-2 h-2 rounded-full" style={{ background: 'var(--color-sage)' }} />
            )}
          </button>

          {showWeekContext && (
            <div className="mt-3 space-y-2">
              <textarea
                value={weekContext}
                onChange={(e) => setWeekContext(e.target.value)}
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
          {/* Copy last week */}
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

          {/* Clear week */}
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

          {/* Quick pickup button */}
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

          {/* AI Suggestion button */}
          <button
            onClick={fetchAISuggestions}
            disabled={aiLoading}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all hover:scale-[1.02] min-h-[44px]"
            style={{
              background: 'linear-gradient(135deg, var(--color-honey) 0%, #C9A05B 100%)',
              color: 'white',
              boxShadow: '0 2px 8px rgba(229, 186, 115, 0.3)',
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

      {/* Week grid in edit mode */}
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

      {/* Event Modal */}
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

      {/* Household Event Modal */}
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

      {/* Task Modal */}
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

      {/* External Event Modal */}
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
