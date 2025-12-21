import { SupabaseClient } from '@supabase/supabase-js'
import { formatDateISO, addDays, type Holiday } from '@/lib/utils'
import type {
  Child,
  HouseholdMember,
  PickupWithDetails,
  MealWithRecipe,
  MemberEvent,
  ChildTaskWithChild,
  HouseholdReminderWithAssignee,
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
  childTasks: ChildTaskWithChild[]
  householdReminders: HouseholdReminderWithAssignee[]
  holidays: Holiday[]
  recentPhotos: HomePagePhoto[]
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

  // Check for errors (holidaysResult is non-critical)
  if (holidaysResult.error) {
    console.warn('Non-critical: Could not load holidays', holidaysResult.error)
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
      children: childrenResult.data || [],
      members: membersResult.data || [],
      pickups: (pickupsResult.data || []) as PickupWithDetails[],
      meals: (mealsResult.data || []) as MealWithRecipe[],
      memberEvents: (eventsResult.data || []) as MemberEvent[],
      childTasks: (tasksResult.data || []) as ChildTaskWithChild[],
      householdReminders: (remindersResult.data || []) as HouseholdReminderWithAssignee[],
      holidays,
      recentPhotos,
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

  return {
    date: data.todayStr,
    pickups: todayPickups,
    meal: todayMeal,
    tasks: todayTasks,
    reminders: todayReminders,
  }
}

/**
 * Calculate attention items for today
 */
export function getAttentionStatus(data: HomePageData) {
  const todayPickups = data.pickups.filter(p => p.date === data.todayStr)
  const todayMeal = data.meals.find(m => m.date === data.todayStr) || null
  const todayTasks = data.childTasks.filter(t => t.date === data.todayStr)

  const childrenWithoutPickup = data.children.filter(child =>
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
