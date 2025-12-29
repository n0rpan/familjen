import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { COMPONENT_TO_PAGE, COMPONENT_TO_E2E, CORE_FILES } from '../../scripts/lib/dependency-graph'

/**
 * Tests to ensure dependency-graph.ts stays in sync with the codebase.
 * These tests catch stale mappings after refactoring.
 */

// Valid page names used by visual validation (from ai-visual-validation.ts)
// Keep in sync with PAGE_EXPECTATIONS in scripts/ai-visual-validation.ts
const VALID_PAGE_NAMES = new Set([
  'home',
  'week',
  'feed',
  'settings',
  'recipes',
  'shopping',
  'wishlist',
  'admin',
  'login',
  'all', // Special value: component affects all pages
])

// Map of page names to their actual routes in src/app/
const PAGE_TO_ROUTE: Record<string, string> = {
  home: 'src/app/page.tsx',
  week: 'src/app/uke/page.tsx',
  feed: 'src/app/feed/page.tsx',
  settings: 'src/app/innstillinger/page.tsx',
  recipes: 'src/app/oppskrifter/page.tsx',
  shopping: 'src/app/handleliste/page.tsx',
  admin: 'src/app/admin/page.tsx',
  login: 'src/app/login/page.tsx',
  // 'wishlist' is part of settings, not a separate route
  // 'all' is a special value, no specific route
}

describe('COMPONENT_TO_PAGE mapping', () => {
  it('references only valid page names', () => {
    const invalidPages: { component: string; page: string }[] = []

    for (const [component, pages] of Object.entries(COMPONENT_TO_PAGE)) {
      for (const page of pages) {
        if (!VALID_PAGE_NAMES.has(page)) {
          invalidPages.push({ component, page })
        }
      }
    }

    if (invalidPages.length > 0) {
      const details = invalidPages
        .map(({ component, page }) => `  ${component} → "${page}"`)
        .join('\n')
      throw new Error(
        `COMPONENT_TO_PAGE references unknown page names:\n${details}\n\n` +
          `Valid page names: ${[...VALID_PAGE_NAMES].join(', ')}\n` +
          `Update VALID_PAGE_NAMES in this test or fix the mapping.`
      )
    }
  })

  it('references components that exist', () => {
    const missingComponents: string[] = []

    for (const component of Object.keys(COMPONENT_TO_PAGE)) {
      if (!existsSync(component)) {
        missingComponents.push(component)
      }
    }

    if (missingComponents.length > 0) {
      throw new Error(
        `COMPONENT_TO_PAGE references non-existent components:\n` +
          missingComponents.map(c => `  ${c}`).join('\n') +
          `\n\nRemove these stale entries from COMPONENT_TO_PAGE.`
      )
    }
  })

  it('page routes exist in src/app/', () => {
    const missingRoutes: { page: string; expectedRoute: string }[] = []

    for (const [page, route] of Object.entries(PAGE_TO_ROUTE)) {
      if (!existsSync(route)) {
        missingRoutes.push({ page, expectedRoute: route })
      }
    }

    if (missingRoutes.length > 0) {
      const details = missingRoutes
        .map(({ page, expectedRoute }) => `  "${page}" → ${expectedRoute}`)
        .join('\n')
      throw new Error(
        `PAGE_TO_ROUTE references non-existent routes:\n${details}\n\n` +
          `Update PAGE_TO_ROUTE in this test or restore the missing pages.`
      )
    }
  })
})

describe('COMPONENT_TO_E2E mapping', () => {
  it('references directories/files that exist', () => {
    const missingPaths: string[] = []

    for (const path of Object.keys(COMPONENT_TO_E2E)) {
      if (!existsSync(path)) {
        missingPaths.push(path)
      }
    }

    if (missingPaths.length > 0) {
      throw new Error(
        `COMPONENT_TO_E2E references non-existent paths:\n` +
          missingPaths.map(p => `  ${p}`).join('\n') +
          `\n\nRemove these stale entries from COMPONENT_TO_E2E.`
      )
    }
  })

  it('references e2e test files that exist', () => {
    const missingTests: { source: string; testFile: string }[] = []

    for (const [source, testFiles] of Object.entries(COMPONENT_TO_E2E)) {
      for (const testFile of testFiles) {
        if (!existsSync(testFile)) {
          missingTests.push({ source, testFile })
        }
      }
    }

    if (missingTests.length > 0) {
      const details = missingTests
        .map(({ source, testFile }) => `  ${source} → ${testFile}`)
        .join('\n')
      throw new Error(
        `COMPONENT_TO_E2E references non-existent test files:\n${details}\n\n` +
          `Create the test files or update COMPONENT_TO_E2E.`
      )
    }
  })
})

describe('CORE_FILES', () => {
  it('all core files exist', () => {
    const missingFiles: string[] = []

    for (const file of CORE_FILES) {
      if (!existsSync(file)) {
        missingFiles.push(file)
      }
    }

    if (missingFiles.length > 0) {
      throw new Error(
        `CORE_FILES references non-existent files:\n` +
          missingFiles.map(f => `  ${f}`).join('\n') +
          `\n\nRemove these stale entries from CORE_FILES.`
      )
    }
  })
})

describe('Coverage check (informational)', () => {
  it('logs pages that might need COMPONENT_TO_PAGE coverage', () => {
    // Get all page.tsx files in src/app/
    const appDir = 'src/app'
    const pages: string[] = []

    function findPages(dir: string) {
      if (!existsSync(dir)) return
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          // Skip dynamic routes like [token]
          if (!entry.name.startsWith('[')) {
            findPages(fullPath)
          }
        } else if (entry.name === 'page.tsx') {
          pages.push(fullPath)
        }
      }
    }

    findPages(appDir)

    // Check which pages are covered by COMPONENT_TO_PAGE
    const coveredRoutes = new Set(Object.values(PAGE_TO_ROUTE))
    const uncoveredPages = pages.filter(page => !coveredRoutes.has(page))

    // This is informational - not all pages need visual tests
    if (uncoveredPages.length > 0) {
      console.log('\n📋 Pages without explicit COMPONENT_TO_PAGE coverage:')
      uncoveredPages.forEach(page => console.log(`   ${page}`))
      console.log('   (These may be covered by "all" or may not need visual tests)\n')
    }

    // Always pass - this is just informational
    expect(true).toBe(true)
  })
})
