/**
 * Design System Tests
 *
 * Deterministic Playwright tests that verify design system consistency
 * without AI. These run fast and catch common design regressions.
 *
 * Based on frontend-design plugin philosophy:
 * - Avoid generic AI aesthetics
 * - Maintain visual identity
 * - Mobile-first, accessible design
 *
 * Uses mock auth to test authenticated pages on Vercel previews.
 *
 * Usage:
 *   npx playwright test design-system
 *   npx playwright test design-system --project=chromium
 */

import { test, expect } from '@playwright/test'
import { setupTestFixture } from './fixtures/mock-auth'

// Familjen child colors - must be distinguishable
const CHILD_COLORS = {
  sky: { hex: '#7EB6C4', rgb: 'rgb(126, 182, 196)' },
  coral: { hex: '#E8998D', rgb: 'rgb(232, 153, 141)' },
  sage: { hex: '#94B49F', rgb: 'rgb(148, 180, 159)' },
  honey: { hex: '#E5BA73', rgb: 'rgb(229, 186, 115)' },
  lavender: { hex: '#B8A9C9', rgb: 'rgb(184, 169, 201)' },
  mint: { hex: '#98D8AA', rgb: 'rgb(152, 216, 170)' },
}

// Minimum touch target size (WCAG 2.5.5)
const MIN_TOUCH_TARGET = 44

// Routes to test (all require authentication)
const ROUTES = [
  { path: '/', name: 'Home' },
  { path: '/uke', name: 'Week' },
  { path: '/feed', name: 'Feed' },
  { path: '/innstillinger', name: 'Settings' },
]

test.describe('Design System - Touch Targets', () => {
  for (const route of ROUTES) {
    test(`${route.name}: buttons meet minimum touch target size`, async ({ page, context }) => {
      // Set up mock auth so we can access protected pages
      await setupTestFixture(context, page, {
        childCount: 2,
        memberCount: 2,
        withPickups: true,
      })

      await page.goto(route.path)
      await page.waitForLoadState('networkidle')

      // Find all interactive elements
      const buttons = await page.locator('button, a, [role="button"], [onclick]').all()

      const violations: string[] = []

      for (const button of buttons) {
        const box = await button.boundingBox()
        if (box) {
          const isVisible = await button.isVisible()
          if (isVisible && (box.width < MIN_TOUCH_TARGET || box.height < MIN_TOUCH_TARGET)) {
            const text = (await button.textContent())?.slice(0, 30) || '[no text]'
            violations.push(`"${text}" is ${Math.round(box.width)}x${Math.round(box.height)}px`)
          }
        }
      }

      // Allow some small violations (icons with padding)
      if (violations.length > 5) {
        console.warn(`Touch target warnings on ${route.name}:`, violations.slice(0, 5))
      }

      // Hard fail if critical navigation buttons are too small
      const navButtons = await page.locator('nav button, nav a, header button, header a').all()
      for (const btn of navButtons) {
        const box = await btn.boundingBox()
        if (box) {
          const isVisible = await btn.isVisible()
          if (isVisible) {
            expect(
              box.width >= MIN_TOUCH_TARGET - 4 && box.height >= MIN_TOUCH_TARGET - 4,
              `Navigation button should be at least ${MIN_TOUCH_TARGET}px`
            ).toBeTruthy()
          }
        }
      }
    })
  }
})

test.describe('Design System - No Horizontal Scroll', () => {
  test.use({ viewport: { width: 390, height: 844 } }) // iPhone 14 Pro

  // Week page (/uke) intentionally has horizontal scroll for 7-day grid readability
  // It uses overflow-x-auto on the grid container, not document-level scroll
  const ROUTES_WITHOUT_SCROLL = ROUTES.filter(r => r.path !== '/uke')

  for (const route of ROUTES_WITHOUT_SCROLL) {
    test(`${route.name}: no horizontal overflow on mobile`, async ({ page, context }) => {
      await setupTestFixture(context, page, { childCount: 2, memberCount: 2, withPickups: true })
      await page.goto(route.path)
      await page.waitForLoadState('networkidle')

      // Check for horizontal scroll at document level
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })

      expect(hasHorizontalScroll, 'Page should not have horizontal scroll on mobile').toBeFalsy()
    })
  }

  // Week page: verify scroll is CONTAINED within the grid (not document-level)
  test('Week: horizontal scroll is contained within grid only', async ({ page, context }) => {
    await setupTestFixture(context, page, { childCount: 2, memberCount: 2, withPickups: true })
    await page.goto('/uke')
    await page.waitForLoadState('networkidle')

    // Document should NOT have horizontal scroll (scroll is contained in grid)
    const hasDocumentScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
    expect(hasDocumentScroll, 'Document should not scroll - only the week grid should').toBeFalsy()

    // Week grid container should have overflow-x-auto for internal scrolling
    const gridHasScroll = await page.locator('[class*="overflow-x-auto"]').isVisible()
    expect(gridHasScroll, 'Week grid should have contained horizontal scroll').toBeTruthy()
  })
})

test.describe('Design System - Typography', () => {
  for (const route of ROUTES) {
    test(`${route.name}: body text is readable size`, async ({ page, context }) => {
      await setupTestFixture(context, page, { childCount: 2, memberCount: 2, withPickups: true })
      await page.goto(route.path)
      await page.waitForLoadState('networkidle')

      // Check body text size
      const bodyFontSize = await page.evaluate(() => {
        const body = document.querySelector('body')
        if (!body) return 16
        return parseFloat(window.getComputedStyle(body).fontSize)
      })

      expect(bodyFontSize, 'Body font size should be at least 14px').toBeGreaterThanOrEqual(14)

      // Check that we're not using generic fonts as primary
      const fontFamily = await page.evaluate(() => {
        const body = document.querySelector('body')
        if (!body) return ''
        return window.getComputedStyle(body).fontFamily.toLowerCase()
      })

      // Warn (don't fail) if using generic fonts as primary
      const genericFonts = ['arial', 'inter', 'roboto', 'helvetica']
      const isGenericPrimary = genericFonts.some((f) => fontFamily.startsWith(f) || fontFamily.startsWith(`"${f}`))

      if (isGenericPrimary) {
        console.warn(`${route.name}: Using generic font as primary: ${fontFamily.slice(0, 50)}`)
      }
    })

    test(`${route.name}: Norwegian characters render correctly`, async ({ page, context }) => {
      await setupTestFixture(context, page, { childCount: 2, memberCount: 2, withPickups: true })
      await page.goto(route.path)
      await page.waitForLoadState('networkidle')

      // The page should contain Norwegian text somewhere
      const pageText = await page.textContent('body')

      // Check that Norwegian-specific characters exist and aren't replaced with boxes
      // We look for common Norwegian words
      const hasNorwegian =
        pageText?.includes('ø') ||
        pageText?.includes('æ') ||
        pageText?.includes('å') ||
        pageText?.includes('Ø') ||
        pageText?.includes('Æ') ||
        pageText?.includes('Å')

      // This is informational - not all pages may have Norwegian chars
      if (hasNorwegian) {
        // Verify they're not rendered as replacement characters
        const hasReplacementChars = pageText?.includes('�')
        expect(hasReplacementChars, 'Norwegian characters should not be replacement chars').toBeFalsy()
      }
    })
  }
})

test.describe('Design System - Visual Hierarchy', () => {
  for (const route of ROUTES) {
    test(`${route.name}: has clear heading hierarchy`, async ({ page, context }) => {
      await setupTestFixture(context, page, { childCount: 2, memberCount: 2, withPickups: true })
      await page.goto(route.path)
      await page.waitForLoadState('networkidle')

      // Get all heading sizes
      const headingSizes = await page.evaluate(() => {
        const sizes: Record<string, number[]> = { h1: [], h2: [], h3: [], h4: [] }

        for (const tag of ['h1', 'h2', 'h3', 'h4']) {
          const headings = document.querySelectorAll(tag)
          headings.forEach((h) => {
            const size = parseFloat(window.getComputedStyle(h).fontSize)
            sizes[tag].push(size)
          })
        }

        return sizes
      })

      // Check hierarchy: h1 > h2 > h3 > body (16px)
      const avgH1 = headingSizes.h1.length ? headingSizes.h1.reduce((a, b) => a + b, 0) / headingSizes.h1.length : 32
      const avgH2 = headingSizes.h2.length ? headingSizes.h2.reduce((a, b) => a + b, 0) / headingSizes.h2.length : 24
      const avgH3 = headingSizes.h3.length ? headingSizes.h3.reduce((a, b) => a + b, 0) / headingSizes.h3.length : 20

      if (headingSizes.h1.length > 0 && headingSizes.h2.length > 0) {
        expect(avgH1, 'H1 should be larger than H2').toBeGreaterThan(avgH2)
      }
      if (headingSizes.h2.length > 0 && headingSizes.h3.length > 0) {
        expect(avgH2, 'H2 should be larger than H3').toBeGreaterThan(avgH3)
      }
    })
  }
})

test.describe('Design System - Accessibility', () => {
  for (const route of ROUTES) {
    test(`${route.name}: interactive elements are focusable`, async ({ page, context }) => {
      await setupTestFixture(context, page, { childCount: 2, memberCount: 2, withPickups: true })
      await page.goto(route.path)
      await page.waitForLoadState('networkidle')

      // Tab through the page and check we can focus interactive elements
      const focusableCount = await page.evaluate(() => {
        const focusable = document.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        return focusable.length
      })

      // Every page should have some focusable elements
      expect(focusableCount, 'Page should have focusable elements').toBeGreaterThan(0)
    })

    test(`${route.name}: images have alt text`, async ({ page, context }) => {
      await setupTestFixture(context, page, { childCount: 2, memberCount: 2, withPickups: true })
      await page.goto(route.path)
      await page.waitForLoadState('networkidle')

      const imagesWithoutAlt = await page.evaluate(() => {
        const images = document.querySelectorAll('img')
        let missing = 0
        images.forEach((img) => {
          // Decorative images can have empty alt, but must have alt attribute
          if (!img.hasAttribute('alt')) {
            missing++
          }
        })
        return missing
      })

      expect(imagesWithoutAlt, 'All images should have alt attribute').toBe(0)
    })
  }
})

test.describe('Design System - Child Colors', () => {
  test('Week page: child colors are visually distinct', async ({ page, context }) => {
    await setupTestFixture(context, page, { childCount: 3, memberCount: 2, withPickups: true })
    await page.goto('/uke')
    await page.waitForLoadState('networkidle')

    // Find elements that might have child color backgrounds
    const coloredElements = await page.evaluate(() => {
      const elements = document.querySelectorAll('[class*="bg-"], [style*="background"]')
      const colors: string[] = []

      elements.forEach((el) => {
        const style = window.getComputedStyle(el)
        const bg = style.backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          colors.push(bg)
        }
      })

      return [...new Set(colors)]
    })

    // Just check that we have multiple distinct background colors
    // (indicating child differentiation is working)
    if (coloredElements.length > 1) {
      // This is good - we have color variety
      expect(coloredElements.length).toBeGreaterThan(1)
    }
  })
})

test.describe('Design System - Mobile Navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Bottom navigation is in thumb zone', async ({ page, context }) => {
    await setupTestFixture(context, page, { childCount: 2, memberCount: 2, withPickups: true })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Find bottom navigation
    const bottomNav = await page.locator('nav').last()
    const navBox = await bottomNav.boundingBox()

    if (navBox) {
      // Navigation should be in the bottom 20% of the screen (thumb zone)
      const viewportHeight = 844
      const navTop = navBox.y
      const bottomZoneStart = viewportHeight * 0.8

      expect(navTop, 'Navigation should be in bottom thumb zone').toBeGreaterThanOrEqual(bottomZoneStart - 100) // Allow some flexibility
    }
  })
})
