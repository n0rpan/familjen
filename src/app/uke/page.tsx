'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WeekGrid } from '@/components/WeekGrid'
import { formatDateISO, getWeekStart, addDays, formatWeekHeader } from '@/lib/utils'
import type { Child, HouseholdMember, PickupWithDetails, MealWithRecipe, Household, Recipe, MealSuggestion, MemberEvent, MemberEventType, ChildTask, ChildTaskType } from '@/lib/types'
import Link from 'next/link'
import { AISuggestionModal } from '@/components/AISuggestionModal'

export default function WeekEditPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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
  const [showEventModal, setShowEventModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState<MemberEvent | null>(null)
  const [eventForm, setEventForm] = useState({
    member_id: '',
    title: '',
    event_type: 'other' as MemberEventType,
    date: '',
    end_date: '',
  })

  // Child tasks state
  const [childTasks, setChildTasks] = useState<ChildTask[]>([])
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

  // Toast message state
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const supabase = useMemo(() => createClient(), [])

  const { weekStart, weekEnd } = useMemo(() => {
    const start = addDays(getWeekStart(new Date()), weekOffset * 7)
    const end = addDays(start, 6)
    return { weekStart: start, weekEnd: end }
  }, [weekOffset])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        const weekStartStr = formatDateISO(weekStart)
        const weekEndStr = formatDateISO(weekEnd)

        // Fetch all data in parallel
        const [householdResult, childrenResult, membersResult, pickupsResult, mealsResult, recipesResult, eventsResult, tasksResult] = await Promise.all([
          supabase.from('households').select('*').single(),
          supabase.from('children').select('*').order('sort_order'),
          supabase.from('household_members').select('*'),
          supabase.from('pickups').select(`*, child:children(*), picker:household_members(*)`).gte('date', weekStartStr).lte('date', weekEndStr),
          supabase.from('meals').select(`*, recipe:recipes(*)`).gte('date', weekStartStr).lte('date', weekEndStr),
          supabase.from('recipes').select('*').order('name'),
          // Fetch events that overlap with this week (start <= weekEnd AND (end >= weekStart OR end IS NULL))
          supabase.from('member_events').select('*').lte('date', weekEndStr).or(`end_date.gte.${weekStartStr},end_date.is.null`),
          // Fetch child tasks for this week
          supabase.from('child_tasks').select('*').gte('date', weekStartStr).lte('date', weekEndStr).order('date').order('time'),
        ])

        // Check for critical errors
        if (householdResult.error && householdResult.error.code !== 'PGRST116') {
          throw new Error('Kunne ikke laste husstand')
        }
        if (childrenResult.error) throw new Error('Kunne ikke laste barn')
        if (membersResult.error) throw new Error('Kunne ikke laste familiemedlemmer')
        if (pickupsResult.error) throw new Error('Kunne ikke laste hentinger')
        if (mealsResult.error) throw new Error('Kunne ikke laste måltider')
        if (recipesResult.error) throw new Error('Kunne ikke laste oppskrifter')
        if (eventsResult.error) throw new Error('Kunne ikke laste hendelser')
        if (tasksResult.error) throw new Error('Kunne ikke laste oppgaver')

        setHousehold(householdResult.data)
        setChildren(childrenResult.data || [])
        setMembers(membersResult.data || [])
        setPickups(pickupsResult.data || [])
        setMeals(mealsResult.data || [])
        setRecipes(recipesResult.data || [])
        setMemberEvents(eventsResult.data || [])
        setChildTasks(tasksResult.data || [])

        // Fetch week context for this week
        if (householdResult.data) {
          const { data: contextData } = await supabase
            .from('week_contexts')
            .select('context')
            .eq('household_id', householdResult.data.id)
            .eq('week_start', weekStartStr)
            .maybeSingle()
          setWeekContext(contextData?.context || '')
        }
      } catch (err) {
        console.error('Week edit page error:', err)
        setError(err instanceof Error ? err.message : 'En feil oppstod')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [supabase, weekStart, weekEnd, reloadTrigger])

  const triggerReload = () => setReloadTrigger(prev => prev + 1)

  const handlePickupChange = async (childId: string, date: string, pickerId: string | null) => {
    if (!household) return

    setSaving(true)

    // Find existing pickup
    const existing = pickups.find(p => p.child_id === childId && p.date === date)

    if (existing) {
      if (pickerId) {
        // Update existing
        await supabase
          .from('pickups')
          .update({ picker_id: pickerId })
          .eq('id', existing.id)
      } else {
        // Delete if picker is null
        await supabase
          .from('pickups')
          .delete()
          .eq('id', existing.id)
      }
    } else if (pickerId) {
      // Insert new
      await supabase
        .from('pickups')
        .insert({
          household_id: household.id,
          child_id: childId,
          date,
          picker_id: pickerId,
        })
    }

    // Reload data
    triggerReload()
    setSaving(false)
  }

  const handleWorkCalendarSync = async (pickupId: string, sync: boolean) => {
    setSaving(true)
    try {
      const res = await fetch('/api/calendar/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickupId, syncToWorkCalendar: sync }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Calendar sync error:', data.error)
        showMessage('error', data.error || 'Kunne ikke synkronisere til kalender')
      } else {
        showMessage('success', sync ? 'Lagt til i jobbkalender' : 'Fjernet fra jobbkalender')
      }
      triggerReload()
    } catch (error) {
      console.error('Calendar sync error:', error)
      showMessage('error', 'Noe gikk galt med kalendersync')
    } finally {
      setSaving(false)
    }
  }

  const saveWeekContext = async () => {
    if (!household) return

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
    if (!confirm('Kopiere henting og middager fra forrige uke? Eksisterende data for denne uken beholdes.')) return

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
        await supabase.from('pickups').upsert(copyPickups, { onConflict: 'household_id,child_id,date' })
      }
      if (copyMeals.length > 0) {
        await supabase.from('meals').upsert(copyMeals, { onConflict: 'household_id,date' })
      }

      showMessage('success', `Kopiert ${copyPickups.length} hentinger og ${copyMeals.length} middager`)
      triggerReload()
    } catch (err) {
      console.error('Error copying last week:', err)
      showMessage('error', 'Kunne ikke kopiere fra forrige uke')
    } finally {
      setSaving(false)
    }
  }

  // Clear all pickups and meals for this week
  const clearWeek = async () => {
    if (!household) return
    if (!confirm('Slette alle hentinger og middager for denne uken? Dette kan ikke angres.')) return

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

      showMessage('success', 'Uken er tømt')
      triggerReload()
    } catch (err) {
      console.error('Error clearing week:', err)
      showMessage('error', 'Kunne ikke tømme uken')
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

    setSaving(true)

    try {
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
        await supabase
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
        await supabase
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

  const handleMealChange = async (date: string, mealName: string | null, recipeId?: string) => {
    if (!household) return

    setSaving(true)

    // Find existing meal
    const existing = meals.find(m => m.date === date)

    if (existing) {
      if (mealName) {
        // Update existing - use recipe_id if provided, otherwise custom_meal
        await supabase
          .from('meals')
          .update({
            recipe_id: recipeId || null,
            custom_meal: recipeId ? null : mealName,
          })
          .eq('id', existing.id)
      } else {
        // Delete if meal is null
        await supabase
          .from('meals')
          .delete()
          .eq('id', existing.id)
      }
    } else if (mealName) {
      // Insert new - use recipe_id if provided, otherwise custom_meal
      await supabase
        .from('meals')
        .insert({
          household_id: household.id,
          date,
          recipe_id: recipeId || null,
          custom_meal: recipeId ? null : mealName,
        })
    }

    // Reload data
    triggerReload()
    setSaving(false)
  }

  // AI Suggestion functions
  const fetchAISuggestions = async () => {
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
          throw new Error('Du har sendt for mange forespørsler. Vent litt før du prøver igjen.')
        } else if (response.status === 401) {
          throw new Error('Du må være logget inn for å bruke AI-forslag.')
        } else if (response.status === 503) {
          throw new Error('AI-tjenesten er midlertidig utilgjengelig. Prøv igjen senere.')
        }
        throw new Error(data.error || 'Kunne ikke hente forslag fra AI. Sjekk at OpenRouter API-nøkkel er konfigurert.')
      }

      const data = await response.json()
      if (!data.suggestions || data.suggestions.length === 0) {
        throw new Error('AI ga ingen forslag. Prøv å legge til mer kontekst for uken.')
      }
      setAiSuggestions(data.suggestions)
    } catch (err) {
      console.error('AI suggestion error:', err)
      const errorMessage = err instanceof Error ? err.message : 'En uventet feil oppstod. Prøv igjen.'
      setAiError(errorMessage)
    } finally {
      setAiLoading(false)
    }
  }

  const handleAcceptSuggestion = async (suggestion: MealSuggestion, saveAsRecipe: boolean) => {
    if (!household) return

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

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 rounded-xl w-48" style={{ background: 'var(--sand)' }} />
        <div className="h-80 rounded-2xl" style={{ background: 'var(--sand)' }} />
      </div>
    )
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
            Prøv å laste siden på nytt.
          </p>
          <button onClick={triggerReload} className="btn btn-primary">
            Prøv igjen
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
            Ingen barn lagt til
          </h2>
          <p className="mb-8 max-w-md mx-auto" style={{ color: 'var(--muted)' }}>
            Du må legge til barn i innstillingene før du kan planlegge uken.
          </p>
          <Link href="/innstillinger" className="btn btn-primary">
            Gå til innstillinger
          </Link>
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
            Planlegg uke
          </h1>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            Tildel henting og middag for hele uken
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(weekOffset - 1)}
            className="p-2 rounded-xl transition-colors"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            aria-label="Forrige uke"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span
            className="px-4 py-2 text-sm font-medium rounded-xl"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            {formatWeekHeader(weekStart)}
          </span>
          <button
            onClick={() => setWeekOffset(weekOffset + 1)}
            className="p-2 rounded-xl transition-colors"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            aria-label="Neste uke"
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
              I dag
            </button>
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
            {showWeekContext ? 'Skjul' : 'Legg til'} ukekontekst for AI
            {weekContext && !showWeekContext && (
              <span className="inline-flex items-center justify-center w-2 h-2 rounded-full" style={{ background: 'var(--color-sage)' }} />
            )}
          </button>

          {showWeekContext && (
            <div className="mt-3 space-y-2">
              <textarea
                value={weekContext}
                onChange={(e) => setWeekContext(e.target.value)}
                placeholder="F.eks: Vi har besøk på onsdag. Torsdag er det fotballtrening så vi trenger noe raskt."
                rows={2}
                className="input text-sm resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={saveWeekContext}
                  disabled={savingContext}
                  className="btn btn-secondary text-xs py-1.5 px-3"
                >
                  {savingContext ? 'Lagrer...' : 'Lagre kontekst'}
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  Denne konteksten brukes kun for denne uken
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
            title="Kopier fra forrige uke"
            aria-label="Kopier fra forrige uke"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span className="hidden sm:inline">Kopier</span>
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
            title="Tøm uken"
            aria-label="Tøm uken"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <span className="hidden sm:inline">Tøm</span>
          </button>

          {/* AI Suggestion button */}
          <button
            onClick={fetchAISuggestions}
            disabled={aiLoading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:scale-[1.02]"
            style={{
              background: 'linear-gradient(135deg, var(--color-honey) 0%, #D4A84B 100%)',
              color: 'white',
              boxShadow: '0 2px 8px rgba(229, 185, 94, 0.3)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 10.5v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
              <path d="M12 12v2"/>
              <path d="M10 22h4"/>
              <path d="M10 18h4v4h-4z"/>
            </svg>
            {aiLoading ? 'Genererer...' : 'Foreslå middager med AI'}
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
          Lagrer...
        </div>
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
          Legg til hendelse
        </button>
        {memberEvents.length > 0 && (
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            {memberEvents.length} hendelse{memberEvents.length !== 1 && 'r'} denne uken
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
        recipes={recipes}
        weekStart={weekStart}
        editable={true}
        onPickupChange={handlePickupChange}
        onMealChange={handleMealChange}
        onEventClick={openEventModal}
        onWorkCalendarSync={handleWorkCalendarSync}
        childTasks={childTasks}
        onTaskToggle={handleTaskToggle}
        onTaskClick={handleTaskClick}
        onAddTask={handleAddTask}
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
          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>Tips</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Klikk på en celle for å velge hvem som henter, eller bruk AI-forslag for middager.
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
      />

      {/* Event Modal */}
      {showEventModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0, 0, 0, 0.5)' }}
            onClick={closeEventModal}
          />

          {/* Modal */}
          <div
            className="relative w-full max-w-md rounded-2xl p-6 space-y-5 animate-fade-in"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
                {editingEvent ? 'Rediger hendelse' : 'Ny hendelse'}
              </h2>
              <button
                onClick={closeEventModal}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--muted)' }}
                aria-label="Lukk"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Form */}
            <div className="space-y-4">
              {/* Member select */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                  Hvem gjelder det?
                </label>
                <select
                  value={eventForm.member_id}
                  onChange={(e) => setEventForm({ ...eventForm, member_id: e.target.value })}
                  className="input"
                >
                  <option value="">Velg person</option>
                  {members.filter(m => m.is_parent).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                  Tittel
                </label>
                <input
                  type="text"
                  value={eventForm.title}
                  onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                  className="input"
                  placeholder="F.eks. Jobbmiddag, Reise til Bergen"
                />
              </div>

              {/* Event type */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                  Type
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'work', label: '💼 Jobb', bg: 'rgba(126, 182, 196, 0.2)' },
                    { value: 'travel', label: '✈️ Reise', bg: 'rgba(167, 139, 250, 0.2)' },
                    { value: 'family', label: '👨‍👩‍👧 Familie', bg: 'rgba(232, 120, 109, 0.2)' },
                    { value: 'other', label: '📅 Annet', bg: 'rgba(131, 166, 151, 0.2)' },
                  ].map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setEventForm({ ...eventForm, event_type: type.value as MemberEventType })}
                      className="px-3 py-2 rounded-lg text-sm font-medium transition-all"
                      style={{
                        background: type.bg,
                        border: eventForm.event_type === type.value ? '2px solid var(--foreground)' : '2px solid transparent',
                        transform: eventForm.event_type === type.value ? 'scale(1.05)' : undefined,
                      }}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                    Fra dato
                  </label>
                  <input
                    type="date"
                    value={eventForm.date}
                    onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                    Til dato <span style={{ color: 'var(--muted)' }}>(valgfritt)</span>
                  </label>
                  <input
                    type="date"
                    value={eventForm.end_date}
                    onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })}
                    className="input"
                    min={eventForm.date}
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <div>
                {editingEvent && (
                  <button
                    onClick={deleteEvent}
                    disabled={saving}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                    style={{ color: 'var(--color-coral)' }}
                  >
                    Slett
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={closeEventModal}
                  className="btn btn-secondary"
                >
                  Avbryt
                </button>
                <button
                  onClick={saveEvent}
                  disabled={saving || !eventForm.member_id || !eventForm.title || !eventForm.date}
                  className="btn btn-primary"
                >
                  {saving ? 'Lagrer...' : editingEvent ? 'Oppdater' : 'Lagre'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.5)' }}>
          <div
            className="w-full max-w-md rounded-2xl p-6 space-y-4"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
                {editingTask ? 'Rediger oppgave' : 'Ny oppgave'}
              </h3>
              <button
                onClick={closeTaskModal}
                className="p-2 rounded-lg transition-colors hover:opacity-70"
                style={{ color: 'var(--muted)' }}
                aria-label="Lukk"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Child selector */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                  Barn
                </label>
                <select
                  value={taskForm.child_id}
                  onChange={(e) => setTaskForm({ ...taskForm, child_id: e.target.value })}
                  className="input"
                >
                  <option value="">Velg barn...</option>
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                  Hva skal du huske?
                </label>
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  placeholder="Eks: Ta med bleier"
                  maxLength={100}
                  className="input"
                />
              </div>

              {/* Task type */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                  Type
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: 'bring', icon: '🎒', label: 'Ta med' },
                    { value: 'appointment', icon: '🩺', label: 'Avtale' },
                    { value: 'reminder', icon: '📝', label: 'Påminnelse' },
                    { value: 'other', icon: '📌', label: 'Annet' },
                  ].map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setTaskForm({ ...taskForm, task_type: type.value as ChildTaskType })}
                      className="px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1"
                      style={{
                        background: taskForm.task_type === type.value ? 'rgba(229, 185, 94, 0.2)' : 'var(--background)',
                        border: taskForm.task_type === type.value ? '2px solid var(--color-honey)' : '2px solid var(--border)',
                        transform: taskForm.task_type === type.value ? 'scale(1.05)' : undefined,
                      }}
                    >
                      <span>{type.icon}</span>
                      <span>{type.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Date and Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                    Dato
                  </label>
                  <input
                    type="date"
                    value={taskForm.date}
                    onChange={(e) => setTaskForm({ ...taskForm, date: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                    Tidspunkt <span style={{ color: 'var(--muted)' }}>(valgfritt)</span>
                  </label>
                  <input
                    type="time"
                    value={taskForm.time}
                    onChange={(e) => setTaskForm({ ...taskForm, time: e.target.value })}
                    className="input"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                  Notater <span style={{ color: 'var(--muted)' }}>(valgfritt)</span>
                </label>
                <textarea
                  value={taskForm.notes}
                  onChange={(e) => setTaskForm({ ...taskForm, notes: e.target.value })}
                  placeholder="Ekstra detaljer..."
                  className="input"
                  rows={2}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <div>
                {editingTask && (
                  <button
                    onClick={deleteTask}
                    disabled={saving}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                    style={{ color: 'var(--color-coral)' }}
                  >
                    Slett
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={closeTaskModal}
                  className="btn btn-secondary"
                >
                  Avbryt
                </button>
                <button
                  onClick={saveTask}
                  disabled={saving || !taskForm.child_id || !taskForm.title || !taskForm.date}
                  className="btn btn-primary"
                >
                  {saving ? 'Lagrer...' : editingTask ? 'Oppdater' : 'Lagre'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
