/**
 * Screenshot Capture for AI Visual Review
 *
 * Captures screenshots of critical pages for AI-powered visual regression testing.
 * These screenshots are compared against baselines using the ai-visual-review script.
 *
 * Usage:
 *   npx playwright test capture-screenshots
 *   npx playwright test capture-screenshots --project=chromium
 */

import { test } from '@playwright/test'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const CURRENT_DIR = 'tests/visual/current'

// Routes to capture - must match VISUAL_SPECS in ai-visual-review.ts
const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/uke', name: 'week' },
  { path: '/feed', name: 'feed' },
  { path: '/innstillinger', name: 'settings' },
]

test.describe('Screenshot Capture', () => {
  test.beforeAll(() => {
    // Ensure output directory exists
    if (!existsSync(CURRENT_DIR)) {
      mkdirSync(CURRENT_DIR, { recursive: true })
    }
  })

  for (const route of ROUTES) {
    test(`capture ${route.name} (${route.path})`, async ({ page }) => {
      // Navigate to route
      await page.goto(route.path, { waitUntil: 'networkidle' })

      // Wait for any animations to complete
      await page.waitForTimeout(500)

      // Capture screenshot
      await page.screenshot({
        path: join(CURRENT_DIR, `${route.name}.png`),
        fullPage: false, // Viewport only for consistent comparison
      })
    })
  }
})

// Mobile viewport captures
test.describe('Screenshot Capture - Mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } }) // iPhone 14 Pro

  test.beforeAll(() => {
    if (!existsSync(CURRENT_DIR)) {
      mkdirSync(CURRENT_DIR, { recursive: true })
    }
  })

  for (const route of ROUTES) {
    test(`capture ${route.name} mobile (${route.path})`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)

      await page.screenshot({
        path: join(CURRENT_DIR, `${route.name}-mobile.png`),
        fullPage: false,
      })
    })
  }
})
