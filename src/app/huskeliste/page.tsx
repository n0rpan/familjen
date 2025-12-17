'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getUserHousehold } from '@/lib/supabase/household'
import type {
  Household,
  HouseholdMember,
  Child,
  ChildTaskWithChild,
  HouseholdReminderWithAssignee,
  WishlistWithItems,
  WishlistItem,
} from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'
import {
  NaturalLanguageInput,
  ReminderCard,
  ReminderModal,
  WishlistCard,
  WishlistModal,
  WishlistItemModal,
} from '@/components/remember'
import type { ChildTaskFormData, HouseholdReminderFormData, WishlistFormData, WishlistItemFormData } from '@/components/remember'
import type { ParsedReminder } from '@/lib/schemas'
import { RemindersPageSkeleton } from '@/components/Skeleton'
import { useMicroFeedback } from '@/hooks/useMicroFeedback'

type TabType = 'reminders' | 'wishlists'

export default function HusklistePage() {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('reminders')

  const [household, setHousehold] = useState<Household | null>(null)
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [currentMember, setCurrentMember] = useState<HouseholdMember | null>(null)

  // Reminders state
  const [childTasks, setChildTasks] = useState<ChildTaskWithChild[]>([])
  const [householdReminders, setHouseholdReminders] = useState<HouseholdReminderWithAssignee[]>([])
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [editingReminder, setEditingReminder] = useState<ChildTaskFormData | HouseholdReminderFormData | null>(null)
  const [showNLInput, setShowNLInput] = useState(false)

  // Wishlists state
  const [wishlists, setWishlists] = useState<WishlistWithItems[]>([])
  const [showWishlistModal, setShowWishlistModal] = useState(false)
  const [editingWishlist, setEditingWishlist] = useState<WishlistFormData | null>(null)
  const [showWishlistItemModal, setShowWishlistItemModal] = useState(false)
  const [editingWishlistId, setEditingWishlistId] = useState<string | null>(null)
  const [editingWishlistItem, setEditingWishlistItem] = useState<WishlistItem | null>(null)

  const hasInitialized = useRef(false)
  const supabase = useMemo(() => createClient(), [])

  // Micro-feedback for recently toggled items
  const { markChanged, isRecentlyChanged } = useMicroFeedback(800)

  useEffect(() => {
    if (hasInitialized.current) return
    hasInitialized.current = true
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      // Get household with proper multi-household edge case handling
      const { data: householdData, error: householdError, multipleHouseholds } = await getUserHousehold(supabase)

      if (householdError) {
        throw new Error(t.errors.couldNotLoadHousehold)
      }

      if (!householdData) {
        setHousehold(null)
        setLoading(false)
        return
      }

      // Log warning if user is in multiple households (data integrity issue)
      if (multipleHouseholds) {
        console.warn('User belongs to multiple households - using first one')
      }

      setHousehold(householdData)

      // Get current user
      const { data: { user } } = await supabase.auth.getUser()

      // Parallel fetch all data
      const [
        membersResult,
        childrenResult,
        childTasksResult,
        householdRemindersResult,
        wishlistsResult,
      ] = await Promise.all([
        supabase
          .from('household_members')
          .select('*')
          .eq('household_id', householdData.id),
        supabase
          .from('children')
          .select('*')
          .eq('household_id', householdData.id)
          .order('sort_order'),
        supabase
          .from('child_tasks')
          .select('*, child:children(*)')
          .gte('date', new Date().toISOString().split('T')[0])
          .order('date')
          .order('time'),
        supabase
          .from('household_reminders')
          .select('*, assignee:household_members(*)')
          .eq('household_id', householdData.id)
          .gte('date', new Date().toISOString().split('T')[0])
          .order('date')
          .order('time'),
        supabase
          .from('wishlists')
          .select('*, items:wishlist_items(*)')
          .eq('household_id', householdData.id)
          .order('created_at'),
      ])

      if (membersResult.error) throw new Error(t.errors.couldNotLoadMembers)
      if (childrenResult.error) throw new Error(t.errors.couldNotLoadChildren)

      setMembers(membersResult.data || [])
      setChildren(childrenResult.data || [])

      // Find current member
      const currentMemberData = membersResult.data?.find(m => m.user_id === user?.id)
      setCurrentMember(currentMemberData || null)

      // Process child tasks
      const childTasksData = (childTasksResult.data || []).filter(
        task => task.child && childrenResult.data?.some(c => c.id === task.child_id)
      ) as ChildTaskWithChild[]
      setChildTasks(childTasksData)

      // Process household reminders
      setHouseholdReminders((householdRemindersResult.data || []) as HouseholdReminderWithAssignee[])

      // Process wishlists with owner info
      const wishlistsData = (wishlistsResult.data || []).map(wishlist => {
        let ownerName = ''
        let ownerColor = null

        if (wishlist.member_id) {
          const member = membersResult.data?.find(m => m.id === wishlist.member_id)
          ownerName = member?.name || ''
        } else if (wishlist.child_id) {
          const child = childrenResult.data?.find(c => c.id === wishlist.child_id)
          ownerName = child?.name || ''
          ownerColor = child?.color || null
        }

        return {
          ...wishlist,
          owner_name: ownerName,
          owner_color: ownerColor,
        } as WishlistWithItems
      })
      setWishlists(wishlistsData)

    } catch (err) {
      console.error('Huskeliste error:', err)
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setLoading(false)
    }
  }

  // Group reminders by date category
  const groupedReminders = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const weekEnd = new Date(today)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const allReminders = [
      ...childTasks.map(task => ({ ...task, reminderType: 'child' as const })),
      ...householdReminders.map(rem => ({ ...rem, reminderType: 'household' as const })),
    ].sort((a, b) => {
      const dateA = new Date(a.date)
      const dateB = new Date(b.date)
      if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime()
      if (a.time && b.time) return a.time.localeCompare(b.time)
      if (a.time) return -1
      if (b.time) return 1
      return 0
    })

    const todayReminders: typeof allReminders = []
    const weekReminders: typeof allReminders = []
    const laterReminders: typeof allReminders = []
    const recurringReminders: typeof allReminders = []

    for (const reminder of allReminders) {
      const reminderDate = new Date(reminder.date)
      reminderDate.setHours(0, 0, 0, 0)

      // Check for recurrence
      if ('recurrence_pattern' in reminder && reminder.recurrence_pattern) {
        recurringReminders.push(reminder)
        continue
      }

      if (reminderDate.getTime() === today.getTime()) {
        todayReminders.push(reminder)
      } else if (reminderDate.getTime() < weekEnd.getTime()) {
        weekReminders.push(reminder)
      } else {
        laterReminders.push(reminder)
      }
    }

    return { todayReminders, weekReminders, laterReminders, recurringReminders }
  }, [childTasks, householdReminders])

  // Handle toggle done
  const handleToggleDone = useCallback(async (id: string, done: boolean, type: 'child' | 'household') => {
    // Mark for visual feedback
    markChanged(id)

    if (type === 'child') {
      // Optimistic update
      setChildTasks(prev =>
        prev.map(task =>
          task.id === id ? { ...task, status: done ? 'done' : 'open' } : task
        )
      )

      await supabase
        .from('child_tasks')
        .update({ status: done ? 'done' : 'open' })
        .eq('id', id)
    } else {
      // Optimistic update
      setHouseholdReminders(prev =>
        prev.map(rem =>
          rem.id === id ? { ...rem, status: done ? 'done' : 'open' } : rem
        )
      )

      await supabase
        .from('household_reminders')
        .update({
          status: done ? 'done' : 'open',
          completed_at: done ? new Date().toISOString() : null,
        })
        .eq('id', id)
    }
  }, [supabase, markChanged])

  // Handle save reminder
  const handleSaveReminder = useCallback(async (data: ChildTaskFormData | HouseholdReminderFormData) => {
    if (data.type === 'child') {
      const childData = data as ChildTaskFormData
      if (childData.id) {
        await supabase
          .from('child_tasks')
          .update({
            child_id: childData.child_id,
            date: childData.date,
            time: childData.time,
            task_type: childData.task_type,
            title: childData.title,
            notes: childData.notes,
            recurrence_pattern: childData.recurrence_pattern,
          })
          .eq('id', childData.id)
      } else {
        await supabase.from('child_tasks').insert({
          household_id: household!.id,
          child_id: childData.child_id,
          date: childData.date,
          time: childData.time,
          task_type: childData.task_type,
          title: childData.title,
          notes: childData.notes,
          source: 'manual',
          recurrence_pattern: childData.recurrence_pattern,
        })
      }
    } else {
      const householdData = data as HouseholdReminderFormData
      if (householdData.id) {
        await supabase
          .from('household_reminders')
          .update({
            date: householdData.date,
            time: householdData.time,
            title: householdData.title,
            notes: householdData.notes,
            category: householdData.category,
            priority: householdData.priority,
            assigned_to: householdData.assigned_to,
            recurrence_pattern: householdData.recurrence_pattern,
          })
          .eq('id', householdData.id)
      } else {
        await supabase.from('household_reminders').insert({
          household_id: household!.id,
          date: householdData.date,
          time: householdData.time,
          title: householdData.title,
          notes: householdData.notes,
          category: householdData.category,
          priority: householdData.priority,
          assigned_to: householdData.assigned_to,
          source: 'manual',
          recurrence_pattern: householdData.recurrence_pattern,
        })
      }
    }
    loadData()
  }, [supabase, household])

  // Handle delete reminder
  const handleDeleteReminder = useCallback(async (id: string, type: 'child' | 'household') => {
    if (type === 'child') {
      await supabase.from('child_tasks').delete().eq('id', id)
      setChildTasks(prev => prev.filter(t => t.id !== id))
    } else {
      await supabase.from('household_reminders').delete().eq('id', id)
      setHouseholdReminders(prev => prev.filter(r => r.id !== id))
    }
  }, [supabase])

  // Handle AI parsed reminder
  const handleAIReminder = useCallback(async (parsed: ParsedReminder) => {
    try {
      // Try to match child_id from child_name if not provided
      let childId = parsed.child_id
      if (!childId && parsed.child_name) {
        const matchedChild = children.find(
          c => c.name.toLowerCase() === parsed.child_name?.toLowerCase()
        )
        if (matchedChild) {
          childId = matchedChild.id
        }
      }

      // Create a child task from parsed reminder
      if (childId) {
        const { error } = await supabase.from('child_tasks').insert({
          household_id: household!.id,
          child_id: childId,
          date: parsed.date || new Date().toISOString().split('T')[0],
          time: parsed.time,
          task_type: parsed.task_type,
          title: parsed.title,
          notes: parsed.notes,
          source: 'ai_suggested',
        })
        if (error) {
          console.error('Failed to insert child task:', error)
          setError(t.errors.saveFailed)
          return
        }
      } else {
        // Create as household reminder if no child specified
        const { error } = await supabase.from('household_reminders').insert({
          household_id: household!.id,
          date: parsed.date || new Date().toISOString().split('T')[0],
          time: parsed.time,
          title: parsed.title,
          notes: parsed.notes,
          category: 'other',
          priority: 'normal',
          source: 'ai_suggested',
        })
        if (error) {
          console.error('Failed to insert household reminder:', error)
          setError(t.errors.saveFailed)
          return
        }
      }
      loadData()
      setShowNLInput(false)
    } catch (err) {
      console.error('handleAIReminder error:', err)
      setError(t.errors.generic)
    }
  }, [supabase, household, children, t])

  // Wishlist handlers
  const handleReserveItem = useCallback(async (itemId: string) => {
    if (!currentMember) return
    await supabase
      .from('wishlist_items')
      .update({
        status: 'reserved',
        reserved_by: currentMember.id,
        reserved_at: new Date().toISOString(),
      })
      .eq('id', itemId)
    loadData()
  }, [supabase, currentMember])

  const handleUnreserveItem = useCallback(async (itemId: string) => {
    await supabase
      .from('wishlist_items')
      .update({
        status: 'open',
        reserved_by: null,
        reserved_at: null,
      })
      .eq('id', itemId)
    loadData()
  }, [supabase])

  const handleFulfillItem = useCallback(async (itemId: string) => {
    if (!currentMember) return
    await supabase
      .from('wishlist_items')
      .update({
        status: 'fulfilled',
        fulfilled_by: currentMember.id,
        fulfilled_at: new Date().toISOString(),
      })
      .eq('id', itemId)
    loadData()
  }, [supabase, currentMember])

  const handleDeleteWishlistItem = useCallback(async (itemId: string) => {
    await supabase.from('wishlist_items').delete().eq('id', itemId)
    loadData()
  }, [supabase])

  const handleSaveWishlistItem = useCallback(async (data: WishlistItemFormData) => {
    if (data.id) {
      await supabase
        .from('wishlist_items')
        .update({
          name: data.name,
          description: data.description,
          link: data.link,
          price: data.price,
          currency: data.currency,
          priority: data.priority,
          quantity: data.quantity,
          notes: data.notes,
        })
        .eq('id', data.id)
    } else {
      await supabase.from('wishlist_items').insert({
        wishlist_id: data.wishlist_id,
        name: data.name,
        description: data.description,
        link: data.link,
        price: data.price,
        currency: data.currency,
        priority: data.priority,
        quantity: data.quantity,
        notes: data.notes,
      })
    }
    loadData()
  }, [supabase])

  // Wishlist CRUD handlers
  const handleSaveWishlist = useCallback(async (data: WishlistFormData) => {
    if (data.id) {
      await supabase
        .from('wishlists')
        .update({
          member_id: data.member_id,
          child_id: data.child_id,
          name: data.name,
          occasion: data.occasion,
          occasion_date: data.occasion_date,
          description: data.description,
          is_public: data.is_public,
        })
        .eq('id', data.id)
    } else {
      await supabase.from('wishlists').insert({
        household_id: household!.id,
        member_id: data.member_id,
        child_id: data.child_id,
        name: data.name,
        occasion: data.occasion,
        occasion_date: data.occasion_date,
        description: data.description,
        is_public: data.is_public,
      })
    }
    loadData()
  }, [supabase, household])

  const handleDeleteWishlist = useCallback(async (wishlistId: string) => {
    await supabase.from('wishlists').delete().eq('id', wishlistId)
    setWishlists(prev => prev.filter(w => w.id !== wishlistId))
  }, [supabase])

  if (loading) {
    return <RemindersPageSkeleton />
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
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold font-display mb-3" style={{ color: 'var(--foreground)' }}>
            {error}
          </h2>
          <button onClick={loadData} className="btn btn-primary">
            {t.common.retry}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in pb-24 md:pb-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          {t.remember.title}
        </h1>
        <p className="mt-1" style={{ color: 'var(--muted)' }}>
          {t.remember.subtitle}
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 p-1 rounded-xl w-fit" style={{ background: 'var(--background)' }}>
        <button
          onClick={() => setActiveTab('reminders')}
          className="px-6 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: activeTab === 'reminders' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'reminders' ? 'white' : 'var(--muted)',
          }}
        >
          {t.remember.remindersTab}
        </button>
        <button
          onClick={() => setActiveTab('wishlists')}
          className="px-6 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: activeTab === 'wishlists' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'wishlists' ? 'white' : 'var(--muted)',
          }}
        >
          {t.remember.wishlistsTab}
        </button>
      </div>

      {/* Reminders Tab */}
      {activeTab === 'reminders' && (
        <div className="space-y-6">
          {/* AI Input toggle */}
          {showNLInput ? (
            <div
              className="rounded-2xl p-4"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <NaturalLanguageInput
                onSubmit={handleAIReminder}
                onCancel={() => setShowNLInput(false)}
                defaultDate={new Date().toISOString().split('T')[0]}
              />
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setShowNLInput(true)}
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors flex-1"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                {t.remember.aiInputPlaceholder}
              </button>
              <button
                onClick={() => {
                  setEditingReminder(null)
                  setShowReminderModal(true)
                }}
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t.remember.addReminder}
              </button>
            </div>
          )}

          {/* Today's reminders */}
          {groupedReminders.todayReminders.length > 0 && (
            <ReminderSection
              title={t.remember.todayReminders}
              reminders={groupedReminders.todayReminders}
              onToggle={handleToggleDone}
              onEdit={(reminder) => {
                if (reminder.reminderType === 'child') {
                  const task = reminder as ChildTaskWithChild & { reminderType: 'child' }
                  setEditingReminder({
                    type: 'child',
                    id: task.id,
                    child_id: task.child_id,
                    date: task.date,
                    time: task.time,
                    task_type: task.task_type,
                    title: task.title,
                    notes: task.notes,
                    recurrence_pattern: task.recurrence_pattern,
                  })
                } else {
                  const rem = reminder as HouseholdReminderWithAssignee & { reminderType: 'household' }
                  setEditingReminder({
                    type: 'household',
                    id: rem.id,
                    date: rem.date,
                    time: rem.time,
                    title: rem.title,
                    notes: rem.notes,
                    category: rem.category,
                    priority: rem.priority,
                    assigned_to: rem.assigned_to,
                    recurrence_pattern: rem.recurrence_pattern,
                  })
                }
                setShowReminderModal(true)
              }}
              onDelete={handleDeleteReminder}
              isRecentlyChanged={isRecentlyChanged}
              t={t}
            />
          )}

          {/* This week's reminders */}
          {groupedReminders.weekReminders.length > 0 && (
            <ReminderSection
              title={t.remember.weekReminders}
              reminders={groupedReminders.weekReminders}
              onToggle={handleToggleDone}
              onEdit={(reminder) => {
                if (reminder.reminderType === 'child') {
                  const task = reminder as ChildTaskWithChild & { reminderType: 'child' }
                  setEditingReminder({
                    type: 'child',
                    id: task.id,
                    child_id: task.child_id,
                    date: task.date,
                    time: task.time,
                    task_type: task.task_type,
                    title: task.title,
                    notes: task.notes,
                    recurrence_pattern: task.recurrence_pattern,
                  })
                } else {
                  const rem = reminder as HouseholdReminderWithAssignee & { reminderType: 'household' }
                  setEditingReminder({
                    type: 'household',
                    id: rem.id,
                    date: rem.date,
                    time: rem.time,
                    title: rem.title,
                    notes: rem.notes,
                    category: rem.category,
                    priority: rem.priority,
                    assigned_to: rem.assigned_to,
                    recurrence_pattern: rem.recurrence_pattern,
                  })
                }
                setShowReminderModal(true)
              }}
              onDelete={handleDeleteReminder}
              isRecentlyChanged={isRecentlyChanged}
              t={t}
            />
          )}

          {/* Later reminders */}
          {groupedReminders.laterReminders.length > 0 && (
            <ReminderSection
              title={t.remember.laterReminders}
              reminders={groupedReminders.laterReminders}
              onToggle={handleToggleDone}
              onEdit={(reminder) => {
                if (reminder.reminderType === 'child') {
                  const task = reminder as ChildTaskWithChild & { reminderType: 'child' }
                  setEditingReminder({
                    type: 'child',
                    id: task.id,
                    child_id: task.child_id,
                    date: task.date,
                    time: task.time,
                    task_type: task.task_type,
                    title: task.title,
                    notes: task.notes,
                    recurrence_pattern: task.recurrence_pattern,
                  })
                } else {
                  const rem = reminder as HouseholdReminderWithAssignee & { reminderType: 'household' }
                  setEditingReminder({
                    type: 'household',
                    id: rem.id,
                    date: rem.date,
                    time: rem.time,
                    title: rem.title,
                    notes: rem.notes,
                    category: rem.category,
                    priority: rem.priority,
                    assigned_to: rem.assigned_to,
                    recurrence_pattern: rem.recurrence_pattern,
                  })
                }
                setShowReminderModal(true)
              }}
              onDelete={handleDeleteReminder}
              isRecentlyChanged={isRecentlyChanged}
              t={t}
            />
          )}

          {/* Recurring reminders */}
          {groupedReminders.recurringReminders.length > 0 && (
            <ReminderSection
              title={t.remember.recurringReminders}
              reminders={groupedReminders.recurringReminders}
              onToggle={handleToggleDone}
              onEdit={(reminder) => {
                if (reminder.reminderType === 'child') {
                  const task = reminder as ChildTaskWithChild & { reminderType: 'child' }
                  setEditingReminder({
                    type: 'child',
                    id: task.id,
                    child_id: task.child_id,
                    date: task.date,
                    time: task.time,
                    task_type: task.task_type,
                    title: task.title,
                    notes: task.notes,
                    recurrence_pattern: task.recurrence_pattern,
                  })
                } else {
                  const rem = reminder as HouseholdReminderWithAssignee & { reminderType: 'household' }
                  setEditingReminder({
                    type: 'household',
                    id: rem.id,
                    date: rem.date,
                    time: rem.time,
                    title: rem.title,
                    notes: rem.notes,
                    category: rem.category,
                    priority: rem.priority,
                    assigned_to: rem.assigned_to,
                    recurrence_pattern: rem.recurrence_pattern,
                  })
                }
                setShowReminderModal(true)
              }}
              onDelete={handleDeleteReminder}
              isRecentlyChanged={isRecentlyChanged}
              t={t}
            />
          )}

          {/* Empty state */}
          {childTasks.length === 0 && householdReminders.length === 0 && (
            <div
              className="rounded-2xl p-8 text-center"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <div
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
                style={{ background: 'rgba(229, 185, 94, 0.15)' }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                {t.remember.noReminders}
              </h3>
              <p className="mb-6" style={{ color: 'var(--muted)' }}>
                {t.remember.noRemindersDesc}
              </p>
              <button
                onClick={() => setShowNLInput(true)}
                className="px-6 py-3 rounded-xl font-medium"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                {t.remember.addFirstReminder}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Wishlists Tab */}
      {activeTab === 'wishlists' && (
        <div className="space-y-6">
          {/* Create wishlist button */}
          <button
            onClick={() => {
              setEditingWishlist(null)
              setShowWishlistModal(true)
            }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t.wishlists.createWishlist}
          </button>

          {wishlists.length === 0 ? (
            <div
              className="rounded-2xl p-8 text-center"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <div
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
                style={{ background: 'rgba(167, 139, 250, 0.15)' }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                {t.wishlists.noWishlists}
              </h3>
              <p className="mb-6" style={{ color: 'var(--muted)' }}>
                {t.wishlists.noWishlistsDesc}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {wishlists.map(wishlist => (
                <WishlistCard
                  key={wishlist.id}
                  wishlist={wishlist}
                  currentMemberId={currentMember?.id || null}
                  onAddItem={(wishlistId) => {
                    setEditingWishlistId(wishlistId)
                    setEditingWishlistItem(null)
                    setShowWishlistItemModal(true)
                  }}
                  onEditItem={(item) => {
                    setEditingWishlistId(item.wishlist_id)
                    setEditingWishlistItem(item)
                    setShowWishlistItemModal(true)
                  }}
                  onReserveItem={handleReserveItem}
                  onUnreserveItem={handleUnreserveItem}
                  onFulfillItem={handleFulfillItem}
                  onDeleteItem={handleDeleteWishlistItem}
                  onEditWishlist={() => {
                    setEditingWishlist({
                      id: wishlist.id,
                      member_id: wishlist.member_id,
                      child_id: wishlist.child_id,
                      name: wishlist.name,
                      occasion: wishlist.occasion,
                      occasion_date: wishlist.occasion_date,
                      description: wishlist.description,
                      is_public: wishlist.is_public,
                    })
                    setShowWishlistModal(true)
                  }}
                  onDeleteWishlist={() => {
                    if (confirm(t.common.confirmDelete)) {
                      handleDeleteWishlist(wishlist.id)
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reminder Modal */}
      <ReminderModal
        isOpen={showReminderModal}
        onClose={() => {
          setShowReminderModal(false)
          setEditingReminder(null)
        }}
        onSave={handleSaveReminder}
        type={children.length > 0 ? 'child' : 'household'}
        children={children}
        members={members}
        initialData={editingReminder || undefined}
      />

      {/* Wishlist Item Modal */}
      <WishlistItemModal
        isOpen={showWishlistItemModal}
        onClose={() => {
          setShowWishlistItemModal(false)
          setEditingWishlistId(null)
          setEditingWishlistItem(null)
        }}
        onSave={handleSaveWishlistItem}
        wishlistId={editingWishlistId || ''}
        initialData={editingWishlistItem}
      />

      {/* Wishlist Modal */}
      <WishlistModal
        isOpen={showWishlistModal}
        onClose={() => {
          setShowWishlistModal(false)
          setEditingWishlist(null)
        }}
        onSave={handleSaveWishlist}
        members={members}
        children={children}
        currentMemberId={currentMember?.id || null}
        initialData={editingWishlist}
      />
    </div>
  )
}

// Helper component for reminder sections
interface ReminderSectionProps {
  title: string
  reminders: Array<(ChildTaskWithChild | HouseholdReminderWithAssignee) & { reminderType: 'child' | 'household' }>
  onToggle: (id: string, done: boolean, type: 'child' | 'household') => void
  onEdit: (reminder: (ChildTaskWithChild | HouseholdReminderWithAssignee) & { reminderType: 'child' | 'household' }) => void
  onDelete: (id: string, type: 'child' | 'household') => void
  isRecentlyChanged: (id: string) => boolean
  t: ReturnType<typeof useLanguage>['t']
}

function ReminderSection({ title, reminders, onToggle, onEdit, onDelete, isRecentlyChanged, t }: ReminderSectionProps) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="p-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
          {title}
        </h2>
      </div>
      <div className="p-2 space-y-1">
        {reminders.map(reminder => (
          <ReminderCard
            key={reminder.id}
            reminder={reminder}
            type={reminder.reminderType}
            onToggle={(id, done) => onToggle(id, done, reminder.reminderType)}
            onEdit={() => onEdit(reminder)}
            onDelete={() => onDelete(reminder.id, reminder.reminderType)}
            isRecentlyChanged={isRecentlyChanged(reminder.id)}
          />
        ))}
      </div>
    </div>
  )
}
