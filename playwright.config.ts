import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E test configuration
 *
 * Philosophy: Test critical user journeys that busy parents depend on.
 * Focus on data integrity and clear error communication.
 *
 * Runs in two modes:
 * 1. Mock Auth Mode (default): Uses mock auth fixtures with AI-generated test data
 *    - Works on fresh Vercel previews with no real database
 *    - Tests UI rendering and user flows with mock API responses
 *
 * 2. Real Auth Mode: Uses actual Supabase auth (requires E2E_TEST_EMAIL/PASSWORD)
 *    - For integration testing against real database
 *    - Run with: E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... npx playwright test
 *
 * Usage:
 *   npx playwright test                    # Mock auth (default)
 *   npx playwright test --project=chromium # Desktop only
 *   PLAYWRIGHT_BASE_URL=https://preview.vercel.app npx playwright test
 */

// Use PLAYWRIGHT_BASE_URL if set (for Vercel preview testing), otherwise localhost
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const isExternalUrl = !!process.env.PLAYWRIGHT_BASE_URL

// Vercel protection bypass for CI automation
const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

// Check if real auth credentials are provided
const useRealAuth = !!(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD)
const authFile = 'tests/.auth/user.json'

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
    // Bypass Vercel deployment protection in CI
    ...(vercelBypassSecret && {
      extraHTTPHeaders: {
        'x-vercel-protection-bypass': vercelBypassSecret,
      },
    }),
  },

  projects: useRealAuth
    ? [
        // Real auth mode - uses actual Supabase credentials
        {
          name: 'setup',
          testMatch: /auth\.setup\.ts/,
        },
        {
          name: 'chromium',
          use: {
            ...devices['Desktop Chrome'],
            storageState: authFile,
          },
          dependencies: ['setup'],
        },
        {
          name: 'mobile-chrome',
          use: {
            ...devices['Pixel 5'],
            storageState: authFile,
          },
          dependencies: ['setup'],
        },
        {
          name: 'mobile-safari',
          use: {
            ...devices['iPhone 12'],
            storageState: authFile,
          },
          dependencies: ['setup'],
        },
      ]
    : [
        // Mock auth mode (default) - no setup needed, tests use mock fixtures
        {
          name: 'chromium',
          use: devices['Desktop Chrome'],
          testIgnore: /auth\.setup\.ts/, // Skip auth setup when using mocks
        },
        {
          name: 'mobile-chrome',
          use: devices['Pixel 5'],
          testIgnore: /auth\.setup\.ts/,
        },
        {
          name: 'mobile-safari',
          use: devices['iPhone 12'],
          testIgnore: /auth\.setup\.ts/,
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
