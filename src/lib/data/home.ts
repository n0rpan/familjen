import { SupabaseClient } from '@supabase/supabase-js'
import { formatDateISO, addDays, isWeekend, getHoliday, type Holiday } from '@/lib/utils'
import type {
  Child,
  HouseholdMember,
  PickupWithDetails,
  MealWithRecipe,
  MemberEvent,
  HouseholdEvent,
  ChildTaskWithChild,
  HouseholdReminderWithAssignee,
  AIHeadsUp,
  HeadsUpType,
} from '@/lib/types'

export interface HomePagePhoto {
  id: string
  title: string | null
  taken_at: string | null
  storage_path: string
  thumbnail_path: string | null
  child_name: string | null
  image_url: string | null
}

export interface HomePageData {
  children: Child[]
  members: HouseholdMember[]
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  memberEvents: MemberEvent[]
  householdEvents: HouseholdEvent[]
  childTasks: ChildTaskWithChild[]
  householdReminders: HouseholdReminderWithAssignee[]
  holidays: Holiday[]
  recentPhotos: HomePagePhoto[]
  aiHeadsUps: AIHeadsUp[]
  weekStart: Date
  weekEnd: Date
  todayStr: string
  weekStartStr: string
  weekEndStr: string
}

export interface HomePageDataResult {
  data: HomePageData | null
  error: Error | null
}

/**
 * Fetches all data needed for the home page in parallel
 * Extracts data fetching logic from page.tsx for better maintainability
 */
export async function getHomePageData(
  supabase: SupabaseClient,
  householdId: string
): Promise<HomePageDataResult> {
  // Rolling 7-day view starting from today
  const today = new Date()
  const todayStr = formatDateISO(today)
  const weekStart = today
  const weekEnd = addDays(weekStart, 6)
  const weekStartStr = formatDateISO(weekStart)
  const weekEndStr = formatDateISO(weekEnd)

  // Fetch all data in parallel with specific columns where possible
  const [
    childrenResult,
    membersResult,
    pickupsResult,
    mealsResult,
    eventsResult,
    householdEventsResult,
    tasksResult,
    remindersResult,
    holidaysResult,
    photosResult,
  ] = await Promise.all([
    supabase
      .from('children')
      .select('id, household_id, name, color, location_name, location_type, sort_order, birth_date, allergies, created_at, updated_at')
      .eq('household_id', householdId)
      .order('sort_order'),
    supabase
      .from('household_members')
      .select('id, household_id, name, short_name, is_parent, is_household_admin, user_id, email, birth_date, work_email, allergies, language_preference, ics_calendar_url, ics_last_sync_at, ics_sync_error, created_at, updated_at')
      .eq('household_id', householdId),
    supabase
      .from('pickups')
      .select('*, child:children(*), picker:household_members(*)')
      .eq('household_id', householdId)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr),
    supabase
      .from('meals')
      .select('*, recipe:recipes(*)')
      .eq('household_id', householdId)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr),
    // Fetch events that overlap with this week
    supabase
      .from('member_events')
      .select('id, household_id, member_id, date, end_date, title, event_type, source, source_email, google_event_id, ics_uid, created_at, updated_at')
      .eq('household_id', householdId)
      .lte('date', weekEndStr)
      .or(`end_date.gte.${weekStartStr},end_date.is.null`),
    // Fetch household events that overlap with this week
    supabase
      .from('household_events')
      .select('*')
      .eq('household_id', householdId)
      .lte('event_date', weekEndStr)
      .or(`end_date.gte.${weekStartStr},end_date.is.null`)
      .order('event_date')
      .order('event_time'),
    // Fetch child tasks for this week
    supabase
      .from('child_tasks')
      .select('*, child:children(*)')
      .eq('household_id', householdId)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .order('date')
      .order('time'),
    // Fetch household reminders for this week
    supabase
      .from('household_reminders')
      .select('*, assignee:household_members(*)')
      .eq('household_id', householdId)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .eq('status', 'open')
      .order('date')
      .order('time'),
    // Fetch holidays (system-wide and household-specific)
    supabase
      .from('calendar_events')
      .select('date, name')
      .or(`household_id.is.null,household_id.eq.${householdId}`)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .eq('event_type', 'holiday'),
    // Fetch recent photos from integrations
    supabase
      .from('external_photos')
      .select('id, title, taken_at, storage_path, thumbnail_path, external_integrations!inner(household_id), children(name)')
      .eq('external_integrations.household_id', householdId)
      .gt('expires_at', new Date().toISOString())
      .order('taken_at', { ascending: false })
      .limit(4),
  ])

  // Check for non-critical errors (page still loads if these fail)
  if (holidaysResult.error) {
    console.warn('Non-critical: Could not load holidays', holidaysResult.error)
  }
  if (householdEventsResult.error) {
    console.warn('Non-critical: Could not load household events', householdEventsResult.error)
  }

  const queryError =
    childrenResult.error ||
    membersResult.error ||
    pickupsResult.error ||
    mealsResult.error ||
    eventsResult.error ||
    tasksResult.error ||
    remindersResult.error ||
    photosResult.error

  if (queryError) {
    console.error('Error loading home page data:', queryError)
    return { data: null, error: new Error(queryError.message) }
  }

  // Generate birthdays from members and children with birth_date
  const currentYear = today.getFullYear()
  const birthdays: Holiday[] = []

  // Add member birthdays
  membersResult.data?.forEach(member => {
    if (member.birth_date) {
      const birthDate = new Date(member.birth_date)
      const thisYearBirthday = `${currentYear}-${String(birthDate.getMonth() + 1).padStart(2, '0')}-${String(birthDate.getDate()).padStart(2, '0')}`
      if (thisYearBirthday >= weekStartStr && thisYearBirthday <= weekEndStr) {
        birthdays.push({
          date: thisYearBirthday,
          name: member.name,  // Will be formatted with translation in component
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
          name: child.name,  // Will be formatted with translation in component
          type: 'birthday',
        })
      }
    }
  })

  // Merge holidays and birthdays
  const rawHolidays = holidaysResult.data || []
  const holidays: Holiday[] = [
    ...rawHolidays.map(h => ({ ...h, type: 'holiday' as const })),
    ...birthdays,
  ]

  // Fetch AI Heads Up items (needs pickups for conflict detection)
  const pickups = (pickupsResult.data || []) as PickupWithDetails[]
  const children = childrenResult.data || []
  const members = membersResult.data || []
  const aiHeadsUps = await getAIHeadsUps(supabase, householdId, pickups, children, members)

  // Transform photos data - filter out pending and generate signed URLs
  const actualPhotos = (photosResult.data || []).filter(
    (photo) => photo.storage_path && !photo.storage_path.startsWith('pending/')
  )

  const recentPhotos = await Promise.all(
    actualPhotos.map(async (photo) => {
      // children is returned as a single object when using foreign key relation
      const childData = photo.children as unknown as { name: string } | null

      // Generate signed URL
      let imageUrl: string | null = null
      try {
        const { data: signedUrlData } = await supabase.storage
          .from('external-photos')
          .createSignedUrl(photo.storage_path, 3600) // 1 hour
        imageUrl = signedUrlData?.signedUrl || null
      } catch (err) {
        console.error('Failed to get signed URL:', err)
      }

      return {
        id: photo.id,
        title: photo.title,
        taken_at: photo.taken_at,
        storage_path: photo.storage_path,
        thumbnail_path: photo.thumbnail_path,
        child_name: childData?.name || null,
        image_url: imageUrl,
      }
    })
  )

  return {
    data: {
      children,
      members,
      pickups,
      meals: (mealsResult.data || []) as MealWithRecipe[],
      memberEvents: (eventsResult.data || []) as MemberEvent[],
      householdEvents: (householdEventsResult.data || []) as HouseholdEvent[],
      childTasks: (tasksResult.data || []) as ChildTaskWithChild[],
      householdReminders: (remindersResult.data || []) as HouseholdReminderWithAssignee[],
      holidays,
      recentPhotos,
      aiHeadsUps,
      weekStart,
      weekEnd,
      todayStr,
      weekStartStr,
      weekEndStr,
    },
    error: null,
  }
}

/**
 * Get today's summary from the home page data
 */
export function getTodaySummary(data: HomePageData) {
  const todayPickups = data.pickups.filter(p => p.date === data.todayStr)
  const todayMeal = data.meals.find(m => m.date === data.todayStr) || null
  const todayTasks = data.childTasks.filter(t => t.date === data.todayStr)
  const todayReminders = data.householdReminders.filter(r => r.date === data.todayStr)
  // Household events: include if today falls within event_date to end_date range
  const todayHouseholdEvents = data.householdEvents.filter(e => {
    const startDate = e.event_date
    const endDate = e.end_date || e.event_date
    return data.todayStr >= startDate && data.todayStr <= endDate
  })

  return {
    date: data.todayStr,
    pickups: todayPickups,
    meal: todayMeal,
    tasks: todayTasks,
    reminders: todayReminders,
    householdEvents: todayHouseholdEvents,
  }
}

/**
 * Calculate attention items for today
 */
export function getAttentionStatus(data: HomePageData) {
  const today = new Date(data.todayStr)
  const todayPickups = data.pickups.filter(p => p.date === data.todayStr)
  const todayMeal = data.meals.find(m => m.date === data.todayStr) || null
  const todayTasks = data.childTasks.filter(t => t.date === data.todayStr)

  // Check if today is a non-working day (weekend or holiday)
  const holiday = getHoliday(today, data.holidays)
  const isNonWorkingDay = isWeekend(today) || !!holiday

  // Only flag missing pickups on working days
  const childrenWithoutPickup = isNonWorkingDay ? [] : data.children.filter(child =>
    !todayPickups.some(p => p.child_id === child.id && p.picker_id)
  )
  const noMeal = !todayMeal?.recipe_id && !todayMeal?.custom_meal
  const openTasks = todayTasks.filter(task => task.status === 'open')

  let attentionCount = 0
  if (childrenWithoutPickup.length > 0) attentionCount += childrenWithoutPickup.length
  if (noMeal) attentionCount += 1

  return {
    childrenWithoutPickup,
    noMeal,
    openTasks,
    attentionCount,
    isAllReady: attentionCount === 0,
  }
}

/**
 * Get priority score for sorting (lower = higher priority)
 */
function getHeadsUpPriorityScore(item: AIHeadsUp): number {
  if (item.hasConflict) return 0 // Conflicts first
  if (item.type === 'closure') return 1 // School closures
  if (item.type === 'suggestion') return 2 // AI suggestions
  if (item.type === 'task') return 3 // Upcoming tasks
  return 4 // Member events without conflict
}

/**
 * Detect pickup conflicts for member events
 */
function detectPickupConflicts(
  memberEvents: Array<{ id: string; member_id: string; date: string; end_date: string | null }>,
  pickups: PickupWithDetails[]
): Map<string, boolean> {
  const conflicts = new Map<string, boolean>()

  for (const event of memberEvents) {
    const eventStart = event.date
    const eventEnd = event.end_date || event.date

    const hasConflict = pickups.some(pickup =>
      pickup.picker_id === event.member_id &&
      pickup.date >= eventStart &&
      pickup.date <= eventEnd
    )

    conflicts.set(event.id, hasConflict)
  }

  return conflicts
}

/**
 * Fetch AI Heads Up items from multiple sources
 * Returns up to 10 items sorted by priority then date
 */
export async function getAIHeadsUps(
  supabase: SupabaseClient,
  householdId: string,
  pickups: PickupWithDetails[],
  children: Child[],
  members: HouseholdMember[]
): Promise<AIHeadsUp[]> {
  const today = new Date()
  const todayStr = formatDateISO(today)
  const threeDaysLater = formatDateISO(addDays(today, 3))
  const sevenDaysLater = formatDateISO(addDays(today, 7))

  // Run all queries in parallel
  const [suggestionsResult, closuresResult, tasksResult, memberEventsResult] = await Promise.all([
    // 1. AI Suggestions (pending, next 7 days)
    supabase
      .from('external_suggestions')
      .select(`
        id, suggested_type, suggested_title, suggested_description,
        suggested_date, suggested_time, suggested_child_id, confidence_score,
        integration:external_integrations(service, display_name),
        child:children(name)
      `)
      .eq('household_id', householdId)
      .eq('status', 'pending')
      .gte('suggested_date', todayStr)
      .lte('suggested_date', sevenDaysLater)
      .order('suggested_date')
      .limit(10),

    // 2. School closures/absences (next 7 days)
    supabase
      .from('external_events')
      .select(`
        id, title, description, event_date, end_date, event_time, event_type,
        integration:external_integrations!inner(service, display_name, household_id)
      `)
      .eq('external_integrations.household_id', householdId)
      .in('event_type', ['school_closure', 'school_absence'])
      .eq('is_hidden', false)
      .gte('event_date', todayStr)
      .lte('event_date', sevenDaysLater)
      .order('event_date')
      .limit(10),

    // 3. Child tasks (future only, next 3 days, bring/appointment)
    supabase
      .from('child_tasks')
      .select(`id, title, notes, date, time, task_type, child:children(id, name)`)
      .eq('household_id', householdId)
      .in('task_type', ['bring', 'appointment'])
      .eq('status', 'open')
      .gt('date', todayStr) // Future only
      .lte('date', threeDaysLater)
      .order('date')
      .limit(10),

    // 4. Member events (overlapping next 7 days)
    supabase
      .from('member_events')
      .select(`id, title, date, end_date, event_type, member_id, member:household_members(id, name, short_name)`)
      .eq('household_id', householdId)
      .lte('date', sevenDaysLater)
      .or(`end_date.gte.${todayStr},end_date.is.null,date.gte.${todayStr}`)
      .order('date')
      .limit(10),
  ])

  // Log non-critical errors but continue
  if (suggestionsResult.error) console.warn('Could not load AI suggestions:', suggestionsResult.error)
  if (closuresResult.error) console.warn('Could not load closures:', closuresResult.error)
  if (tasksResult.error) console.warn('Could not load tasks for heads up:', tasksResult.error)
  if (memberEventsResult.error) console.warn('Could not load member events:', memberEventsResult.error)

  const headsUps: AIHeadsUp[] = []

  // Detect conflicts for member events
  const memberEventsData = memberEventsResult.data || []
  const conflicts = detectPickupConflicts(memberEventsData, pickups)

  // Transform suggestions
  for (const s of suggestionsResult.data || []) {
    const childData = s.child as unknown as { name: string } | null
    const integrationData = s.integration as unknown as { service: string; display_name: string } | null

    headsUps.push({
      id: `suggestion-${s.id}`,
      type: 'suggestion',
      priority: s.confidence_score && s.confidence_score > 0.8 ? 'high' : 'normal',
      title: s.suggested_title,
      description: s.suggested_description,
      date: s.suggested_date || todayStr,
      endDate: null,
      time: s.suggested_time?.substring(0, 5) || null,
      childId: s.suggested_child_id,
      childName: childData?.name || null,
      memberId: null,
      memberName: null,
      hasConflict: false,
      source: {
        table: 'external_suggestions',
        id: s.id,
        sourceType: 'suggestion',
        displayName: integrationData?.display_name || integrationData?.service || undefined,
      },
      href: '/feed',
    })
  }

  // Transform closures
  for (const c of closuresResult.data || []) {
    headsUps.push({
      id: `closure-${c.id}`,
      type: 'closure',
      priority: 'high',
      title: c.title,
      description: c.description,
      date: c.event_date,
      endDate: c.end_date,
      time: c.event_time?.substring(0, 5) || null,
      childId: null,
      childName: null,
      memberId: null,
      memberName: null,
      hasConflict: false,
      source: {
        table: 'external_events',
        id: c.id,
        sourceType: 'closure',
      },
      href: '/uke',
    })
  }

  // Transform tasks
  for (const t of tasksResult.data || []) {
    const childData = t.child as unknown as { id: string; name: string } | null

    headsUps.push({
      id: `task-${t.id}`,
      type: 'task',
      priority: t.task_type === 'appointment' ? 'high' : 'normal',
      title: t.title,
      description: t.notes,
      date: t.date,
      endDate: null,
      time: t.time?.substring(0, 5) || null,
      childId: childData?.id || null,
      childName: childData?.name || null,
      memberId: null,
      memberName: null,
      hasConflict: false,
      source: {
        table: 'child_tasks',
        id: t.id,
        sourceType: 'task',
      },
      href: '/uke',
    })
  }

  // Transform member events
  for (const e of memberEventsData) {
    const memberData = e.member as unknown as { id: string; name: string; short_name: string | null } | null
    const hasConflict = conflicts.get(e.id) || false

    headsUps.push({
      id: `member-event-${e.id}`,
      type: 'member_event',
      priority: hasConflict ? 'critical' : 'normal',
      title: e.title,
      description: null, // Conflict description handled in component via translation
      date: e.date,
      endDate: e.end_date,
      time: null,
      childId: null,
      childName: null,
      memberId: memberData?.id || null,
      memberName: memberData?.short_name || memberData?.name || null,
      hasConflict,
      source: {
        table: 'member_events',
        id: e.id,
        sourceType: 'memberEvent',
      },
      href: '/uke',
    })
  }

  // Sort by priority then date
  headsUps.sort((a, b) => {
    const priorityDiff = getHeadsUpPriorityScore(a) - getHeadsUpPriorityScore(b)
    if (priorityDiff !== 0) return priorityDiff
    return a.date.localeCompare(b.date)
  })

  // Return max 10 items
  return headsUps.slice(0, 10)
}
