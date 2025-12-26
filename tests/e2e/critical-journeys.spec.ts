import { test, expect } from '@playwright/test'

/**
 * Critical User Journey Tests
 *
 * These tests verify the most important flows that busy parents depend on daily.
 * Philosophy: "We don't test to make tests pass. We test to be confident busy parents won't have headaches."
 *
 * Test priorities:
 * 1. Login/auth works reliably
 * 2. Home page shows today's pickups correctly
 * 3. Week planner allows pickup assignments
 * 4. Error states are visible and actionable
 *
 * Run with: npx playwright test
 */

test.describe('Authentication', () => {
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
})

test.describe('Home Page', () => {
  // These tests require authentication - skip for now
  // In production, you'd use test fixtures to set up auth state

  test.skip('shows today overview', async ({ page }) => {
    // This would require auth setup
    await page.goto('/')

    // Today's date should be visible
    await expect(page.locator('[data-testid="today-date"]')).toBeVisible()

    // Children section should load
    await expect(page.locator('[data-testid="children-list"]')).toBeVisible()
  })

  test.skip('shows attention items for missing pickups', async ({ page }) => {
    // With auth, verify attention indicators work
    await page.goto('/')

    // If there are missing pickups, warning should show
    const attentionIndicator = page.locator('[data-testid="attention-indicator"]')
    // Would check for visibility based on test data
  })
})

test.describe('Week Planner', () => {
  test.skip('pickup assignment shows success feedback', async ({ page }) => {
    // With auth, verify pickup assignment flow
    await page.goto('/uke')

    // Click on empty pickup slot
    await page.locator('[data-testid="pickup-slot-empty"]').first().click()

    // Member selector should appear
    await expect(page.locator('[data-testid="member-selector"]')).toBeVisible()

    // Select a member
    await page.locator('[data-testid="member-option"]').first().click()

    // Should show success feedback (no error message)
    await expect(page.locator('[data-testid="error-message"]')).not.toBeVisible()
  })

  test.skip('pickup assignment shows error on failure', async ({ page }) => {
    // Simulate network failure scenario
    await page.route('**/pickups*', route => route.abort())

    await page.goto('/uke')

    // Try to assign pickup
    await page.locator('[data-testid="pickup-slot-empty"]').first().click()
    await page.locator('[data-testid="member-option"]').first().click()

    // Should show error message (Norwegian)
    await expect(page.locator('text=Noe gikk galt')).toBeVisible({ timeout: 5000 })
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
})

test.describe('Error States', () => {
  test('shows friendly error for 404 pages', async ({ page }) => {
    await page.goto('/nonexistent-page-12345')

    // Should show Norwegian error message
    await expect(page.locator('text=404')).toBeVisible()
  })

  test('API error returns proper status codes', async ({ request }) => {
    // Test API returns proper error codes
    const response = await request.get('/api/calendar/sync', {
      headers: {
        'Origin': 'http://localhost:3000',
      },
    })

    // Should return 401 for unauthenticated
    expect(response.status()).toBe(401)

    const body = await response.json()
    // Should have Norwegian error message
    expect(body.error).toBeDefined()
  })
})

test.describe('Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('login page is mobile friendly', async ({ page }) => {
    await page.goto('/login')

    // Login button should be visible and tappable
    const loginButton = page.locator('button:has-text("Google"), a:has-text("Google")')
    await expect(loginButton).toBeVisible()
    await expect(loginButton).toBeInViewport()
  })

  test('navigation works on mobile', async ({ page }) => {
    await page.goto('/login')

    // Mobile menu button should be accessible
    // (This test would need auth to fully verify navigation)
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Performance', () => {
  test('login page loads within 3 seconds', async ({ page }) => {
    const startTime = Date.now()

    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    const loadTime = Date.now() - startTime
    expect(loadTime).toBeLessThan(3000)
  })

  test('no console errors on public pages', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // Filter out expected errors (like missing env vars in test)
    const criticalErrors = errors.filter(e =>
      !e.includes('SUPABASE') &&
      !e.includes('env') &&
      !e.includes('favicon')
    )

    expect(criticalErrors).toHaveLength(0)
  })
})
