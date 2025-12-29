/**
 * Playwright Authentication Setup
 *
 * Authenticates as a test user for E2E testing.
 * The test user should exist in the database with stable test data.
 *
 * Setup in Supabase:
 * 1. Create test user: test@familjen.eu
 * 2. Create test household with children, pickups, meals
 * 3. Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in GitHub Secrets
 *
 * This file runs once before all tests and saves auth state.
 */

import { test as setup, expect } from '@playwright/test'
import path from 'path'

const authFile = path.join(__dirname, '../.auth/user.json')

setup('authenticate', async ({ page }) => {
  const testEmail = process.env.E2E_TEST_EMAIL
  const testPassword = process.env.E2E_TEST_PASSWORD

  if (!testEmail || !testPassword) {
    console.log('⚠️ E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set - running tests without auth')
    console.log('   Tests will see login page instead of app content')
    return
  }

  console.log(`🔐 Authenticating as ${testEmail}`)

  // Go to login page
  await page.goto('/login')

  // Wait for Supabase auth to be ready
  await page.waitForLoadState('networkidle')

  // Check if already logged in (cookie persisted)
  const isLoggedIn = await page.evaluate(() => {
    return document.cookie.includes('sb-') && document.cookie.includes('auth-token')
  })

  if (isLoggedIn) {
    console.log('   Already authenticated (cookie found)')
    await page.context().storageState({ path: authFile })
    return
  }

  // Look for email input (Supabase Auth UI)
  const emailInput = page.locator('input[type="email"], input[name="email"]')
  const passwordInput = page.locator('input[type="password"], input[name="password"]')

  // Wait for login form
  await expect(emailInput).toBeVisible({ timeout: 10000 })

  // Fill credentials
  await emailInput.fill(testEmail)
  await passwordInput.fill(testPassword)

  // Submit form
  await page.locator('button[type="submit"]').click()

  // Wait for redirect to home page (successful login)
  await page.waitForURL('/', { timeout: 15000 })

  // Verify we're logged in by checking for user-specific content
  await expect(page.locator('nav, header')).toBeVisible()

  console.log('   ✅ Authentication successful')

  // Save auth state
  await page.context().storageState({ path: authFile })
})
