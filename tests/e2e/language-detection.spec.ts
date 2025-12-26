/**
 * Language Detection Tests
 *
 * Tests that the app correctly detects and displays content
 * in Norwegian or English based on browser locale.
 *
 * Uses mock auth to access protected pages on Vercel previews.
 *
 * Usage:
 *   npx playwright test language-detection
 *   npx playwright test language-detection --project=chromium
 */

import { test, expect } from '@playwright/test'
import { setupTestFixture } from './fixtures/mock-auth'

// Key UI text that differs between Norwegian and English
const UI_TEXT = {
  nb: {
    // Navigation
    home: 'Hjem',
    week: 'Uke',
    settings: 'Innstillinger',
    // Common
    save: 'Lagre',
    cancel: 'Avbryt',
    today: 'I dag',
    // Date-related
    dayNames: ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'],
  },
  en: {
    // Navigation
    home: 'Home',
    week: 'Week',
    settings: 'Settings',
    // Common
    save: 'Save',
    cancel: 'Cancel',
    today: 'Today',
    // Date-related
    dayNames: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  },
}

test.describe('Language Detection - Norwegian (nb-NO)', () => {
  // Set browser to Norwegian locale
  test.use({ locale: 'nb-NO' })

  test('Home page shows Norwegian text', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Check for Norwegian navigation text
    const pageText = await page.textContent('body')

    // Should have Norwegian text
    expect(
      pageText?.includes(UI_TEXT.nb.home) || pageText?.includes(UI_TEXT.nb.today),
      'Home page should show Norwegian text (Hjem or I dag)'
    ).toBeTruthy()

    // Should NOT have English text for the same terms
    const hasEnglishToday = pageText?.includes('Today') && !pageText?.includes('I dag')
    expect(hasEnglishToday, 'Page should not show English "Today" without Norwegian').toBeFalsy()
  })

  test('Week page shows Norwegian day names', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
    })

    await page.goto('/uke')
    await page.waitForLoadState('networkidle')

    const pageText = await page.textContent('body')

    // Check for at least one Norwegian day name
    const hasNorwegianDay = UI_TEXT.nb.dayNames.some((day) => pageText?.includes(day))
    expect(hasNorwegianDay, 'Week page should show Norwegian day names').toBeTruthy()
  })

  test('Norwegian characters render correctly', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
    })

    await page.goto('/uke')
    await page.waitForLoadState('networkidle')

    const pageText = await page.textContent('body')

    // Norwegian has ø, æ, å characters
    // "Lørdag" (Saturday) and "Søndag" (Sunday) contain ø
    // These should render correctly, not as replacement characters
    const hasNorwegianChars =
      pageText?.includes('ø') || pageText?.includes('æ') || pageText?.includes('å') || pageText?.includes('Ø')

    if (hasNorwegianChars) {
      // Verify they're not replacement characters (�)
      expect(pageText?.includes('�'), 'Norwegian characters should not be replacement chars').toBeFalsy()
    }
  })
})

test.describe('Language Detection - English (en-US)', () => {
  // Set browser to English locale
  test.use({ locale: 'en-US' })

  test('Home page shows English text', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const pageText = await page.textContent('body')

    // Should have English text (Home or Today)
    expect(
      pageText?.includes(UI_TEXT.en.home) || pageText?.includes(UI_TEXT.en.today),
      'Home page should show English text (Home or Today)'
    ).toBeTruthy()
  })

  test('Week page shows English day names', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
    })

    await page.goto('/uke')
    await page.waitForLoadState('networkidle')

    const pageText = await page.textContent('body')

    // Check for at least one English day name
    const hasEnglishDay = UI_TEXT.en.dayNames.some((day) => pageText?.includes(day))
    expect(hasEnglishDay, 'Week page should show English day names').toBeTruthy()
  })

  test('Settings page shows English UI', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: false,
    })

    await page.goto('/innstillinger')
    await page.waitForLoadState('networkidle')

    const pageText = await page.textContent('body')

    // Should show English settings text
    expect(
      pageText?.includes(UI_TEXT.en.settings) || pageText?.includes(UI_TEXT.en.save),
      'Settings page should show English text'
    ).toBeTruthy()
  })
})

test.describe('Language Detection - Swedish (sv-SE)', () => {
  // Set browser to Swedish locale
  test.use({ locale: 'sv-SE' })

  test('Home page shows Swedish text', async ({ page, context }) => {
    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const pageText = await page.textContent('body')

    // Swedish should show "Hem" for Home, "Idag" for Today
    const hasSwedishText = pageText?.includes('Hem') || pageText?.includes('Idag') || pageText?.includes('Vecka')
    expect(hasSwedishText, 'Home page should show Swedish text').toBeTruthy()
  })
})

test.describe('Language Detection - Cookie Override', () => {
  // Start with English browser
  test.use({ locale: 'en-US' })

  test('Language cookie overrides browser locale', async ({ page, context }) => {
    // Set Norwegian language cookie before navigation
    await context.addCookies([
      {
        name: 'familjen-lang',
        value: 'nb',
        domain: new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000').hostname,
        path: '/',
      },
    ])

    await setupTestFixture(context, page, {
      childCount: 2,
      memberCount: 2,
      withPickups: true,
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const pageText = await page.textContent('body')

    // Even with English browser, Norwegian cookie should make it show Norwegian
    expect(
      pageText?.includes(UI_TEXT.nb.home) || pageText?.includes(UI_TEXT.nb.today),
      'Cookie should override browser locale to show Norwegian'
    ).toBeTruthy()
  })
})
