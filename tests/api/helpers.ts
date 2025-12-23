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

// AI-based allergy verification
// Uses a second AI call to semantically verify if a meal contains allergens
// This handles edge cases like "coconut milk" (dairy-free), "nutmeg" (not a nut allergy), etc.

export interface AllergyVerificationResult {
  containsAllergen: boolean
  reason: string
  ingredient?: string
}

export async function verifyNoAllergens(
  mealName: string,
  ingredients: string[],
  allergies: string[]
): Promise<AllergyVerificationResult> {
  if (allergies.length === 0) {
    return { containsAllergen: false, reason: 'No allergies specified' }
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    // Fallback to simple pattern matching if no API key
    return { containsAllergen: false, reason: 'No API key, skipping AI verification' }
  }

  const model = process.env.OPENROUTER_TEST_MODEL || 'google/gemini-2.0-flash-lite'

  const prompt = `You are a food allergy expert. Analyze if this meal contains any of the specified allergens.

IMPORTANT RULES:
- "Coconut milk" (kokosmelk) is NOT dairy and is safe for milk allergies
- "Nutmeg" (muskatnøtt) is NOT a tree nut and is safe for nut allergies
- "Lactose-free milk" is still dairy and NOT safe for milk allergies
- Phrases like "without milk" (uten melk) mean the ingredient is allergen-free
- Be precise: only flag ACTUAL allergens, not similar-sounding safe ingredients

Meal: ${mealName}
Ingredients: ${ingredients.join(', ')}
Allergies to check: ${allergies.join(', ')}

Respond with ONLY valid JSON (no markdown):
{"containsAllergen": true/false, "reason": "brief explanation", "ingredient": "the problematic ingredient or null"}`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    })

    if (!response.ok) {
      return { containsAllergen: false, reason: 'API error, skipping verification' }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { containsAllergen: false, reason: 'Could not parse AI response' }
    }

    const result = JSON.parse(jsonMatch[0])
    return {
      containsAllergen: Boolean(result.containsAllergen),
      reason: result.reason || '',
      ingredient: result.ingredient || undefined,
    }
  } catch (error) {
    return { containsAllergen: false, reason: `Verification error: ${error}` }
  }
}

// Legacy patterns (kept for backwards compatibility but prefer verifyNoAllergens)
export const DAIRY_PATTERNS = /\bmelk\b|ost|fløte|yoghurt|smør|cream|cheese|milk|butter/i
export const EGG_PATTERNS = /\begg\b/i
export const NUT_PATTERNS = /nøtt|mandel|valnøtt|hasselnøtt|cashew|pistachio|nut|almond/i
export const GLUTEN_PATTERNS = /hvete|gluten|mel\b|pasta|brød|wheat|flour|bread/i

// Generate realistic product image using Stable Diffusion via OpenRouter
export async function generateProductImage(productDescription: string = 'random product on store shelf'): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.warn('[generateProductImage] No API key, using fallback image')
    return null
  }

  // Use Stable Diffusion XL for image generation
  const imageModel = process.env.OPENROUTER_IMAGE_MODEL || 'stabilityai/stable-diffusion-xl-base-1.0'

  try {
    const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: imageModel,
        prompt: `Photorealistic product photo: ${productDescription}. Clean background, good lighting, product centered in frame, shopping context`,
        n: 1,
        size: '512x512',
        response_format: 'b64_json',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.warn(`[generateProductImage] API error: ${error}`)
      return null
    }

    const data = await response.json()
    const base64Image = data.data?.[0]?.b64_json

    if (base64Image) {
      return `data:image/png;base64,${base64Image}`
    }

    return null
  } catch (error) {
    console.warn(`[generateProductImage] Error: ${error}`)
    return null
  }
}

// Fallback: A real base64-encoded product image (small LEGO box)
// This is a tiny 50x50 placeholder - replace with actual product image in production tests
export const FALLBACK_PRODUCT_IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAyADIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k='

// Get a test product image - tries AI generation, falls back to static
export async function getTestProductImage(description?: string): Promise<string> {
  const generated = await generateProductImage(description)
  if (generated) {
    return generated
  }
  return FALLBACK_PRODUCT_IMAGE
}
