#!/usr/bin/env npx tsx
/**
 * AI Visual Validation (Intent-Aware)
 *
 * IMPORTANT: This script is NON-BLOCKING.
 * - It reports findings but does NOT fail the CI
 * - Only the final verdict script can block PRs
 * - Exit 0 = review completed (even if issues found)
 * - Exit 1 = script itself failed (API error, couldn't run)
 *
 * INTENT-AWARE VALIDATION:
 * Instead of just checking "does this look ok?", this script:
 * 1. Reads the PR diff to understand WHAT changed
 * 2. Generates EXPECTATIONS based on what the PR claims to do
 * 3. Validates screenshots against those specific expectations
 * 4. Reports mismatches between intent and reality
 *
 * Example: If PR says "Add delete button to user profile", the validation
 * will specifically look for a delete button on the profile page and flag
 * it if missing - not just do a generic "looks ok" check.
 *
 * Usage:
 *   npm run ai:visual-validate
 *   npm run ai:visual-validate -- --screenshots tests/visual/current
 */

import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { AI_MODELS, fetchWithStructuredOutput, callOpenRouter } from './ai-config'
import {
  type ReviewerOutput,
  type Finding,
  saveReviewerOutput,
  verdictEmoji,
} from './ai-review-types'

// ============================================
// Types
// ============================================

interface PRContext {
  diff: string
  description: string
  changedFiles: string[]
  uiChanges: string[] // Extracted UI-related changes
}

interface PRDerivedExpectation {
  page: string // Which page this applies to (home, week, settings, etc.)
  description: string // What the PR claims to change
  shouldSee: string[] // Specific elements that should be visible
  shouldNotSee: string[] // Elements that should NOT be visible (removed features)
  visualChanges: string[] // Expected visual differences from before
}

interface IntentValidationResult {
  prExpectation: PRDerivedExpectation
  met: boolean
  foundElements: string[]
  missingElements: string[]
  unexpectedElements: string[]
  explanation: string
}

interface PageExpectation {
  name: string
  description: string
  mustShow: string[]
  mustNotShow: string[]
  mobileConsiderations: string[]
  byDesign?: string[]  // Patterns that may look like issues but are intentional
}

interface ValidationResult {
  page: string
  verdict: 'PASS' | 'WARN' | 'FAIL'
  score: number // 0-100
  issues: Array<{
    severity: 'critical' | 'warning' | 'info'
    description: string
    suggestion?: string
  }>
  designSystemCompliance: {
    colorPalette: boolean
    typography: boolean
    spacing: boolean
    touchTargets: boolean
  }
  contentVisibility: {
    expected: string[]
    found: string[]
    missing: string[]
  }
  mobileUsability: {
    score: number
    notes: string[]
  }
  summary: string
}

interface OverallReport {
  timestamp: string
  totalPages: number
  passed: number
  warned: number
  failed: number
  averageScore: number
  results: ValidationResult[]
  recommendation: string
}

// ============================================
// Page Expectations
// ============================================

const PAGE_EXPECTATIONS: PageExpectation[] = [
  {
    name: 'home',
    description: 'Home page showing today\'s overview for a busy parent',
    mustShow: [
      'Today\'s date or "I dag" (Norwegian for "Today")',
      'Children names or pickup assignments',
      'Some form of meal/dinner info if meals are configured',
    ],
    mustNotShow: [
      'Error messages or crash screens',
      'Infinite loading spinners',
      'Broken images or missing icons',
      'Raw JSON or debug output',
    ],
    mobileConsiderations: [
      'Most important info (pickups) should be immediately visible',
      'Touch targets easily tappable with thumb',
    ],
    byDesign: [
      'Bottom navigation may not be visible in screenshots if viewport is scrolled - it is fixed at bottom',
      'Demo banner at top uses high-contrast honey/coral color intentionally for visibility',
    ],
  },
  {
    name: 'week',
    description: 'Week planner showing 7-day grid with pickups, meals, and events',
    mustShow: [
      'Days of the week (Mon-Sun or Norwegian weekday names)',
      'Children rows or columns with distinct colors',
      'Navigation back to home',
    ],
    mustNotShow: [
      'Overlapping text that\'s unreadable',
      'Broken layout with elements stacked incorrectly',
      'Cramped columns that are too narrow to read (columns should be at least ~100px wide)',
      'All 7 days squeezed into mobile width without scroll (this would make text unreadable)',
    ],
    mobileConsiderations: [
      'Week grid MUST have horizontal scroll on mobile - 7 days cannot fit readably without scroll',
      'Each day column should be wide enough to show picker names and meal text legibly',
      'Current day should be visually highlighted (coral/accent background)',
      'Grid should auto-scroll to show today\'s column on load',
    ],
    byDesign: [
      'Week grid uses horizontal scroll on mobile to show all 7 days - this is REQUIRED for readability',
      'If screenshot shows 7 columns crammed without scroll, this is a BUG not a design choice',
      'Meal row may be below the fold and require vertical scrolling - this is expected',
      'Week navigation arrows are at the top to match standard calendar patterns',
    ],
  },
  {
    name: 'feed',
    description: 'Feed page showing messages and photos from integrations',
    mustShow: [
      'Feed title or navigation indicating this is the feed',
      'Either content items OR empty state message',
      'Filter tabs or category selectors',
    ],
    mustNotShow: [
      'Login prompts (should be authenticated)',
      'Error states blocking all content',
    ],
    mobileConsiderations: [
      'Cards should be full-width on mobile',
      'Pull-to-refresh should be intuitive',
    ],
  },
  {
    name: 'settings',
    description: 'Settings page for managing household and preferences',
    mustShow: [
      'Settings sections or categories',
      'User info or household name',
      'Navigation elements',
    ],
    mustNotShow: [
      'Sensitive data like passwords in plain text',
      'Error states blocking access',
    ],
    mobileConsiderations: [
      'Settings should be easily navigable with thumb',
      'Toggle switches should be large enough to tap',
    ],
    byDesign: [
      'Category tabs may scroll horizontally when there are many sections - this provides clean overflow',
      'Bottom navigation icons use standard 20px size with generous touch padding',
    ],
  },
  {
    name: 'recipes',
    description: 'Recipe management page (oppskrifter) for storing and viewing recipes',
    mustShow: [
      'Recipe list or cards',
      'Add recipe button or action',
      'Navigation elements',
    ],
    mustNotShow: [
      'Error states blocking all content',
      'Broken images for recipe photos',
    ],
    mobileConsiderations: [
      'Recipe cards should be tappable',
      'Recipe details should be readable without zooming',
    ],
    byDesign: [
      'Empty state with "Legg til oppskrift" prompt is expected for new users',
      'Recipe images may use placeholder if no image uploaded',
    ],
  },
  {
    name: 'shopping',
    description: 'Shopping list page (handleliste) for managing grocery lists',
    mustShow: [
      'Shopping list items or empty state',
      'Add item functionality',
      'Category organization or simple list',
    ],
    mustNotShow: [
      'Error states blocking functionality',
      'Unreadable text or broken layout',
    ],
    mobileConsiderations: [
      'Checkbox/checkmark targets should be easily tappable',
      'Items should be easy to swipe or delete',
    ],
    byDesign: [
      'Items may be grouped by store category (AI-categorized)',
      'Completed items may be struck through or moved to bottom',
    ],
  },
  {
    name: 'admin',
    description: 'Admin panel for app administrators',
    mustShow: [
      'Admin sections or navigation',
      'User management or settings',
      'Clear indication this is an admin area',
    ],
    mustNotShow: [
      'Regular user content that should be hidden',
      'Error states or access denied messages (in demo)',
    ],
    mobileConsiderations: [
      'Admin functions should still work on mobile',
      'Tables or lists should be scrollable if needed',
    ],
    byDesign: [
      'Admin may have denser UI than user-facing pages - this is acceptable for power users',
      'Technical information display (model names, API status) is expected',
    ],
  },
]

// ============================================
// Design System Context
// ============================================

const FAMILJEN_DESIGN_CONTEXT = `
You are reviewing screenshots of Familjen, a Norwegian family planning app.

## Design System

### Colors
- Child identification colors (distinct, soft): sky (#7EB6C4), coral (#E8998D), sage (#94B49F), honey (#E5BA73), lavender (#B8A9C9), mint (#98D8AA)
- Background: warm off-white, not pure white
- Text: dark but not pure black for readability
- Avoid harsh contrasts that feel clinical

### Typography
- Should feel warm and approachable, not corporate
- Norwegian characters (ø, æ, å) must render correctly
- Body text at least 14px for readability

### Layout
- Mobile-first design
- Cards and sections with generous padding
- Bottom navigation in thumb zone on mobile

### Content
- Norwegian language (or Swedish/English based on settings)
- Dates in European format
- Times in 24-hour format

### User Context
- Primary users are busy parents, often checking app while handling kids
- One-handed mobile use is common
- Quick glance should convey the day's essentials

## Critical Usability Requirements (MUST check these)

1. **Week grid readability**: The 7-day week grid MUST have horizontal scroll on mobile. If you see all 7 columns squeezed into the mobile viewport without scroll capability, this is a CRITICAL BUG - columns would be ~55px wide which is unreadable. Proper columns should be ~100px wide minimum.

2. **Home page width**: The home page shows only 3 upcoming days and should fill 100% width WITHOUT scroll. This is different from the week page.

## Intentional Design Patterns (DO NOT flag as issues)
These patterns may look unusual but are BY DESIGN:

1. **Week grid horizontal scroll**: When the week page HAS scroll, this is correct - it's required for 7 days to be readable. Only flag if scroll is MISSING.

2. **Bottom navigation in screenshots**: The bottom navigation is fixed at the viewport bottom. It may not appear in screenshots if the content is scrolled - this is a screenshot artifact, not a missing element.

3. **Demo banner high contrast**: The demo mode banner uses intentionally high-contrast honey/coral colors to be clearly visible and distinguishable from regular content.

4. **Horizontal scrolling tabs**: Category tabs and filters use horizontal scroll for overflow - this is a standard mobile UX pattern.

5. **Content below fold**: Meal sections, tasks, and other content may require scrolling to see - this is expected and not an issue.

When reviewing, focus on ACTUAL issues like:
- Broken layouts, overlapping text, missing data
- Incorrect colors or typography
- Actual functionality problems visible in the UI
- Content that should be visible but is incorrectly hidden or broken
`

// ============================================
// PR Context & Intent-Aware Expectations
// ============================================

/**
 * Get the PR context (diff, description, changed files)
 */
function getPRContext(baseBranch = 'origin/main'): PRContext | null {
  try {
    // Get the diff using execFileSync (safe, no shell injection)
    let diff = ''
    try {
      diff = execFileSync('git', [
        'diff', `${baseBranch}...HEAD`, '--', '*.tsx', '*.ts', '*.css'
      ], { encoding: 'utf-8', maxBuffer: 1024 * 1024 }).slice(0, 50000)
    } catch {
      // Try without the range if that fails
      try {
        diff = execFileSync('git', [
          'diff', 'HEAD~5', '--', '*.tsx', '*.ts', '*.css'
        ], { encoding: 'utf-8', maxBuffer: 1024 * 1024 }).slice(0, 50000)
      } catch {
        return null
      }
    }

    // Get changed files
    let changedFiles: string[] = []
    try {
      const filesOutput = execFileSync('git', [
        'diff', '--name-only', `${baseBranch}...HEAD`
      ], { encoding: 'utf-8' })
      changedFiles = filesOutput.split('\n').filter(Boolean)
    } catch {
      changedFiles = []
    }

    // Get PR description from environment (set by GitHub Actions)
    const description = process.env.PR_BODY || process.env.PR_DESCRIPTION || ''

    // Extract UI-related changes from diff
    const uiChanges = extractUIChangesFromDiff(diff)

    return { diff, description, changedFiles, uiChanges }
  } catch {
    return null
  }
}

/**
 * Extract UI-related changes from the diff
 */
function extractUIChangesFromDiff(diff: string): string[] {
  const uiChanges: string[] = []

  const lines = diff.split('\n')
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      // Check for button additions
      if (line.includes('<button') || line.includes('<Button')) {
        const match = line.match(/>(.*?)<\/button/i) || line.match(/>([^<]+)</i)
        if (match) {
          uiChanges.push(`Added button: "${match[1].trim()}"`)
        } else {
          uiChanges.push('Added a button element')
        }
      }
      // Check for new text content
      if (line.includes('{t.') || line.includes("t('")) {
        uiChanges.push('Added translated text content')
      }
      // Check for modal/dialog
      if (line.includes('Modal') || line.includes('Dialog')) {
        uiChanges.push('Added modal or dialog component')
      }
      // Check for form elements
      if (line.includes('<input') || line.includes('<Input') || line.includes('<select')) {
        uiChanges.push('Added form input element')
      }
      // Check for icons
      if (line.includes('Icon') || line.includes('icon')) {
        uiChanges.push('Added or modified icons')
      }
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      // Check for removed elements
      if (line.includes('<button') || line.includes('<Button')) {
        uiChanges.push('Removed a button element')
      }
    }
  }

  return Array.from(new Set(uiChanges)) // Dedupe
}

/**
 * Generate PR-specific expectations using AI
 */
async function generatePRExpectations(context: PRContext): Promise<PRDerivedExpectation[]> {
  const prompt = `You are analyzing a PR to understand what UI changes it makes.

## PR Description
${context.description || 'No description provided'}

## Changed Files
${context.changedFiles.slice(0, 20).join('\n')}

## Detected UI Changes
${context.uiChanges.join('\n') || 'None detected'}

## Diff Preview (UI-related files)
\`\`\`diff
${context.diff.slice(0, 15000)}
\`\`\`

## Your Task
Based on this PR, identify what VISUAL changes should be visible in screenshots.

For each affected page, specify:
1. **page**: Which page is affected (home, week, feed, settings, recipes, shopping, admin)
2. **description**: What the PR changes on this page
3. **shouldSee**: Specific UI elements that should now be visible
4. **shouldNotSee**: UI elements that should be removed/hidden
5. **visualChanges**: Expected visual differences

Return JSON array:
[{
  "page": "home",
  "description": "Adds delete button to pickup cards",
  "shouldSee": ["Delete button or trash icon on pickup cards"],
  "shouldNotSee": [],
  "visualChanges": ["Pickup cards now have an action button area"]
}]

If no UI changes are visible (e.g., only backend changes), return: []

Only return the JSON array.`

  try {
    const response = await callOpenRouter(AI_MODELS.fast, [
      { role: 'user', content: prompt }
    ], { temperature: 0, maxTokens: 2000 })

    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0]) as PRDerivedExpectation[]
    return parsed.filter(e => e.page && e.description)
  } catch (error) {
    console.warn('⚠️ Could not generate PR expectations:', error)
    return []
  }
}

/**
 * Schema for intent validation
 */
const INTENT_VALIDATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    expectationMet: {
      type: 'boolean' as const,
      description: 'Whether the PR expectation is met in the screenshot',
    },
    foundElements: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Elements from shouldSee that were found',
    },
    missingElements: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Elements from shouldSee that were NOT found',
    },
    unexpectedIssues: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Any unexpected problems with the change',
    },
    explanation: {
      type: 'string' as const,
      description: 'Detailed explanation of what was found vs expected',
    },
    suggestion: {
      type: 'string' as const,
      description: 'Actionable suggestion if expectation not met',
    },
  },
  required: ['expectationMet', 'foundElements', 'missingElements', 'explanation'],
  additionalProperties: false,
}

/**
 * Validate a screenshot against PR-derived expectations
 */
async function validateIntentExpectation(
  screenshotPath: string,
  expectation: PRDerivedExpectation
): Promise<IntentValidationResult> {
  const imageBuffer = fs.readFileSync(screenshotPath)
  const base64Image = imageBuffer.toString('base64')

  const prompt = `You are validating if a UI change was correctly implemented.

## Expected Change
**Page:** ${expectation.page}
**What PR Claims:** ${expectation.description}

## Should See (look for these)
${expectation.shouldSee.map(s => `- ${s}`).join('\n') || '- No specific elements required'}

## Should NOT See (these should be absent)
${expectation.shouldNotSee.map(s => `- ${s}`).join('\n') || '- No elements to check for removal'}

## Expected Visual Changes
${expectation.visualChanges.map(s => `- ${s}`).join('\n') || '- No specific visual changes expected'}

## Your Task
Look at this screenshot and verify:
1. Are the "Should See" elements actually visible?
2. Are the "Should NOT See" elements correctly absent?
3. Do the visual changes match what was expected?

Be SPECIFIC about what you see. If something is missing, describe exactly where you looked.
If the implementation looks different from expected but is functionally correct, note that.`

  try {
    const response = await fetchWithStructuredOutput<{
      expectationMet: boolean
      foundElements: string[]
      missingElements: string[]
      unexpectedIssues?: string[]
      explanation: string
      suggestion?: string
    }>(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Image}` },
            },
          ],
        },
      ],
      INTENT_VALIDATION_SCHEMA,
      AI_MODELS.vision
    )

    return {
      prExpectation: expectation,
      met: response.expectationMet,
      foundElements: response.foundElements,
      missingElements: response.missingElements,
      unexpectedElements: response.unexpectedIssues || [],
      explanation: response.explanation + (response.suggestion ? ` Suggestion: ${response.suggestion}` : ''),
    }
  } catch (error) {
    return {
      prExpectation: expectation,
      met: false,
      foundElements: [],
      missingElements: expectation.shouldSee,
      unexpectedElements: [],
      explanation: `Failed to validate: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

// ============================================
// Validation Schema
// ============================================

const VALIDATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    verdict: {
      type: 'string' as const,
      enum: ['PASS', 'WARN', 'FAIL'],
      description: 'Overall verdict for this page',
    },
    score: {
      type: 'number' as const,
      minimum: 0,
      maximum: 100,
      description: 'Quality score 0-100',
    },
    issues: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          severity: { type: 'string' as const, enum: ['critical', 'warning', 'info'] },
          description: { type: 'string' as const },
          suggestion: { type: 'string' as const },
        },
        required: ['severity', 'description'],
      },
    },
    designSystemCompliance: {
      type: 'object' as const,
      properties: {
        colorPalette: { type: 'boolean' as const },
        typography: { type: 'boolean' as const },
        spacing: { type: 'boolean' as const },
        touchTargets: { type: 'boolean' as const },
      },
      required: ['colorPalette', 'typography', 'spacing', 'touchTargets'],
    },
    contentVisibility: {
      type: 'object' as const,
      properties: {
        expected: { type: 'array' as const, items: { type: 'string' as const } },
        found: { type: 'array' as const, items: { type: 'string' as const } },
        missing: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['expected', 'found', 'missing'],
    },
    mobileUsability: {
      type: 'object' as const,
      properties: {
        score: { type: 'number' as const, minimum: 0, maximum: 100 },
        notes: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['score', 'notes'],
    },
    summary: {
      type: 'string' as const,
      description: 'One-sentence summary of findings',
    },
  },
  required: ['verdict', 'score', 'issues', 'designSystemCompliance', 'contentVisibility', 'mobileUsability', 'summary'],
  additionalProperties: false,
}

// ============================================
// Main Validation Function
// ============================================

async function validateScreenshot(
  screenshotPath: string,
  expectation: PageExpectation
): Promise<ValidationResult> {
  if (!fs.existsSync(screenshotPath)) {
    return {
      page: expectation.name,
      verdict: 'FAIL',
      score: 0,
      issues: [{ severity: 'critical', description: `Screenshot not found: ${screenshotPath}` }],
      designSystemCompliance: { colorPalette: false, typography: false, spacing: false, touchTargets: false },
      contentVisibility: { expected: expectation.mustShow, found: [], missing: expectation.mustShow },
      mobileUsability: { score: 0, notes: ['Cannot evaluate - screenshot missing'] },
      summary: 'Screenshot file not found',
    }
  }

  const imageBuffer = fs.readFileSync(screenshotPath)
  const base64Image = imageBuffer.toString('base64')
  const mimeType = 'image/png'

  const byDesignSection = expectation.byDesign?.length
    ? `\n## By Design (DO NOT flag as issues)\n${expectation.byDesign.map(s => `- ${s}`).join('\n')}\n`
    : ''

  const prompt = `
${FAMILJEN_DESIGN_CONTEXT}

## Page Being Validated
**Page:** ${expectation.name}
**Description:** ${expectation.description}

## Must Show
${expectation.mustShow.map(s => `- ${s}`).join('\n')}

## Must NOT Show
${expectation.mustNotShow.map(s => `- ${s}`).join('\n')}

## Mobile Considerations
${expectation.mobileConsiderations.map(s => `- ${s}`).join('\n')}
${byDesignSection}
## Your Task
Analyze this screenshot and evaluate:

1. **Design System Compliance**: Does it follow Familjen's design system?
2. **Content Visibility**: Are the expected elements visible?
3. **Mobile Usability**: Would a busy parent with one hand free be able to use this?
4. **Issues**: Any ACTUAL problems that need fixing (ignore intentional patterns listed in "By Design")?

Be specific about what you see. If something looks broken, describe exactly what's wrong.
If the page looks good, confirm what's working well.

IMPORTANT: Do NOT flag items listed in "By Design" as issues - these are intentional patterns.

Remember: This is for Norwegian families. Check Norwegian text renders correctly.
`

  try {
    const visionModel = AI_MODELS.vision

    const response = await fetchWithStructuredOutput<ValidationResult>(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      VALIDATION_SCHEMA,
      visionModel
    )

    return {
      ...response,
      page: expectation.name,
    }
  } catch (error) {
    console.error(`Error validating ${expectation.name}:`, error)
    return {
      page: expectation.name,
      verdict: 'FAIL',
      score: 0,
      issues: [{ severity: 'critical', description: `AI validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      designSystemCompliance: { colorPalette: false, typography: false, spacing: false, touchTargets: false },
      contentVisibility: { expected: expectation.mustShow, found: [], missing: expectation.mustShow },
      mobileUsability: { score: 0, notes: ['Validation error'] },
      summary: 'AI validation encountered an error',
    }
  }
}

async function validateAllScreenshots(screenshotDir: string): Promise<OverallReport> {
  console.log('🔍 AI Visual Validation (No Baselines)\n')
  console.log(`📁 Screenshot directory: ${screenshotDir}`)

  const results: ValidationResult[] = []

  for (const expectation of PAGE_EXPECTATIONS) {
    // Check both desktop and mobile variants
    const variants = [
      { suffix: '', isMobile: false },
      { suffix: '-mobile', isMobile: true },
    ]

    for (const variant of variants) {
      const filename = `${expectation.name}${variant.suffix}.png`
      const filepath = path.join(screenshotDir, filename)

      if (fs.existsSync(filepath)) {
        console.log(`\n📸 Validating: ${filename}`)

        const result = await validateScreenshot(filepath, {
          ...expectation,
          name: `${expectation.name}${variant.suffix}`,
          mobileConsiderations: variant.isMobile
            ? expectation.mobileConsiderations
            : ['Desktop view - check readability and layout'],
        })

        results.push(result)

        // Print result
        const icon = result.verdict === 'PASS' ? '✅' : result.verdict === 'WARN' ? '⚠️' : '❌'
        console.log(`   ${icon} ${result.verdict} (Score: ${result.score}/100)`)
        console.log(`   ${result.summary}`)

        if (result.issues.length > 0) {
          result.issues.forEach(issue => {
            const issueIcon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵'
            console.log(`   ${issueIcon} ${issue.description}`)
          })
        }
      }
    }
  }

  const passed = results.filter(r => r.verdict === 'PASS').length
  const warned = results.filter(r => r.verdict === 'WARN').length
  const failed = results.filter(r => r.verdict === 'FAIL').length
  const avgScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
    : 0

  let recommendation: string
  if (failed > 0) {
    recommendation = 'FAIL: Critical issues found that need fixing before merge.'
  } else if (warned > results.length / 2) {
    recommendation = 'REVIEW: Multiple warnings detected. Consider addressing before merge.'
  } else if (avgScore >= 80) {
    recommendation = 'PASS: Visual quality meets standards. Safe to merge.'
  } else {
    recommendation = 'REVIEW: Some improvements suggested but no blockers.'
  }

  const report: OverallReport = {
    timestamp: new Date().toISOString(),
    totalPages: results.length,
    passed,
    warned,
    failed,
    averageScore: avgScore,
    results,
    recommendation,
  }

  return report
}

// ============================================
// CLI
// ============================================

/**
 * Convert ValidationResult issues to Finding[] format
 */
function convertToFindings(results: ValidationResult[]): Finding[] {
  const findings: Finding[] = []

  for (const result of results) {
    for (const issue of result.issues) {
      findings.push({
        severity: issue.severity,
        category: 'accessibility', // Visual issues map to accessibility
        message: `[${result.page}] ${issue.description}`,
        file: `tests/visual/current/${result.page}.png`,
      })
    }

    // Add findings for missing content
    for (const missing of result.contentVisibility.missing) {
      findings.push({
        severity: 'warning',
        category: 'accessibility',
        message: `[${result.page}] Expected content not visible: ${missing}`,
        file: `tests/visual/current/${result.page}.png`,
      })
    }

    // Add findings for design system non-compliance
    const ds = result.designSystemCompliance
    if (!ds.colorPalette) {
      findings.push({
        severity: 'info',
        category: 'accessibility',
        message: `[${result.page}] Color palette does not match design system`,
        file: `tests/visual/current/${result.page}.png`,
      })
    }
    if (!ds.touchTargets) {
      findings.push({
        severity: 'warning',
        category: 'accessibility',
        message: `[${result.page}] Touch targets may be too small`,
        file: `tests/visual/current/${result.page}.png`,
      })
    }
  }

  return findings
}

/**
 * Map overall report verdict based on finding severities, not just page counts
 * - FAIL: Only if there are critical severity issues
 * - WARN: If there are warning severity issues (but no critical)
 * - PASS: If only info-level issues exist
 */
function mapVerdict(report: OverallReport, findings: Finding[]): 'PASS' | 'WARN' | 'FAIL' {
  const hasCritical = findings.some(f => f.severity === 'critical')
  const hasWarning = findings.some(f => f.severity === 'warning')

  if (hasCritical) return 'FAIL'
  if (hasWarning) return 'WARN'
  return 'PASS'
}

async function main() {
  const startTime = Date.now()
  const args = process.argv.slice(2)
  let screenshotDir = 'tests/visual/current'
  let baseBranch = 'origin/main'

  console.log('🔍 AI Visual Validation (Intent-Aware)\n')

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--screenshots' && args[i + 1]) {
      screenshotDir = args[i + 1]
      i++
    }
  }

  // Check if directory exists
  if (!fs.existsSync(screenshotDir)) {
    console.error(`\n❌ Screenshot directory not found: ${screenshotDir}`)
    console.log('\nTo capture screenshots:')
    console.log('  npx playwright test capture-screenshots --project=chromium')

    // Save skipped output
    const skippedOutput: ReviewerOutput = {
      reviewer: 'visual-validation',
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'No screenshots to validate.',
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0) // Not an error - just nothing to validate
  }

  // Check for screenshots
  const screenshots = fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png'))
  if (screenshots.length === 0) {
    console.error(`\n❌ No screenshots found in: ${screenshotDir}`)
    console.log('\nTo capture screenshots:')
    console.log('  npx playwright test capture-screenshots --project=chromium')

    const skippedOutput: ReviewerOutput = {
      reviewer: 'visual-validation',
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'No screenshots found to validate.',
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0)
  }

  console.log(`\n📷 Found ${screenshots.length} screenshots: ${screenshots.join(', ')}`)

  // Get PR context for intent-aware validation
  const prContext = getPRContext(baseBranch)
  let prExpectations: PRDerivedExpectation[] = []
  let intentResults: IntentValidationResult[] = []

  if (prContext) {
    console.log('\n🎯 INTENT-AWARE MODE')
    console.log(`   Changed files: ${prContext.changedFiles.length}`)
    console.log(`   UI changes detected: ${prContext.uiChanges.length}`)

    if (prContext.uiChanges.length > 0) {
      console.log(`   Detected: ${prContext.uiChanges.slice(0, 3).join(', ')}${prContext.uiChanges.length > 3 ? '...' : ''}`)
    }

    // Generate PR-specific expectations
    console.log('\n   Generating expectations from PR diff...')
    prExpectations = await generatePRExpectations(prContext)

    if (prExpectations.length > 0) {
      console.log(`   Found ${prExpectations.length} UI expectations:`)
      for (const exp of prExpectations) {
        console.log(`   - ${exp.page}: ${exp.description}`)
      }

      // Validate each expectation against matching screenshots
      console.log('\n   Validating PR expectations against screenshots...')
      for (const expectation of prExpectations) {
        // Find matching screenshot
        const matchingScreenshot = screenshots.find(s =>
          s.startsWith(expectation.page) && s.endsWith('.png')
        )

        if (matchingScreenshot) {
          const screenshotPath = path.join(screenshotDir, matchingScreenshot)
          console.log(`   📸 Checking ${expectation.page}: "${expectation.description}"`)

          const result = await validateIntentExpectation(screenshotPath, expectation)
          intentResults.push(result)

          const icon = result.met ? '✅' : '❌'
          console.log(`      ${icon} ${result.met ? 'Expectation met' : 'Expectation NOT met'}`)
          if (!result.met && result.missingElements.length > 0) {
            console.log(`      Missing: ${result.missingElements.join(', ')}`)
          }
        } else {
          console.log(`   ⚠️ No screenshot found for page: ${expectation.page}`)
        }
      }
    } else {
      console.log('   No UI-visible changes detected in PR')
    }
  } else {
    console.log('\n📋 STATIC MODE (no PR context available)')
  }

  try {
    const report = await validateAllScreenshots(screenshotDir)

    // Save report (old format for backwards compatibility)
    const reportPath = 'visual-validation-report.json'
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`\n📄 Report saved: ${reportPath}`)

    // Convert to findings and determine verdict based on severity
    const findings = convertToFindings(report.results)

    // Add intent validation findings
    const intentFailed = intentResults.filter(r => !r.met)
    for (const result of intentFailed) {
      findings.push({
        severity: 'critical',
        category: 'intent-mismatch',
        message: `[${result.prExpectation.page}] PR intent not met: ${result.prExpectation.description}. ${result.explanation}`,
        file: `tests/visual/current/${result.prExpectation.page}.png`,
      })
    }

    // Add info findings for met expectations
    for (const result of intentResults.filter(r => r.met)) {
      findings.push({
        severity: 'info',
        category: 'intent-verified',
        message: `[${result.prExpectation.page}] PR intent verified: ${result.prExpectation.description}`,
        file: `tests/visual/current/${result.prExpectation.page}.png`,
      })
    }

    const verdict = mapVerdict(report, findings)

    // Build summary including intent validation
    let summaryText = `Validated ${report.totalPages} pages - Score: ${report.averageScore}/100. ${report.passed} passed, ${report.warned} warnings, ${report.failed} failed.`
    if (intentResults.length > 0) {
      const intentMet = intentResults.filter(r => r.met).length
      summaryText += ` Intent validation: ${intentMet}/${intentResults.length} expectations met.`
    }

    // Save in new standardized format
    const output: ReviewerOutput = {
      reviewer: 'visual-validation',
      model: AI_MODELS.vision,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'completed',
      verdict,
      confidence: report.averageScore,
      findings,
      summary: summaryText,
      raw: { ...report, intentResults, prExpectations },
    }
    saveReviewerOutput(output)

    // Print summary
    console.log('\n' + '='.repeat(50))
    console.log('📊 VALIDATION SUMMARY')
    console.log('='.repeat(50))
    console.log(`   Total pages: ${report.totalPages}`)
    console.log(`   ✅ Passed: ${report.passed}`)
    console.log(`   ⚠️  Warnings: ${report.warned}`)
    console.log(`   ❌ Failed: ${report.failed}`)
    console.log(`   📈 Average score: ${report.averageScore}/100`)
    if (intentResults.length > 0) {
      const intentMet = intentResults.filter(r => r.met).length
      console.log(`   🎯 Intent: ${intentMet}/${intentResults.length} expectations met`)
    }
    console.log('')
    console.log(`   ${report.recommendation}`)
    console.log('='.repeat(50))
    console.log(`\n📄 Results: ai-reviews/visual-validation.json`)

    // Generate markdown comment for PR
    const commentPath = 'visual-validation-comment.md'
    const comment = generatePRComment(report)
    // Add note that this is informational
    const commentWithNote = comment.replace(
      '## ',
      '## '
    ).replace(
      '---\n*Validated',
      '> ℹ️ This review is informational. The final verdict will decide if the PR can merge.\n\n---\n*Validated'
    )
    fs.writeFileSync(commentPath, commentWithNote)
    console.log(`\n💬 PR comment saved: ${commentPath}`)

    // Always exit 0 - review completed, final verdict decides blocking
    console.log(`\n${verdictEmoji(verdict)} Validation complete (${verdict})`)
    process.exit(0)

  } catch (error) {
    console.error('\n❌ Validation failed:', error)

    // Save error output
    const errorOutput: ReviewerOutput = {
      reviewer: 'visual-validation',
      model: AI_MODELS.vision,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'failed',
      verdict: 'ERROR',
      confidence: 0,
      findings: [{
        severity: 'critical',
        category: 'runtime-error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }],
      summary: 'Visual validation failed due to an error.',
    }
    saveReviewerOutput(errorOutput)

    process.exit(1) // Script itself failed
  }
}

function generatePRComment(report: OverallReport): string {
  const icon = report.failed > 0 ? '❌' : report.warned > 0 ? '⚠️' : '✅'

  let comment = `## ${icon} AI Visual Validation

**Score:** ${report.averageScore}/100 | **Passed:** ${report.passed} | **Warnings:** ${report.warned} | **Failed:** ${report.failed}

${report.recommendation}

`

  if (report.failed > 0 || report.warned > 0) {
    comment += `### Issues Found\n\n`

    for (const result of report.results) {
      if (result.verdict !== 'PASS') {
        const pageIcon = result.verdict === 'FAIL' ? '❌' : '⚠️'
        comment += `#### ${pageIcon} ${result.page}\n`
        comment += `> ${result.summary}\n\n`

        for (const issue of result.issues) {
          const issueIcon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵'
          comment += `- ${issueIcon} ${issue.description}\n`
          if (issue.suggestion) {
            comment += `  - *Suggestion:* ${issue.suggestion}\n`
          }
        }
        comment += '\n'
      }
    }
  }

  comment += `---\n*Validated by AI visual review at ${report.timestamp}*`

  return comment
}

main().catch(console.error)
