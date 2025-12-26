#!/usr/bin/env npx tsx
/**
 * AI-Powered Visual Review
 *
 * Compares baseline screenshots with current screenshots using AI vision
 * to detect functional/UX regressions that pixel-diff tools would miss.
 *
 * Philosophy: "Can a busy parent use this one-handed while holding a child?"
 *
 * Usage:
 *   npx tsx scripts/ai-visual-review.ts
 *   npx tsx scripts/ai-visual-review.ts --capture  # Capture current screenshots
 *   npx tsx scripts/ai-visual-review.ts --update   # Update baselines
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import { AI_MODELS, callOpenRouterStructured, SCHEMAS, type VisualReviewResult } from './ai-config'

const VISUAL_DIR = 'tests/visual'
const BASELINES_DIR = join(VISUAL_DIR, 'baselines')
const CURRENT_DIR = join(VISUAL_DIR, 'current')

interface DesignPatterns {
  colorPalette: string[]
  typography: string[]
  spacing: string[]
  mobileFirst: string[]
}

interface VisualSpec {
  name: string
  route: string
  slug: string
  goal: string
  criticalElements: string[]
  designPatterns?: DesignPatterns
}

// Familjen Design System - based on frontend-design plugin philosophy
const FAMILJEN_DESIGN_SYSTEM: DesignPatterns = {
  colorPalette: [
    'Child colors: sky (#7EB6C4), coral (#E8998D), sage (#94B49F), honey (#E5BA73), lavender (#B8A9C9), mint (#98D8AA)',
    'Background: warm off-white, not pure white',
    'Text: dark gray for readability, not pure black',
    'Accent colors should complement, not clash with child colors',
  ],
  typography: [
    'System fonts or Norwegian-friendly fonts (not generic Inter/Roboto/Arial)',
    'Clear hierarchy: headings > subheadings > body',
    'Readable on mobile without zooming (min 16px body)',
    'Norwegian characters (æ, ø, å) must render correctly',
  ],
  spacing: [
    'Consistent padding (8px grid system)',
    'Touch targets minimum 44x44px',
    'Breathing room between interactive elements',
    'Cards have visible boundaries or shadows',
  ],
  mobileFirst: [
    'Bottom navigation reachable with thumb',
    'No horizontal scrolling on mobile',
    'Important actions above the fold',
    'One-handed use while holding a child',
  ],
}

// Define specs for critical user journeys
const VISUAL_SPECS: VisualSpec[] = [
  {
    name: 'Home - Today Overview',
    route: '/',
    slug: 'home',
    goal: "Busy parent can see today's pickups, meals, and tasks at a glance without scrolling",
    criticalElements: [
      'TodayOverview card with current date',
      'Pickup assignments clearly showing who picks up which child',
      "Today's meal visible",
      'Child tasks/reminders if any',
      'Navigation to week view',
    ],
    designPatterns: FAMILJEN_DESIGN_SYSTEM,
  },
  {
    name: 'Week Planner',
    route: '/uke',
    slug: 'week',
    goal: "Parent can quickly see and modify the entire week's plan",
    criticalElements: [
      '7-day grid visible (Mon-Sun)',
      'Each day shows pickups, meals, events',
      'Child colors are distinguishable',
      'Add/edit controls are accessible',
      'Mobile: swipeable or scrollable days',
    ],
    designPatterns: FAMILJEN_DESIGN_SYSTEM,
  },
  {
    name: 'Feed Page',
    route: '/feed',
    slug: 'feed',
    goal: 'Parent can see messages and photos from integrations',
    criticalElements: [
      'Filter tabs for different sources',
      'Message cards with sender and date',
      'Photo gallery with thumbnails',
      'Sync button visible',
      'Sync failure banner if errors exist',
    ],
    designPatterns: FAMILJEN_DESIGN_SYSTEM,
  },
  {
    name: 'Settings - Household',
    route: '/innstillinger',
    slug: 'settings',
    goal: 'Parent can manage family members and children',
    criticalElements: [
      'Household members list',
      'Children list with color indicators',
      'Add member/child buttons',
      'Integration settings section',
    ],
    designPatterns: FAMILJEN_DESIGN_SYSTEM,
  },
]

function ensureDirectories(): void {
  if (!existsSync(VISUAL_DIR)) mkdirSync(VISUAL_DIR, { recursive: true })
  if (!existsSync(BASELINES_DIR)) mkdirSync(BASELINES_DIR, { recursive: true })
  if (!existsSync(CURRENT_DIR)) mkdirSync(CURRENT_DIR, { recursive: true })
}

function getScreenshotPath(dir: string, slug: string): string {
  return join(dir, `${slug}.png`)
}

async function reviewScreenshot(spec: VisualSpec): Promise<VisualReviewResult | null> {
  const baselinePath = getScreenshotPath(BASELINES_DIR, spec.slug)
  const currentPath = getScreenshotPath(CURRENT_DIR, spec.slug)

  if (!existsSync(baselinePath)) {
    console.log(`  ⚠️ No baseline for ${spec.name}`)
    return null
  }
  if (!existsSync(currentPath)) {
    console.log(`  ⚠️ No current screenshot for ${spec.name}`)
    return null
  }

  const baseline = readFileSync(baselinePath).toString('base64')
  const current = readFileSync(currentPath).toString('base64')

  // Build design system section if available
  const designSection = spec.designPatterns
    ? `
## Familjen Design System (check for consistency)

### Color Palette:
${spec.designPatterns.colorPalette.map((c) => `- ${c}`).join('\n')}

### Typography:
${spec.designPatterns.typography.map((t) => `- ${t}`).join('\n')}

### Spacing & Touch:
${spec.designPatterns.spacing.map((s) => `- ${s}`).join('\n')}

### Mobile-First:
${spec.designPatterns.mobileFirst.map((m) => `- ${m}`).join('\n')}
`
    : ''

  const prompt = `You are a UI/UX expert reviewing design changes for Familjen, a Norwegian family planning app used by busy parents (often one-handed while holding a child).

## Screen: ${spec.name}
## Route: ${spec.route}
## Goal: ${spec.goal}

## Critical Elements That Must Be Present:
${spec.criticalElements.map((e, i) => `${i + 1}. ${e}`).join('\n')}
${designSection}
## Your Task
Compare the BASELINE (first image) with CURRENT (second image).

### Functional Check:
1. Does CURRENT still achieve the GOAL for a busy parent?
2. Are all CRITICAL ELEMENTS present and functional-looking?
3. Any obvious bugs? (overlapping elements, cut-off text, broken layouts)

### Design System Check:
4. Are child colors used consistently (sky, coral, sage, honey, lavender, mint)?
5. Is visual hierarchy clear? (headings > body text)
6. Do interactive elements look tappable? (buttons, links clearly styled)
7. Is the layout coherent with breathing room between elements?

### Accessibility & UX:
8. Contrast: Is text readable against backgrounds?
9. Touch targets: Are buttons/links at least 44x44px?
10. Mobile usability: Can this be used one-handed?
11. Norwegian text: Do æ, ø, å render correctly?

### Avoid Generic AI Aesthetics:
12. Does it avoid clichéd design? (no gratuitous purple gradients, generic card layouts)
13. Does the design feel intentional and distinctive, not cookie-cutter?

Be practical, not pedantic:
- Minor style tweaks (small spacing changes) are FINE
- Broken functionality, hidden elements, or inaccessible UI are NOT fine
- Design should serve busy parents, not win design awards

Analyze both images and provide your assessment.`

  try {
    // Note: Vision models may not fully support structured outputs, so we use regular call with fallback
    const result = await callOpenRouterStructured<VisualReviewResult>(
      AI_MODELS.vision,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${baseline}` } },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${current}` } },
          ],
        },
      ],
      SCHEMAS.visualReview,
      'visual_review',
      { temperature: 0 }
    )
    return result
  } catch {
    return null
  }
}

function printCaptureInstructions(): void {
  console.log(`
📸 Screenshot Capture Instructions

To capture screenshots for visual review, use Playwright:

1. Add to tests/e2e/capture-screenshots.spec.ts:

   import { test } from '@playwright/test'

   const routes = [
     { path: '/', name: 'home' },
     { path: '/uke', name: 'week' },
     { path: '/feed', name: 'feed' },
     { path: '/innstillinger', name: 'settings' },
   ]

   test('capture screenshots', async ({ page }) => {
     // Login first if needed
     for (const route of routes) {
       await page.goto(route.path)
       await page.waitForLoadState('networkidle')
       await page.screenshot({ path: \`tests/visual/current/\${route.name}.png\` })
     }
   })

2. Run: npx playwright test capture-screenshots

3. Then run: npx tsx scripts/ai-visual-review.ts
`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--capture')) {
    printCaptureInstructions()
    process.exit(0)
  }

  if (args.includes('--update')) {
    ensureDirectories()
    const currentFiles = readdirSync(CURRENT_DIR).filter((f) => f.endsWith('.png'))
    if (currentFiles.length === 0) {
      console.log('No current screenshots to update baselines from.')
      console.log('Run with --capture first to see instructions.')
      process.exit(1)
    }
    for (const file of currentFiles) {
      copyFileSync(join(CURRENT_DIR, file), join(BASELINES_DIR, file))
      console.log(`Updated baseline: ${file}`)
    }
    console.log('\n✅ Baselines updated')
    process.exit(0)
  }

  console.log('🔍 AI Visual Review')
  console.log(`Model: ${AI_MODELS.vision}`)

  ensureDirectories()

  const results: Array<{ name: string; result: VisualReviewResult | null }> = []
  let hasFailure = false

  for (const spec of VISUAL_SPECS) {
    console.log(`\n📱 Reviewing: ${spec.name}`)

    try {
      const result = await reviewScreenshot(spec)
      results.push({ name: spec.name, result })

      if (result) {
        const icon = result.pass ? '✅' : '❌'
        console.log(`  ${icon} Score: ${result.score}/100`)
        console.log(`  ${result.summary}`)

        if (!result.pass) {
          hasFailure = true
          if (result.issues.length > 0) {
            console.log('  Issues:')
            result.issues.forEach((i) => console.log(`    - ${i}`))
          }
        }
      }
    } catch (error) {
      console.log(`  ⚠️ Review failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      results.push({ name: spec.name, result: null })
    }
  }

  // Write results
  writeFileSync('visual-review.json', JSON.stringify(results, null, 2))
  console.log('\n📄 Results written to visual-review.json')

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))

  const reviewed = results.filter((r) => r.result !== null)
  const passed = results.filter((r) => r.result?.pass === true)
  const failed = results.filter((r) => r.result?.pass === false)
  const skipped = results.filter((r) => r.result === null)

  console.log(`Reviewed: ${reviewed.length}`)
  console.log(`Passed: ${passed.length}`)
  console.log(`Failed: ${failed.length}`)
  console.log(`Skipped: ${skipped.length}`)

  if (hasFailure) {
    console.log('\n❌ Visual review failed')
    process.exit(1)
  } else if (reviewed.length === 0) {
    console.log('\n⚠️ No screenshots to review')
    console.log('Run with --capture to see setup instructions')
    process.exit(0)
  } else {
    console.log('\n✅ Visual review passed')
    process.exit(0)
  }
}

main().catch((error) => {
  console.error('Visual review failed:', error.message)
  process.exit(1)
})
