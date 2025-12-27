/**
 * Demo Data Generator
 *
 * Generates "Familien Hansen" - a realistic Norwegian family for demo mode.
 * Data is dynamically generated based on current date for realistic scenarios.
 *
 * TypeScript ensures this stays in sync with actual app types.
 */

import type {
  Household,
  HouseholdMember,
  Child,
  Pickup,
  Meal,
  Recipe,
  ChildTask,
  MemberEvent,
  HouseholdEvent,
  ExternalEvent,
  ShoppingList,
  ShoppingListItem,
  WishlistItem,
  AllowedEmail,
} from '@/lib/types'
import type { Holiday } from '@/lib/utils'
import type { FeedMessage } from '@/components/feed/MessageCard'
import type { FeedPhoto } from '@/components/feed/PhotoGallery'
import type { DemoState, AdminHousehold, ShoppingListWithItems } from './types'
import { DEMO_STATE_VERSION } from './types'
import { formatDateISO, addDays } from '@/lib/utils'

// ============================================================================
// IDs (consistent for cross-referencing)
// ============================================================================

const HOUSEHOLD_ID = 'demo-household-001'
const MEMBER_ERIK_ID = 'demo-member-erik'
const MEMBER_MARTE_ID = 'demo-member-marte'
const CHILD_EMILIE_ID = 'demo-child-emilie'
const CHILD_OLIVER_ID = 'demo-child-oliver'
const CHILD_SOFIE_ID = 'demo-child-sofie'

// ============================================================================
// Core Family Data
// ============================================================================

function generateHousehold(): Household {
  return {
    id: HOUSEHOLD_ID,
    name: 'Familien Hansen',
    ai_meal_context: 'Vi liker enkel hverdagsmat. Unngå skalldyr (Oliver har allergi). Fredager er tacodag!',
    share_names_with_ai: true,
    external_integrations_enabled: true,
    created_at: '2024-01-15T10:00:00Z',
  }
}

function generateMembers(): HouseholdMember[] {
  return [
    {
      id: MEMBER_ERIK_ID,
      household_id: HOUSEHOLD_ID,
      name: 'Erik Hansen',
      short_name: 'Erik',
      is_parent: true,
      is_household_admin: true,
      user_id: 'demo-user-erik',
      email: 'erik@example.com',
      birth_date: '1985-03-15',
      work_email: 'erik.hansen@techcorp.no',
      allergies: [],
      language_preference: 'nb',
      ics_calendar_url: null,
      ics_last_sync_at: null,
      ics_sync_error: null,
      created_at: '2024-01-15T10:00:00Z',
    },
    {
      id: MEMBER_MARTE_ID,
      household_id: HOUSEHOLD_ID,
      name: 'Marte Hansen',
      short_name: 'Marte',
      is_parent: true,
      is_household_admin: false,
      user_id: 'demo-user-marte',
      email: 'marte@example.com',
      birth_date: '1987-07-22',
      work_email: 'marte.hansen@hospital.no',
      allergies: [],
      language_preference: 'nb',
      ics_calendar_url: null,
      ics_last_sync_at: null,
      ics_sync_error: null,
      created_at: '2024-01-15T10:00:00Z',
    },
  ]
}

function generateChildren(): Child[] {
  return [
    {
      id: CHILD_EMILIE_ID,
      household_id: HOUSEHOLD_ID,
      name: 'Emilie',
      color: 'coral',
      location_name: 'Steinerskolen',
      location_type: 'school',
      sort_order: 0,
      birth_date: '2016-05-12',
      allergies: [],
      created_at: '2024-01-15T10:00:00Z',
    },
    {
      id: CHILD_OLIVER_ID,
      household_id: HOUSEHOLD_ID,
      name: 'Oliver',
      color: 'sky',
      location_name: 'Trollskogen Barnehage',
      location_type: 'kindergarten',
      sort_order: 1,
      birth_date: '2019-09-03',
      allergies: ['Skalldyr'],
      created_at: '2024-01-15T10:00:00Z',
    },
    {
      id: CHILD_SOFIE_ID,
      household_id: HOUSEHOLD_ID,
      name: 'Sofie',
      color: 'sage',
      location_name: 'Trollskogen Barnehage',
      location_type: 'kindergarten',
      sort_order: 2,
      birth_date: '2021-11-28',
      allergies: [],
      created_at: '2024-01-15T10:00:00Z',
    },
  ]
}

// ============================================================================
// Week Data (dynamic based on current date)
// ============================================================================

function getWeekDates(): Date[] {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))

  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

function generatePickups(): Pickup[] {
  const weekDates = getWeekDates()
  const pickups: Pickup[] = []

  // Pattern: alternate who picks up which children
  const patterns = [
    // Monday: Marte picks Emilie, Erik picks Oliver+Sofie
    { [CHILD_EMILIE_ID]: MEMBER_MARTE_ID, [CHILD_OLIVER_ID]: MEMBER_ERIK_ID, [CHILD_SOFIE_ID]: MEMBER_ERIK_ID },
    // Tuesday: Erik picks Emilie, Marte picks Oliver+Sofie
    { [CHILD_EMILIE_ID]: MEMBER_ERIK_ID, [CHILD_OLIVER_ID]: MEMBER_MARTE_ID, [CHILD_SOFIE_ID]: MEMBER_MARTE_ID },
    // Wednesday: Marte picks all (Erik works late)
    { [CHILD_EMILIE_ID]: MEMBER_MARTE_ID, [CHILD_OLIVER_ID]: MEMBER_MARTE_ID, [CHILD_SOFIE_ID]: MEMBER_MARTE_ID },
    // Thursday: Erik picks Emilie, Marte picks Oliver+Sofie
    { [CHILD_EMILIE_ID]: MEMBER_ERIK_ID, [CHILD_OLIVER_ID]: MEMBER_MARTE_ID, [CHILD_SOFIE_ID]: MEMBER_MARTE_ID },
    // Friday: Marte picks all (early day)
    { [CHILD_EMILIE_ID]: MEMBER_MARTE_ID, [CHILD_OLIVER_ID]: MEMBER_MARTE_ID, [CHILD_SOFIE_ID]: MEMBER_MARTE_ID },
    // Weekend: no pickups
    {},
    {},
  ]

  const times: Record<string, string> = {
    [CHILD_EMILIE_ID]: '15:30',
    [CHILD_OLIVER_ID]: '16:00',
    [CHILD_SOFIE_ID]: '16:00',
  }

  weekDates.forEach((date, dayIndex) => {
    const pattern = patterns[dayIndex] || {}
    const dateStr = formatDateISO(date)

    Object.entries(pattern).forEach(([childId, pickerId]) => {
      pickups.push({
        id: `demo-pickup-${dateStr}-${childId}`,
        household_id: HOUSEHOLD_ID,
        child_id: childId,
        date: dateStr,
        picker_id: pickerId,
        notes: null,
        synced_to_calendar: false,
        calendar_event_id: null,
        sync_to_work_calendar: false,
        work_calendar_event_id: null,
        created_at: new Date().toISOString(),
      })
    })
  })

  return pickups
}

function generateMeals(): Meal[] {
  const weekDates = getWeekDates()
  const mealPlan: (string | null)[] = [
    'Kyllingwok med ris',
    'Fiskegrateng',
    'Pasta Bolognese',
    'Restedag',
    'Taco!',
    null, // Saturday - no plan
    null, // Sunday - no plan
  ]

  const meals: Meal[] = []
  weekDates.forEach((date, i) => {
    const customMeal = mealPlan[i]
    if (customMeal) {
      meals.push({
        id: `demo-meal-${formatDateISO(date)}`,
        household_id: HOUSEHOLD_ID,
        date: formatDateISO(date),
        recipe_id: null,
        custom_meal: customMeal,
        notes: null,
        created_at: new Date().toISOString(),
      })
    }
  })
  return meals
}

function generateRecipes(): Recipe[] {
  return [
    {
      id: 'demo-recipe-taco',
      household_id: HOUSEHOLD_ID,
      name: 'Taco',
      ingredients: [
        { item: 'Tacoskjell', amount: '1 pakke' },
        { item: 'Kjøttdeig', amount: '400g' },
        { item: 'Tacokrydder', amount: '1 pose' },
        { item: 'Rømme', amount: '1 beger' },
        { item: 'Revet ost', amount: '150g' },
        { item: 'Salat', amount: '1 pose' },
        { item: 'Tomat', amount: '2 stk' },
      ],
      instructions: 'Stek kjøttdeig, tilsett krydder og vann. Server med tilbehør.',
      external_link: null,
      is_quick: true,
      is_kid_friendly: true,
      is_favorite: true,
      created_at: '2024-01-20T10:00:00Z',
    },
    {
      id: 'demo-recipe-fiskegrateng',
      household_id: HOUSEHOLD_ID,
      name: 'Fiskegrateng',
      ingredients: [
        { item: 'Torskefilet', amount: '600g' },
        { item: 'Makaroni', amount: '200g' },
        { item: 'Hvit saus', amount: '5 dl' },
        { item: 'Revet ost', amount: '100g' },
      ],
      instructions: 'Kok makaroni. Lag hvit saus. Legg fisk og makaroni i form, hell over saus og ost. Stekes på 200°C i 30 min.',
      external_link: null,
      is_quick: false,
      is_kid_friendly: true,
      is_favorite: false,
      created_at: '2024-02-10T10:00:00Z',
    },
    {
      id: 'demo-recipe-pasta',
      household_id: HOUSEHOLD_ID,
      name: 'Pasta Bolognese',
      ingredients: [
        { item: 'Spaghetti', amount: '400g' },
        { item: 'Kjøttdeig', amount: '500g' },
        { item: 'Hermetiske tomater', amount: '1 boks' },
        { item: 'Løk', amount: '1 stk' },
        { item: 'Hvitløk', amount: '2 fedd' },
      ],
      instructions: 'Stek løk og hvitløk. Tilsett kjøttdeig og tomater. La putre i 20 min. Server med pasta.',
      external_link: null,
      is_quick: true,
      is_kid_friendly: true,
      is_favorite: true,
      created_at: '2024-01-25T10:00:00Z',
    },
    {
      id: 'demo-recipe-wok',
      household_id: HOUSEHOLD_ID,
      name: 'Kyllingwok',
      ingredients: [
        { item: 'Kyllingfilet', amount: '400g' },
        { item: 'Wokgrønnsaker', amount: '1 pose' },
        { item: 'Soyasaus', amount: '3 ss' },
        { item: 'Ris', amount: '3 dl' },
      ],
      instructions: 'Stek kylling i biter. Tilsett grønnsaker og soyasaus. Server med ris.',
      external_link: null,
      is_quick: true,
      is_kid_friendly: false,
      is_favorite: false,
      created_at: '2024-03-01T10:00:00Z',
    },
  ]
}

function generateChildTasks(): ChildTask[] {
  const weekDates = getWeekDates()
  const monday = formatDateISO(weekDates[0])
  const tuesday = formatDateISO(weekDates[1])
  const wednesday = formatDateISO(weekDates[2])
  const thursday = formatDateISO(weekDates[3])
  const friday = formatDateISO(weekDates[4])

  const baseTask = {
    recurrence_pattern: null,
    parent_task_id: null,
    completed_at: null,
    completed_by: null,
    updated_at: null,
  }

  return [
    {
      id: 'demo-task-1',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_EMILIE_ID,
      date: monday,
      time: null,
      task_type: 'bring' as const,
      title: 'Ta med gymtøy',
      notes: 'Husk innesko!',
      status: 'open' as const,
      source: 'manual' as const,
      created_at: new Date().toISOString(),
      ...baseTask,
    },
    {
      id: 'demo-task-2',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_OLIVER_ID,
      date: wednesday,
      time: '10:00',
      task_type: 'appointment' as const,
      title: 'Tannlegetime',
      notes: 'Hos Dr. Berg, Majorstuen',
      status: 'open' as const,
      source: 'manual' as const,
      created_at: new Date().toISOString(),
      ...baseTask,
    },
    {
      id: 'demo-task-3',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_OLIVER_ID,
      date: thursday,
      time: null,
      task_type: 'bring' as const,
      title: 'Ta med regntøy',
      notes: 'Utedag i barnehagen',
      status: 'open' as const,
      source: 'manual' as const,
      created_at: new Date().toISOString(),
      ...baseTask,
    },
    {
      id: 'demo-task-4',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_SOFIE_ID,
      date: tuesday,
      time: null,
      task_type: 'reminder' as const,
      title: 'Lever samtykkeskjema',
      notes: 'For fotografering',
      status: 'open' as const,
      source: 'manual' as const,
      created_at: new Date().toISOString(),
      ...baseTask,
    },
    {
      id: 'demo-task-5',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_EMILIE_ID,
      date: friday,
      time: '14:00',
      task_type: 'appointment' as const,
      title: 'Utviklingssamtale',
      notes: 'Med klasselærer',
      status: 'open' as const,
      source: 'manual' as const,
      created_at: new Date().toISOString(),
      ...baseTask,
    },
  ]
}

function generateMemberEvents(): MemberEvent[] {
  const weekDates = getWeekDates()
  const nextTuesday = formatDateISO(addDays(weekDates[1], 7))
  const nextWednesday = formatDateISO(addDays(weekDates[2], 7))
  const thursday = formatDateISO(weekDates[3])
  const nextFriday = formatDateISO(addDays(weekDates[4], 7))

  return [
    {
      id: 'demo-event-1',
      household_id: HOUSEHOLD_ID,
      member_id: MEMBER_ERIK_ID,
      date: nextTuesday,
      end_date: nextWednesday,
      title: 'Jobbreise til Oslo',
      event_type: 'travel',
      event_time: null,
      source: 'manual',
      source_email: null,
      google_event_id: null,
      ics_uid: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    },
    {
      id: 'demo-event-2',
      household_id: HOUSEHOLD_ID,
      member_id: MEMBER_MARTE_ID,
      date: thursday,
      end_date: null,
      title: 'Jobbe sent',
      event_type: 'work',
      event_time: '18:00',
      source: 'manual',
      source_email: null,
      google_event_id: null,
      ics_uid: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    },
    {
      id: 'demo-event-3',
      household_id: HOUSEHOLD_ID,
      member_id: MEMBER_ERIK_ID,
      date: nextFriday,
      end_date: null,
      title: 'Middag med kollegaer',
      event_type: 'other',
      event_time: '19:00',
      source: 'manual',
      source_email: null,
      google_event_id: null,
      ics_uid: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    },
  ]
}

function generateHouseholdEvents(): HouseholdEvent[] {
  const weekDates = getWeekDates()
  const saturday = formatDateISO(weekDates[5])

  return [
    {
      id: 'demo-household-event-1',
      household_id: HOUSEHOLD_ID,
      title: 'Besøk av besteforeldre',
      description: 'Farmor og farfar kommer på besøk',
      event_date: saturday,
      end_date: null,
      event_time: '14:00',
      end_time: null,
      location: 'Hjemme',
      source: 'manual',
      ics_uid: null,
      is_redistributed: false,
      created_at: new Date().toISOString(),
      updated_at: null,
    },
  ]
}

function generateExternalEvents(): ExternalEvent[] {
  const weekDates = getWeekDates()
  const tuesday = formatDateISO(weekDates[1])

  return [
    {
      id: 'demo-ext-event-1',
      integration_id: 'demo-integration-spond',
      child_id: CHILD_OLIVER_ID,
      external_id: 'spond-event-123',
      external_group_id: 'spond-group-football',
      title: 'Fotballtrening',
      description: 'Ukentlig trening',
      event_date: tuesday,
      event_time: '17:00',
      end_date: null,
      end_time: '18:00',
      location: 'Gressbanen',
      event_type: 'training',
      raw_data: null,
      is_hidden: false,
      local_overrides: null,
      user_notes: null,
      created_at: new Date().toISOString(),
      updated_at: null,
      integration: {
        service: 'spond',
        display_name: 'Emilies Fotball',
        household_id: HOUSEHOLD_ID,
      },
    } as ExternalEvent,
  ]
}

function generateHolidays(): Holiday[] {
  // Return empty for now - holidays are typically loaded from calendar_events
  return []
}

// ============================================================================
// Feed Data
// ============================================================================

function generateFeedMessages(): FeedMessage[] {
  const today = new Date()
  const yesterday = addDays(today, -1)
  const twoDaysAgo = addDays(today, -2)

  return [
    {
      id: 'demo-msg-1',
      integration_id: 'demo-integration-spond',
      child_id: CHILD_EMILIE_ID,
      external_id: 'spond-msg-001',
      sender_name: 'Trener Kari',
      title: 'Trening tirsdag',
      body: 'Husk å ta med drikke og gode sko! Vi skal ha matchtrening denne uken. Alle må møte presis.',
      message_date: formatDateISO(yesterday),
      source_type: 'message',
      service: 'spond' as const,
    },
    {
      id: 'demo-msg-2',
      integration_id: 'demo-integration-mykid',
      child_id: CHILD_OLIVER_ID,
      external_id: 'mykid-msg-001',
      sender_name: 'Pedagogisk leder',
      title: 'Ukebrev uke ' + getWeekNumber(today),
      body: 'I dag har vi vært på tur i skogen og funnet høstblader 🍂 Barna koste seg masse! Neste uke skal vi lage kunst av bladene.',
      message_date: formatDateISO(today),
      source_type: 'newsletter',
      service: 'mykid' as const,
    },
    {
      id: 'demo-msg-3',
      integration_id: 'demo-integration-iskole',
      child_id: CHILD_EMILIE_ID,
      external_id: 'iskole-msg-001',
      sender_name: 'Klasselærer',
      title: 'Foreldremøte',
      body: 'Påminnelse: Foreldremøte torsdag kl 18:00 i klasserommet. Vi skal gå gjennom høstens planer og det blir mulighet for spørsmål.',
      message_date: formatDateISO(twoDaysAgo),
      source_type: 'message',
      service: 'iskole' as const,
    },
    {
      id: 'demo-msg-4',
      integration_id: 'demo-integration-mykid',
      child_id: CHILD_SOFIE_ID,
      external_id: 'mykid-msg-002',
      sender_name: 'Avdelingsleder',
      title: 'Fotografering',
      body: 'Vi har fotografering neste uke! Vennligst lever samtykkeskjema innen tirsdag.',
      message_date: formatDateISO(twoDaysAgo),
      source_type: 'message',
      service: 'mykid' as const,
    },
  ]
}

function generateFeedPhotos(): FeedPhoto[] {
  // Demo photos would reference files in public/demo/feed/
  // For now, return empty - photos require actual image files
  return []
}

// ============================================================================
// Shopping & Wishlists
// ============================================================================

function generateShoppingLists(): ShoppingListWithItems[] {
  return [
    {
      id: 'demo-list-groceries',
      household_id: HOUSEHOLD_ID,
      name: 'Dagligvarer',
      sort_order: 0,
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: [
        { id: 'demo-item-1', list_id: 'demo-list-groceries', name: 'Melk', quantity: '2L', is_bought: false, category: 'dairy', source_recipe_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-item-2', list_id: 'demo-list-groceries', name: 'Brød', quantity: '1', is_bought: false, category: 'pantry', source_recipe_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-item-3', list_id: 'demo-list-groceries', name: 'Bananer', quantity: '1 kg', is_bought: false, category: 'produce', source_recipe_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-item-4', list_id: 'demo-list-groceries', name: 'Kyllingfilet', quantity: '500g', is_bought: true, category: 'meat', source_recipe_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-item-5', list_id: 'demo-list-groceries', name: 'Egg', quantity: '12 stk', is_bought: false, category: 'dairy', source_recipe_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      ],
    },
  ]
}

function generateWishlists(): WishlistItem[] {
  return [
    {
      id: 'demo-wish-1',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_EMILIE_ID,
      member_id: null,
      name: 'Lego Friends Heartlake',
      description: 'Det store settet med svømmehall',
      link: 'https://lego.com/example',
      price: 599,
      image_path: null,
      priority: 5,
      occasion: 'birthday',
      status: 'open',
      reserved_by: null,
      reserved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'demo-wish-2',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_OLIVER_ID,
      member_id: null,
      name: 'Paw Patrol figursett',
      description: 'Med Chase og Marshall',
      link: null,
      price: 349,
      image_path: null,
      priority: 4,
      occasion: 'christmas',
      status: 'open',
      reserved_by: null,
      reserved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'demo-wish-3',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_SOFIE_ID,
      member_id: null,
      name: 'Duplo bondegård',
      description: null,
      link: null,
      price: 449,
      image_path: null,
      priority: 3,
      occasion: 'birthday',
      status: 'reserved',
      reserved_by: MEMBER_ERIK_ID,
      reserved_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    // Parent wishlists
    {
      id: 'demo-wish-4',
      household_id: HOUSEHOLD_ID,
      child_id: null,
      member_id: MEMBER_ERIK_ID,
      name: 'Sony WH-1000XM5',
      description: 'Støyreduserende hodetelefoner',
      link: 'https://sony.no/example',
      price: 3999,
      image_path: null,
      priority: 4,
      occasion: 'christmas',
      status: 'open',
      reserved_by: null,
      reserved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'demo-wish-5',
      household_id: HOUSEHOLD_ID,
      child_id: null,
      member_id: MEMBER_MARTE_ID,
      name: 'Spa-gavekort',
      description: 'Farris Bad eller lignende',
      link: null,
      price: 1500,
      image_path: null,
      priority: 5,
      occasion: 'christmas',
      status: 'open',
      reserved_by: null,
      reserved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'demo-wish-6',
      household_id: HOUSEHOLD_ID,
      child_id: null,
      member_id: MEMBER_MARTE_ID,
      name: 'Der ingen satisfare vet',
      description: 'Bok av Maja Lunde',
      link: null,
      price: 349,
      image_path: null,
      priority: 3,
      occasion: 'christmas',
      status: 'reserved',
      reserved_by: MEMBER_ERIK_ID,
      reserved_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]
}

// ============================================================================
// Admin Data (fake households for admin page)
// ============================================================================

function generateAdminHouseholds(): AdminHousehold[] {
  return [
    {
      id: 'demo-household-001',
      name: 'Familien Hansen',
      members: [{ name: 'Erik Hansen' }, { name: 'Marte Hansen' }],
      children: [{ name: 'Emilie' }, { name: 'Oliver' }, { name: 'Sofie' }],
      created_at: '2024-01-15',
    },
    {
      id: 'demo-household-002',
      name: 'Familien Olsen',
      members: [{ name: 'Lars Olsen' }, { name: 'Ingrid Olsen' }],
      children: [{ name: 'Emma' }, { name: 'Noah' }],
      created_at: '2024-03-22',
    },
    {
      id: 'demo-household-003',
      name: 'Familien Berg',
      members: [{ name: 'Thomas Berg' }],
      children: [{ name: 'Maja' }],
      created_at: '2024-06-10',
    },
  ]
}

function generateAdminAllowedEmails(): AllowedEmail[] {
  return [
    { id: 'demo-email-1', email: 'erik@example.com', added_by: null, is_admin: true, can_create_household: true, invited_by_household_id: null, created_at: '2024-01-10' },
    { id: 'demo-email-2', email: 'marte@example.com', added_by: null, is_admin: false, can_create_household: false, invited_by_household_id: HOUSEHOLD_ID, created_at: '2024-01-15' },
    { id: 'demo-email-3', email: 'lars@example.com', added_by: null, is_admin: false, can_create_household: true, invited_by_household_id: null, created_at: '2024-03-20' },
    { id: 'demo-email-4', email: 'ingrid@example.com', added_by: null, is_admin: false, can_create_household: false, invited_by_household_id: 'demo-household-002', created_at: '2024-03-22' },
    { id: 'demo-email-5', email: 'thomas@example.com', added_by: null, is_admin: false, can_create_household: true, invited_by_household_id: null, created_at: '2024-06-08' },
  ]
}

// ============================================================================
// Helpers
// ============================================================================

function getWeekNumber(date: Date): number {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1)
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7)
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate complete demo state
 */
export function generateDemoState(): DemoState {
  return {
    household: generateHousehold(),
    members: generateMembers(),
    children: generateChildren(),
    pickups: generatePickups(),
    meals: generateMeals(),
    recipes: generateRecipes(),
    childTasks: generateChildTasks(),
    memberEvents: generateMemberEvents(),
    householdEvents: generateHouseholdEvents(),
    externalEvents: generateExternalEvents(),
    holidays: generateHolidays(),
    feedMessages: generateFeedMessages(),
    feedPhotos: generateFeedPhotos(),
    shoppingLists: generateShoppingLists(),
    wishlists: generateWishlists(),
    adminHouseholds: generateAdminHouseholds(),
    adminAllowedEmails: generateAdminAllowedEmails(),
    generatedAt: new Date().toISOString(),
    version: DEMO_STATE_VERSION,
  }
}

/**
 * Get demo member and children IDs for easy access
 */
export const DEMO_IDS = {
  household: HOUSEHOLD_ID,
  members: {
    erik: MEMBER_ERIK_ID,
    marte: MEMBER_MARTE_ID,
  },
  children: {
    emilie: CHILD_EMILIE_ID,
    oliver: CHILD_OLIVER_ID,
    sofie: CHILD_SOFIE_ID,
  },
}
