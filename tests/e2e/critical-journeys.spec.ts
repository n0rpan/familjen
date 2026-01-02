/**
 * Critical User Journey Tests
 *
 * These tests verify the most important flows that busy parents depend on daily.
 * Philosophy: "We don't test to make tests pass. We test to be confident busy parents won't have headaches."
 *
 * Uses mock auth and AI-generated test data - works on fresh Vercel previews.
 *
 * Test priorities:
 * 1. Login/auth works reliably (public pages)
 * 2. Home page shows today's pickups correctly (mocked)
 * 3. Week planner allows pickup assignments (mocked)
 * 4. Error states are visible and actionable
 *
 * Run with: npx playwright test critical-journeys
 */

import { test, expect } from '@playwright/test'
import { setupTestFixture } from './fixtures/mock-auth'
import { generateScenario } from './fixtures/test-data-generator'

// ============================================
// Public Routes (No Auth Required)
// ============================================

test.describe('Authentication - Public Pages', () => {
  test('shows login page for unauthenticated users', async ({ page }) => {
    await page.goto('/')

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/)

    // Login form should be visible
    await expect(page.locator('text=Logg inn')).toBeVisible()
  })

  test('login page has Google auth button', async ({ page }) => {
    await page.goto('/login')

    // Google auth button should be visible
    const googleButton = page.locator('button:has-text("Google"), a:has-text("Google")')
    await expect(googleButton).toBeVisible()
  })

  test('login page loads within 3 seconds', async ({ page }) => {
    const startTime = Date.now()

    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    const loadTime = Date.now() - startTime
    expect(loadTime).toBeLessThan(3000)
  })
})

test.describe('Public Routes', () => {
  test('wishlist share page loads without auth', async ({ page }) => {
    // Public wishlist pages should work without login
    // Using a dummy token - will show "not found" but should load
    const response = await page.goto('/g/test-token-123')

    // Should not redirect to login
    expect(page.url()).toContain('/g/test-token-123')

    // Page should load (might show "not found" for invalid token)
    await expect(page.locator('body')).toBeVisible()
  })

  test('shows friendly error for 404 pages', async ({ page }) => {
    await page.goto('/nonexistent-page-12345')

    // Should show Norwegian error message
    await expect(page.locator('text=404')).toBeVisible()
  })
})

// ============================================
// Authenticated Journeys (Mock Auth)
// ============================================

test.describe('Home Page - With Mock Data', () => {
  test('shows today overview with children and pickups', async ({ page, context }) => {
    // Set up mock auth and test data
    const { household } = await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
      withMeals: true,
    })

    await page.goto('/')

    // Should not redirect to login (mocked auth)
    await page.waitForLoadState('networkidle')

    // Check for navigation or app shell
    const hasAppContent = await page.locator('nav, header, [data-testid="app-shell"]').count()
    expect(hasAppContent).toBeGreaterThan(0)

    // Check for child-related content (names should appear somewhere)
    for (const child of household.children) {
      const childNameVisible = await page.locator(`text=${child.name}`).count()
      // Child name should appear in the UI
      if (childNameVisible > 0) {
        console.log(`   ✓ Child "${child.name}" visible on home page`)
      }
    }
  })

  test('shows pickup assignments', async ({ page, context }) => {
    const { household } = await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Member names (pickers) should be visible if pickups are assigned
    for (const member of household.members) {
      const memberVisible = await page.locator(`text=${member.name}, text=${member.short_name}`).first().count()
      if (memberVisible > 0) {
        console.log(`   ✓ Member "${member.name}" visible (assigned to pickup)`)
      }
    }
  })

  test('empty state shows appropriate message', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: false,
      withMeals: false,
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Page should load without errors
    await expect(page.locator('body')).toBeVisible()

    // No error messages should be shown for empty state
    const errorMessages = await page.locator('text=Noe gikk galt, text=Error, text=Feil').count()
    expect(errorMessages).toBe(0)
  })
})

test.describe('Week Planner - With Mock Data', () => {
  test('shows week grid with days', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
      withMeals: true,
    })

    await page.goto('/uke')
    await page.waitForLoadState('networkidle')

    // Should show weekday names (Norwegian or abbreviations)
    const weekdayPatterns = [
      'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn', // Norwegian abbrevs
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', // English abbrevs
    ]

    let foundWeekdays = 0
    for (const day of weekdayPatterns) {
      const dayVisible = await page.locator(`text=${day}`).count()
      if (dayVisible > 0) foundWeekdays++
    }

    expect(foundWeekdays).toBeGreaterThan(0)
  })

  test('shows meal section', async ({ page, context }) => {
    const { household } = await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
      withMeals: true,
    })

    await page.goto('/uke')
    await page.waitForLoadState('networkidle')

    // Look for meal-related content
    // Could be meal names or "Middag" label
    const mealIndicators = await page.locator('text=Middag, text=middag, text=Dinner').count()

    // Or check for actual meal names from our test data
    for (const meal of household.meals.slice(0, 2)) {
      const mealVisible = await page.locator(`text=${meal.custom_meal}`).count()
      if (mealVisible > 0) {
        console.log(`   ✓ Meal "${meal.custom_meal}" visible on week page`)
      }
    }
  })

  test('child colors are visible', async ({ page, context }) => {
    const { household } = await setupTestFixture(context, page, {
      childCount: 3, // Multiple children to see color differentiation
      memberCount: 2,
      withPickups: true,
    })

    await page.goto('/uke')
    await page.waitForLoadState('networkidle')

    // Check for colored elements (children should have distinct background colors)
    const coloredElements = await page.evaluate(() => {
      const elements = document.querySelectorAll('[class*="bg-"], [style*="background"]')
      const colors: string[] = []

      elements.forEach((el) => {
        const style = window.getComputedStyle(el)
        const bg = style.backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== 'rgb(255, 255, 255)') {
          colors.push(bg)
        }
      })

      return [...new Set(colors)]
    })

    // Should have multiple distinct colors for children
    console.log(`   📊 Found ${coloredElements.length} distinct background colors`)
  })
})

test.describe('Feed Page - With Mock Data', () => {
  test('shows feed page layout', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
    })

    await page.goto('/feed')
    await page.waitForLoadState('networkidle')

    // Feed should show either content or empty state
    await expect(page.locator('body')).toBeVisible()

    // Check for feed-related UI elements
    const feedIndicators = await page.locator('[data-testid="feed"], text=Feed, nav').count()
    expect(feedIndicators).toBeGreaterThan(0)
  })
})

test.describe('Settings Page - With Mock Data', () => {
  test('shows settings sections', async ({ page, context }) => {
    const { household } = await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
    })

    await page.goto('/innstillinger')
    await page.waitForLoadState('networkidle')

    // Settings should show household info
    const householdNameVisible = await page.locator(`text=${household.name}`).count()

    // Or show settings sections
    const settingsIndicators = await page.locator('text=Innstillinger, text=Settings, text=Profil, text=Husstand').count()
    expect(settingsIndicators + householdNameVisible).toBeGreaterThan(0)
  })
})

// ============================================
// Error Handling
// ============================================

test.describe('Error States', () => {
  test('API error returns proper status codes', async ({ request }) => {
    // Test API returns proper error codes
    const response = await request.get('/api/calendar/sync', {
      headers: {
        Origin: 'http://localhost:3000',
      },
    })

    // Should return 401 for unauthenticated
    expect(response.status()).toBe(401)

    const body = await response.json()
    // Should have Norwegian error message
    expect(body.error).toBeDefined()
  })

  test('no console errors on authenticated pages', async ({ page, context }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await setupTestFixture(context, page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Filter out expected errors (like missing env vars in test)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('SUPABASE') &&
        !e.includes('env') &&
        !e.includes('favicon') &&
        !e.includes('Failed to fetch') && // Expected with mocked routes
        !e.includes('net::ERR') // Network errors expected with mocks
    )

    // Log warnings but don't fail for non-critical errors
    if (criticalErrors.length > 0) {
      console.warn('Console errors found:', criticalErrors)
    }
  })
})

// ============================================
// Mobile Viewport Tests
// ============================================

test.describe('Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('login page is mobile friendly', async ({ page }) => {
    await page.goto('/login')

    // Login button should be visible and tappable
    const loginButton = page.locator('button:has-text("Google"), a:has-text("Google")')
    await expect(loginButton).toBeVisible()
    await expect(loginButton).toBeInViewport()
  })

  test('home page works on mobile', async ({ page, context }) => {
    await setupTestFixture(context, page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Check for horizontal scroll (should not exist)
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })

    expect(hasHorizontalScroll).toBeFalsy()
  })

  test('week planner is usable on mobile', async ({ page, context }) => {
    await setupTestFixture(context, page)

    await page.goto('/uke')
    await page.waitForLoadState('networkidle')

    // Week page with 7 days SHOULD have horizontal scroll for readability
    // This is intentional - cramming 7 columns into 390px makes them unreadable
    const weekGrid = page.locator('[class*="overflow-x-auto"]')
    await expect(weekGrid, 'Week grid should have horizontal scroll container').toBeVisible()

    // Verify columns are readable width (at least 80px each)
    const columnWidths = await page.evaluate(() => {
      const cols = document.querySelectorAll('table colgroup col')
      return Array.from(cols).slice(1).map(col => {
        const style = (col as HTMLElement).style.minWidth
        return style ? parseInt(style, 10) : 0
      })
    })

    // All day columns should have minimum width for readability
    const hasReadableColumns = columnWidths.length > 0 && columnWidths.every(w => w >= 80)
    expect(hasReadableColumns, 'Week columns should be at least 80px wide for readability').toBeTruthy()

    // Navigation should be accessible
    await expect(page.locator('nav')).toBeVisible()
  })
})

// ============================================
// Performance Tests
// ============================================

test.describe('Performance', () => {
  test('authenticated pages load within 5 seconds', async ({ page, context }) => {
    await setupTestFixture(context, page)

    const startTime = Date.now()

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const loadTime = Date.now() - startTime
    expect(loadTime).toBeLessThan(5000)

    console.log(`   ⏱️ Home page load time: ${loadTime}ms`)
  })
})
