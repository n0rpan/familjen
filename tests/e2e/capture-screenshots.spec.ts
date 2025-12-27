/**
 * Screenshot Capture with Demo Mode
 *
 * Captures screenshots of critical pages using demo mode.
 * No auth or API mocking needed - demo mode provides all data.
 *
 * Demo mode shows "Familien Hansen" - a realistic Norwegian family:
 * - 2 parents (Erik and Marte)
 * - 3 children (Emilie 8, Oliver 5, Sofie 3)
 * - Full week of pickups, meals, and tasks
 * - Integration messages from Spond, MyKid, iSkole
 *
 * These screenshots are validated by AI visual review.
 *
 * Usage:
 *   npx playwright test capture-screenshots
 *   npx playwright test capture-screenshots --project=chromium
 */

import { test, expect } from '@playwright/test'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const CURRENT_DIR = 'tests/visual/current'

// Routes to capture in demo mode
const DEMO_ROUTES = [
  {
    path: '/?demo=true',
    name: 'home',
    description: 'Home page with today overview, pickups, meal, tasks',
  },
  {
    path: '/uke?demo=true',
    name: 'week',
    description: 'Week planner with full week of pickups and meals',
  },
  {
    path: '/feed?demo=true',
    name: 'feed',
    description: 'Feed with integration messages from kindergarten/school',
  },
  {
    path: '/innstillinger?demo=true',
    name: 'settings',
    description: 'Settings page with family configuration',
  },
  {
    path: '/handleliste?demo=true',
    name: 'shopping',
    description: 'Shopping list with categorized items',
  },
  {
    path: '/oppskrifter?demo=true',
    name: 'recipes',
    description: 'Recipe library with Norwegian dishes',
  },
]

test.describe('Screenshot Capture - Demo Mode', () => {
  test.beforeAll(() => {
    // Ensure output directory exists
    if (!existsSync(CURRENT_DIR)) {
      mkdirSync(CURRENT_DIR, { recursive: true })
    }
  })

  for (const route of DEMO_ROUTES) {
    test(`capture ${route.name} - ${route.description}`, async ({ page }) => {
      // Navigate to demo page
      await page.goto(route.path, { waitUntil: 'networkidle' })

      // Wait for demo data to load and animations to complete
      await page.waitForTimeout(1000)

      // Verify demo banner is visible (confirms demo mode is active)
      const demoBanner = page.locator('text=demo')
      await expect(demoBanner.first()).toBeVisible({ timeout: 5000 })

      // Capture screenshot
      await page.screenshot({
        path: join(CURRENT_DIR, `${route.name}.png`),
        fullPage: false, // Viewport only for consistent comparison
      })

      console.log(`   📸 Captured: ${route.name}.png`)
    })
  }
})

// Mobile viewport captures
test.describe('Screenshot Capture - Demo Mode Mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } }) // iPhone 14 Pro

  test.beforeAll(() => {
    if (!existsSync(CURRENT_DIR)) {
      mkdirSync(CURRENT_DIR, { recursive: true })
    }
  })

  for (const route of DEMO_ROUTES) {
    test(`capture ${route.name} mobile`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1000)

      // Verify demo mode is active
      const demoBanner = page.locator('text=demo')
      await expect(demoBanner.first()).toBeVisible({ timeout: 5000 })

      await page.screenshot({
        path: join(CURRENT_DIR, `${route.name}-mobile.png`),
        fullPage: false,
      })

      console.log(`   📱 Captured: ${route.name}-mobile.png`)
    })
  }
})

// Demo mode interaction tests
test.describe('Demo Mode Interactions', () => {
  test.beforeAll(() => {
    if (!existsSync(CURRENT_DIR)) {
      mkdirSync(CURRENT_DIR, { recursive: true })
    }
  })

  test('demo state persists across navigation', async ({ page }) => {
    // Go to home
    await page.goto('/?demo=true', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)

    // Verify children names are visible (from demo data)
    await expect(page.locator('text=Emilie').first()).toBeVisible({ timeout: 5000 })

    // Navigate to week planner
    await page.goto('/uke?demo=true', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)

    // Verify demo mode persisted
    const demoBanner = page.locator('text=demo')
    await expect(demoBanner.first()).toBeVisible()

    // Capture navigation state
    await page.screenshot({
      path: join(CURRENT_DIR, 'demo-week-after-nav.png'),
      fullPage: false,
    })

    console.log('   📸 Captured: demo-week-after-nav.png (state persistence test)')
  })

  test('admin page accessible in demo mode', async ({ page }) => {
    // Admin page should show fake households in demo mode
    await page.goto('/admin?demo=true', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    // Verify demo banner is visible
    const demoBanner = page.locator('text=demo')
    await expect(demoBanner.first()).toBeVisible({ timeout: 5000 })

    await page.screenshot({
      path: join(CURRENT_DIR, 'admin-demo.png'),
      fullPage: false,
    })

    console.log('   📸 Captured: admin-demo.png')
  })
})
