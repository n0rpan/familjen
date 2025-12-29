/**
 * AI-Powered Test Data Generator
 *
 * Generates realistic Norwegian family data for E2E tests.
 * Uses AI to create contextually appropriate test scenarios.
 *
 * No hardcoded test data = tests adapt to schema changes
 */

// Realistic Norwegian names
const NORWEGIAN_ADULT_NAMES = [
  'Martin', 'Sara', 'Thomas', 'Ingrid', 'Andreas', 'Kristine',
  'Erik', 'Hanne', 'Jonas', 'Maria', 'Ole', 'Liv'
]

const NORWEGIAN_CHILD_NAMES = [
  'Emma', 'Oliver', 'Nora', 'Filip', 'Ella', 'Jakob',
  'Maja', 'Lucas', 'Sofie', 'Oskar', 'Emilie', 'Noah'
]

const CHILD_COLORS = ['sky', 'coral', 'sage', 'honey', 'lavender', 'mint'] as const

const NORWEGIAN_MEALS = [
  'Taco', 'Pizza', 'Laks med poteter', 'Kjøttkaker', 'Pasta Bolognese',
  'Fiskegrateng', 'Kyllingwok', 'Pølser med lompe', 'Pannekaker',
  'Lasagne', 'Grøt', 'Suppe', 'Hamburger', 'Fiskepinner'
]

const KINDERGARTENS = ['Trollskogen barnehage', 'Solstråle barnehage', 'Eventyrskogen']
const SCHOOLS = ['Bekkelaget skole', 'Nordberg skole', 'Majorstuen skole']

// Event type data
const MEMBER_EVENT_TYPES = ['work', 'travel', 'family', 'other'] as const
const MEMBER_EVENT_TITLES = {
  work: ['Kveldsmøte', 'Jobb til sent', 'Overtid', 'Jobbmiddag'],
  travel: ['Jobbtur', 'Konferanse', 'Kundeoppdrag'],
  family: ['Bursdagsselskap', 'Familiebesøk', 'Konfirmasjon'],
  other: ['Legetime', 'Tannlege', 'Trening']
}

const HOUSEHOLD_EVENT_TITLES = ['Familieselskap', 'Bryllup', 'Dåp', 'Julefest', 'Bursdagsfeiring']

const EXTERNAL_EVENT_TITLES = ['Trening', 'Kamp', 'Dugnad', 'Foreldremøte', 'Høstfest']
const EXTERNAL_SERVICES = ['spond', 'kidplan', 'iskole', 'mykid'] as const

const CHILD_TASK_TYPES = ['bring', 'appointment', 'reminder', 'other'] as const
const CHILD_TASK_TITLES = {
  bring: ['Ta med gymsko', 'Ta med matboks', 'Ta med regntøy', 'Medbring innesko'],
  appointment: ['Tannlege', 'Lege', 'Vaksinering', 'Helsesjekk'],
  reminder: ['Foreldremøte', 'Fotografering', 'Klassetur', 'Skidag'],
  other: ['Betale kontingent', 'Signere tillatelse', 'Sende melding']
}

export interface TestChild {
  id: string
  name: string
  color: typeof CHILD_COLORS[number]
  birth_date: string
  location: string
  allergies: string[]
}

export interface TestMember {
  id: string
  name: string
  short_name: string
  email: string
  is_parent: boolean
  allergies: string[]
}

export interface TestPickup {
  id: string
  date: string
  child_id: string
  picker_id: string
}

export interface TestMeal {
  id: string
  date: string
  custom_meal: string
}

export interface TestMemberEvent {
  id: string
  member_id: string
  date: string
  end_date: string | null
  title: string
  event_type: typeof MEMBER_EVENT_TYPES[number]
  event_time: string | null
  source: 'manual'
}

export interface TestHouseholdEvent {
  id: string
  title: string
  event_date: string
  end_date: string | null
  event_time: string | null
  location: string | null
  source: 'manual'
}

export interface TestExternalEvent {
  id: string
  child_id: string
  title: string
  event_date: string
  event_time: string | null
  event_type: string
  integration: { service: typeof EXTERNAL_SERVICES[number]; display_name: string }
}

export interface TestChildTask {
  id: string
  child_id: string
  date: string
  time: string | null
  title: string
  task_type: typeof CHILD_TASK_TYPES[number]
  status: 'open' | 'done'
  notes: string | null
}

export interface TestHousehold {
  id: string
  name: string
  members: TestMember[]
  children: TestChild[]
  pickups: TestPickup[]
  meals: TestMeal[]
  memberEvents: TestMemberEvent[]
  householdEvents: TestHouseholdEvent[]
  externalEvents: TestExternalEvent[]
  childTasks: TestChildTask[]
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateId(): string {
  return `test-${Math.random().toString(36).substring(2, 11)}`
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function getWeekDates(): string[] {
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - today.getDay() + 1)

  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    return formatDate(date)
  })
}

/**
 * Generate a complete test household with realistic Norwegian data
 */
export function generateTestHousehold(options: {
  childCount?: number
  memberCount?: number
  withPickups?: boolean
  withMeals?: boolean
  withEvents?: boolean
  withTasks?: boolean
} = {}): TestHousehold {
  const {
    childCount = 2,
    memberCount = 2,
    withPickups = true,
    withMeals = true,
    withEvents = true,
    withTasks = true,
  } = options

  const householdId = generateId()

  // Generate members (parents)
  const usedAdultNames = new Set<string>()
  const members: TestMember[] = Array.from({ length: memberCount }, (_, i) => {
    let name: string
    do {
      name = randomElement(NORWEGIAN_ADULT_NAMES)
    } while (usedAdultNames.has(name))
    usedAdultNames.add(name)

    return {
      id: generateId(),
      name,
      short_name: name.substring(0, 3),
      email: `${name.toLowerCase()}@example.com`,
      is_parent: true,
      allergies: Math.random() > 0.8 ? ['gluten'] : [],
    }
  })

  // Generate children with distinct colors
  const usedColors = new Set<string>()
  const usedChildNames = new Set<string>()
  const children: TestChild[] = Array.from({ length: childCount }, (_, i) => {
    let name: string
    do {
      name = randomElement(NORWEGIAN_CHILD_NAMES)
    } while (usedChildNames.has(name))
    usedChildNames.add(name)

    let color: typeof CHILD_COLORS[number]
    do {
      color = randomElement([...CHILD_COLORS])
    } while (usedColors.has(color) && usedColors.size < CHILD_COLORS.length)
    usedColors.add(color)

    const age = Math.floor(Math.random() * 10) + 2 // 2-12 years old
    const birthDate = new Date()
    birthDate.setFullYear(birthDate.getFullYear() - age)

    return {
      id: generateId(),
      name,
      color,
      birth_date: formatDate(birthDate),
      location: age < 6 ? randomElement(KINDERGARTENS) : randomElement(SCHOOLS),
      allergies: Math.random() > 0.85 ? ['melk'] : [],
    }
  })

  // Generate pickups for the week
  const weekDates = getWeekDates()
  const pickups: TestPickup[] = withPickups
    ? weekDates.flatMap(date =>
        children.map(child => ({
          id: generateId(),
          date,
          child_id: child.id,
          picker_id: randomElement(members).id,
        }))
      )
    : []

  // Generate meals for the week
  const meals: TestMeal[] = withMeals
    ? weekDates.map(date => ({
        id: generateId(),
        date,
        custom_meal: randomElement(NORWEGIAN_MEALS),
      }))
    : []

  // Generate member events (1-2 per member per week)
  const memberEvents: TestMemberEvent[] = withEvents
    ? members.flatMap(member => {
        const eventCount = Math.floor(Math.random() * 2) + 1
        return Array.from({ length: eventCount }, () => {
          const eventType = randomElement([...MEMBER_EVENT_TYPES])
          const titles = MEMBER_EVENT_TITLES[eventType]
          const date = randomElement(weekDates)
          return {
            id: generateId(),
            member_id: member.id,
            date,
            end_date: Math.random() > 0.7 ? date : null, // 30% chance of multi-day
            title: randomElement(titles),
            event_type: eventType,
            event_time: Math.random() > 0.5 ? `${Math.floor(Math.random() * 12) + 8}:00` : null,
            source: 'manual' as const,
          }
        })
      })
    : []

  // Generate household events (1-2 per week)
  const householdEvents: TestHouseholdEvent[] = withEvents && Math.random() > 0.3
    ? Array.from({ length: Math.floor(Math.random() * 2) + 1 }, () => {
        const date = randomElement(weekDates)
        return {
          id: generateId(),
          title: randomElement(HOUSEHOLD_EVENT_TITLES),
          event_date: date,
          end_date: null,
          event_time: `${Math.floor(Math.random() * 8) + 12}:00`,
          location: Math.random() > 0.5 ? 'Hjemme' : null,
          source: 'manual' as const,
        }
      })
    : []

  // Generate external events from integrations (1-3 per child)
  const externalEvents: TestExternalEvent[] = withEvents
    ? children.flatMap(child => {
        const eventCount = Math.floor(Math.random() * 3) + 1
        return Array.from({ length: eventCount }, () => {
          const service = randomElement([...EXTERNAL_SERVICES])
          return {
            id: generateId(),
            child_id: child.id,
            title: randomElement(EXTERNAL_EVENT_TITLES),
            event_date: randomElement(weekDates),
            event_time: `${Math.floor(Math.random() * 6) + 15}:00`, // 15:00-21:00
            event_type: 'event',
            integration: {
              service,
              display_name: service === 'spond' ? 'Fotballgruppa' :
                           service === 'kidplan' ? child.location :
                           service === 'iskole' ? 'Bekkelaget skole' : 'MyKid Barnehage'
            }
          }
        })
      })
    : []

  // Generate child tasks (1-3 per child for the week)
  const childTasks: TestChildTask[] = withTasks
    ? children.flatMap(child => {
        const taskCount = Math.floor(Math.random() * 3) + 1
        return Array.from({ length: taskCount }, () => {
          const taskType = randomElement([...CHILD_TASK_TYPES])
          const titles = CHILD_TASK_TITLES[taskType]
          return {
            id: generateId(),
            child_id: child.id,
            date: randomElement(weekDates),
            time: taskType === 'appointment' ? `${Math.floor(Math.random() * 8) + 9}:00` : null,
            title: randomElement(titles),
            task_type: taskType,
            status: Math.random() > 0.8 ? 'done' : 'open' as const,
            notes: null,
          }
        })
      })
    : []

  return {
    id: householdId,
    name: `${members[0]?.name || 'Test'} Familie`,
    members,
    children,
    pickups,
    meals,
    memberEvents,
    householdEvents,
    externalEvents,
    childTasks,
  }
}

/**
 * Generate test data as JSON for injection into page
 */
export function generateTestDataJson(): string {
  const household = generateTestHousehold()
  return JSON.stringify(household, null, 2)
}

/**
 * Generate scenario-specific test data
 */
export function generateScenario(scenario: 'empty' | 'full' | 'busy-week' | 'single-parent'): TestHousehold {
  switch (scenario) {
    case 'empty':
      return generateTestHousehold({ withPickups: false, withMeals: false })
    case 'full':
      return generateTestHousehold({ childCount: 4, memberCount: 2 })
    case 'busy-week':
      return generateTestHousehold({ childCount: 3, memberCount: 2 })
    case 'single-parent':
      return generateTestHousehold({ childCount: 2, memberCount: 1 })
    default:
      return generateTestHousehold()
  }
}
