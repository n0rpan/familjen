import { vi } from 'vitest'
import { NextRequest } from 'next/server'
import { TEST_MODEL } from './setup'

// Test data types
export interface TestHousehold {
  id: string
  name: string
  ai_meal_context: string | null
  share_names_with_ai: boolean
}

export interface TestChild {
  id: string
  name: string
  birth_date: string | null
  allergies: string[]
}

export interface TestMember {
  id: string
  name: string
  birth_date: string | null
  allergies: string[]
  is_parent: boolean
}

// Default test data
export const defaultTestHousehold: TestHousehold = {
  id: 'test-household-id',
  name: 'Test Familie',
  ai_meal_context: null,
  share_names_with_ai: true,
}

export const defaultTestChildren: TestChild[] = [
  { id: 'child-1', name: 'Emma', birth_date: '2020-01-15', allergies: [] },
  { id: 'child-2', name: 'Oliver', birth_date: '2018-06-20', allergies: [] },
]

export const defaultTestMembers: TestMember[] = [
  { id: 'member-1', name: 'Martin', birth_date: '1985-03-10', allergies: [], is_parent: true },
  { id: 'member-2', name: 'Sara', birth_date: '1987-08-22', allergies: [], is_parent: true },
]

// Create a mock Supabase client that returns test data
export function createMockSupabaseClient(options: {
  household?: TestHousehold
  children?: TestChild[]
  members?: TestMember[]
  recipes?: Array<{ id: string; name: string; is_favorite: boolean; is_quick: boolean; is_kid_friendly: boolean }>
  meals?: Array<{ date: string; custom_meal: string | null; recipe: { name: string } | null }>
  user?: { id: string; email: string } | null
} = {}) {
  const {
    household = defaultTestHousehold,
    children = defaultTestChildren,
    members = defaultTestMembers,
    recipes = [],
    meals = [],
    user = { id: 'test-user-id', email: 'test@example.com' },
  } = options

  // Table data lookup
  const tableData: Record<string, unknown[]> = {
    household_members: members.map(m => ({ ...m, household_id: household.id, user_id: user?.id })),
    children: children.map(c => ({ ...c, household_id: household.id })),
    recipes: recipes.map(r => ({ ...r, household_id: household.id })),
    meals: meals.map(m => ({ ...m, household_id: household.id })),
    app_settings: [{ key: 'openrouter_model', value: TEST_MODEL }],
    calendar_events: [],
    week_contexts: [],
  }

  const createQueryBuilder = (tableName: string) => {
    let data = tableData[tableName] || []

    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn((field: string, value: unknown) => {
        data = data.filter((row: Record<string, unknown>) => row[field] === value)
        return builder
      }),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        if (data.length === 0) {
          return Promise.resolve({ data: null, error: { code: 'PGRST116' } })
        }
        return Promise.resolve({ data: data[0], error: null })
      }),
      maybeSingle: vi.fn().mockImplementation(() => {
        return Promise.resolve({ data: data[0] || null, error: null })
      }),
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
        resolve({ data, error: null })
        return Promise.resolve({ data, error: null })
      },
    }

    return builder
  }

  return {
    from: vi.fn((tableName: string) => createQueryBuilder(tableName)),
    rpc: vi.fn((funcName: string) => {
      if (funcName === 'get_user_household_id') {
        return Promise.resolve({ data: household.id, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
  }
}

// Create a NextRequest for testing API routes
export function createTestRequest(
  url: string,
  options: {
    method?: string
    body?: object
    headers?: Record<string, string>
  } = {}
) {
  const { method = 'POST', body, headers = {} } = options

  const requestInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:3000',
      ...headers,
    },
  }

  if (body) {
    requestInit.body = JSON.stringify(body)
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), requestInit)
}

// Helper to parse JSON response
export async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Failed to parse response: ${text}`)
  }
}

// Format date as YYYY-MM-DD
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

// Get next Monday from today
export function getNextMonday(): string {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek
  const nextMonday = new Date(today)
  nextMonday.setDate(today.getDate() + daysUntilMonday)
  return formatDate(nextMonday)
}

// Common allergy test patterns
export const DAIRY_PATTERNS = /melk|ost|fløte|yoghurt|smør|cream|cheese|milk|butter/i
export const EGG_PATTERNS = /\begg\b/i
export const NUT_PATTERNS = /nøtt|mandel|valnøtt|hasselnøtt|cashew|pistachio|nut|almond/i
export const GLUTEN_PATTERNS = /hvete|gluten|mel\b|pasta|brød|wheat|flour|bread/i
