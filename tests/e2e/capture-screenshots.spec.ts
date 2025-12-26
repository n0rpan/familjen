/**
 * Screenshot Capture with Mock Data
 *
 * Captures screenshots of critical pages using AI-generated test data.
 * No real database or user needed - works on fresh Vercel previews.
 *
 * These screenshots are validated by AI visual review.
 *
 * Usage:
 *   npx playwright test capture-screenshots
 *   npx playwright test capture-screenshots --project=chromium
 */

import { test } from '@playwright/test'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { setupTestFixture } from './fixtures/mock-auth'
import { generateTestHousehold, generateScenario } from './fixtures/test-data-generator'

const CURRENT_DIR = 'tests/visual/current'

// Routes to capture with their expected content scenarios
const ROUTES = [
  {
    path: '/',
    name: 'home',
    scenario: 'full' as const, // Show a busy family's home page
  },
  {
    path: '/uke',
    name: 'week',
    scenario: 'busy-week' as const, // Week with lots of pickups
  },
  {
    path: '/feed',
    name: 'feed',
    scenario: 'full' as const,
  },
  {
    path: '/innstillinger',
    name: 'settings',
    scenario: 'full' as const,
  },
]

test.describe('Screenshot Capture with Mock Data', () => {
  test.beforeAll(() => {
    // Ensure output directory exists
    if (!existsSync(CURRENT_DIR)) {
      mkdirSync(CURRENT_DIR, { recursive: true })
    }
  })

  for (const route of ROUTES) {
    test(`capture ${route.name} (${route.path})`, async ({ page, context }) => {
      // Set up mock auth and test data
      const household = generateScenario(route.scenario)
      await setupTestFixture(context, page, {
        childCount: household.children.length,
        memberCount: household.members.length,
        withPickups: household.pickups.length > 0,
        withMeals: household.meals.length > 0,
      })

      // Navigate to route
      await page.goto(route.path, { waitUntil: 'networkidle' })

      // Wait for any animations to complete
      await page.waitForTimeout(500)

      // Capture screenshot
      await page.screenshot({
        path: join(CURRENT_DIR, `${route.name}.png`),
        fullPage: false, // Viewport only for consistent comparison
      })

      console.log(`   📸 Captured: ${route.name}.png (${household.children.length} children, ${household.members.length} members)`)
    })
  }
})

// Mobile viewport captures
test.describe('Screenshot Capture - Mobile with Mock Data', () => {
  test.use({ viewport: { width: 390, height: 844 } }) // iPhone 14 Pro

  test.beforeAll(() => {
    if (!existsSync(CURRENT_DIR)) {
      mkdirSync(CURRENT_DIR, { recursive: true })
    }
  })

  for (const route of ROUTES) {
    test(`capture ${route.name} mobile (${route.path})`, async ({ page, context }) => {
      // Set up mock auth and test data
      const household = generateScenario(route.scenario)
      await setupTestFixture(context, page, {
        childCount: household.children.length,
        memberCount: household.members.length,
        withPickups: household.pickups.length > 0,
        withMeals: household.meals.length > 0,
      })

      await page.goto(route.path, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)

      await page.screenshot({
        path: join(CURRENT_DIR, `${route.name}-mobile.png`),
        fullPage: false,
      })

      console.log(`   📱 Captured: ${route.name}-mobile.png`)
    })
  }
})

// Specific scenario captures for edge cases
test.describe('Screenshot Capture - Edge Cases', () => {
  test.beforeAll(() => {
    if (!existsSync(CURRENT_DIR)) {
      mkdirSync(CURRENT_DIR, { recursive: true })
    }
  })

  test('capture empty state (no pickups/meals)', async ({ page, context }) => {
    const household = generateScenario('empty')
    await setupTestFixture(context, page, {
      childCount: household.children.length,
      memberCount: household.members.length,
      withPickups: false,
      withMeals: false,
    })

    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)

    await page.screenshot({
      path: join(CURRENT_DIR, 'home-empty.png'),
      fullPage: false,
    })

    console.log('   📸 Captured: home-empty.png (empty state)')
  })

  test('capture single parent scenario', async ({ page, context }) => {
    const household = generateScenario('single-parent')
    await setupTestFixture(context, page, {
      childCount: household.children.length,
      memberCount: 1,
      withPickups: true,
      withMeals: true,
    })

    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)

    await page.screenshot({
      path: join(CURRENT_DIR, 'home-single-parent.png'),
      fullPage: false,
    })

    console.log('   📸 Captured: home-single-parent.png')
  })
})
