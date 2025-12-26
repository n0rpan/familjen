/**
 * Mock Auth Fixture for Playwright
 *
 * Provides authenticated session state without requiring a real Supabase user.
 * Works by intercepting Supabase auth API calls and returning mock responses.
 *
 * This enables:
 * - Running E2E tests against Vercel previews (including migrations)
 * - No dependency on test user existing in database
 * - Tests work even when database is empty/fresh
 *
 * Philosophy: "Every PR preview should be testable, even with breaking migrations"
 */

import { Page, BrowserContext } from '@playwright/test'
import { generateTestHousehold, TestHousehold } from './test-data-generator'

// Mock user that matches what Supabase auth would return
export interface MockUser {
  id: string
  email: string
  user_metadata: {
    full_name: string
    avatar_url?: string
  }
  app_metadata: {
    provider: string
  }
  aud: string
  created_at: string
}

// Mock session tokens
export interface MockSession {
  access_token: string
  refresh_token: string
  expires_at: number
  token_type: string
  user: MockUser
}

/**
 * Generate a mock user for testing
 */
export function generateMockUser(name?: string): MockUser {
  const email = `test-${Date.now()}@familjen.test`
  return {
    id: `mock-user-${Math.random().toString(36).substring(2, 11)}`,
    email,
    user_metadata: {
      full_name: name || 'Test Bruker',
      avatar_url: undefined,
    },
    app_metadata: {
      provider: 'google',
    },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  }
}

/**
 * Generate a mock session for testing
 */
export function generateMockSession(user: MockUser): MockSession {
  return {
    access_token: `mock-access-token-${Date.now()}`,
    refresh_token: `mock-refresh-token-${Date.now()}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    token_type: 'bearer',
    user,
  }
}

/**
 * Set up mock auth for a browser context
 *
 * This intercepts Supabase auth API calls and returns mock responses,
 * effectively simulating a logged-in user without hitting the real auth system.
 */
export async function setupMockAuth(
  context: BrowserContext,
  options?: {
    user?: MockUser
    household?: TestHousehold
  }
): Promise<{ user: MockUser; session: MockSession; household: TestHousehold }> {
  const user = options?.user || generateMockUser()
  const session = generateMockSession(user)
  const household = options?.household || generateTestHousehold()

  // Set cookies that Supabase client checks for auth state
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]

  await context.addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: session.user,
      }),
      domain: 'localhost',
      path: '/',
    },
  ])

  return { user, session, household }
}

/**
 * Set up API mocks for a page to return test data
 *
 * This intercepts Supabase REST API calls and returns generated test data,
 * allowing tests to run without a real database connection.
 */
export async function setupApiMocks(
  page: Page,
  household: TestHousehold
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'

  // Intercept household queries
  await page.route(`${supabaseUrl}/rest/v1/household_members*`, async (route) => {
    const url = new URL(route.request().url())

    // Return mock household members
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        household.members.map((m) => ({
          ...m,
          household_id: household.id,
          user_id: m.id, // In mock, member id = user id
          is_household_admin: true,
        }))
      ),
    })
  })

  // Intercept children queries
  await page.route(`${supabaseUrl}/rest/v1/children*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        household.children.map((c) => ({
          ...c,
          household_id: household.id,
        }))
      ),
    })
  })

  // Intercept pickups queries
  await page.route(`${supabaseUrl}/rest/v1/pickups*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        household.pickups.map((p) => ({
          ...p,
          household_id: household.id,
        }))
      ),
    })
  })

  // Intercept meals queries
  await page.route(`${supabaseUrl}/rest/v1/meals*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        household.meals.map((m) => ({
          ...m,
          household_id: household.id,
          recipe_id: null,
        }))
      ),
    })
  })

  // Intercept recipes queries
  await page.route(`${supabaseUrl}/rest/v1/recipes*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  // Intercept child_tasks queries
  await page.route(`${supabaseUrl}/rest/v1/child_tasks*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  // Intercept member_events queries
  await page.route(`${supabaseUrl}/rest/v1/member_events*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  // Intercept external_integrations queries
  await page.route(`${supabaseUrl}/rest/v1/external_integrations*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  // Intercept external_messages queries (for feed)
  await page.route(`${supabaseUrl}/rest/v1/external_messages*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  // Intercept external_photos queries (for feed)
  await page.route(`${supabaseUrl}/rest/v1/external_photos*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  // Intercept households queries
  await page.route(`${supabaseUrl}/rest/v1/households*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: household.id,
          name: household.name,
          created_at: new Date().toISOString(),
        },
      ]),
    })
  })

  // Intercept RPC calls
  await page.route(`${supabaseUrl}/rest/v1/rpc/*`, async (route) => {
    const url = new URL(route.request().url())
    const rpcName = url.pathname.split('/').pop()

    // Handle common RPC calls
    switch (rpcName) {
      case 'get_user_household_id':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(household.id),
        })
        break
      case 'is_admin':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(false),
        })
        break
      case 'is_household_admin':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(true),
        })
        break
      case 'get_connected_calendar_email':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(null),
        })
        break
      default:
        // Let other RPC calls through or return empty
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(null),
        })
    }
  })

  // Intercept auth API calls
  await page.route(`${supabaseUrl}/auth/v1/**`, async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname.includes('/user')) {
      // Return mock user
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(household.members[0] ? {
          id: household.members[0].id,
          email: household.members[0].email,
          user_metadata: { full_name: household.members[0].name },
        } : null),
      })
    } else {
      await route.continue()
    }
  })
}

/**
 * Complete fixture setup: auth + API mocks
 *
 * Usage in tests:
 * ```typescript
 * import { setupTestFixture } from './fixtures/mock-auth'
 *
 * test('my test', async ({ page, context }) => {
 *   const { household } = await setupTestFixture(context, page)
 *   await page.goto('/')
 *   // Page will show mock data
 * })
 * ```
 */
export async function setupTestFixture(
  context: BrowserContext,
  page: Page,
  options?: {
    childCount?: number
    memberCount?: number
    withPickups?: boolean
    withMeals?: boolean
  }
): Promise<{ user: MockUser; session: MockSession; household: TestHousehold }> {
  const household = generateTestHousehold({
    childCount: options?.childCount ?? 2,
    memberCount: options?.memberCount ?? 2,
    withPickups: options?.withPickups ?? true,
    withMeals: options?.withMeals ?? true,
  })

  const { user, session } = await setupMockAuth(context, { household })
  await setupApiMocks(page, household)

  return { user, session, household }
}
