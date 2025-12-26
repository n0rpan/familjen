import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E test configuration
 *
 * Philosophy: Test critical user journeys that busy parents depend on.
 * Focus on data integrity and clear error communication.
 *
 * Run with: npx playwright test
 * UI mode: npx playwright test --ui
 *
 * For Vercel preview testing, set PLAYWRIGHT_BASE_URL:
 *   PLAYWRIGHT_BASE_URL=https://preview-xxx.vercel.app npx playwright test
 */

// Use PLAYWRIGHT_BASE_URL if set (for Vercel preview testing), otherwise localhost
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const isExternalUrl = !!process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile is critical for parents on the go
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  // Only start dev server when testing locally (not against Vercel preview)
  webServer: isExternalUrl
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
})
