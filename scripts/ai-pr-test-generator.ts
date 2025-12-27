#!/usr/bin/env npx tsx
/**
 * AI PR Test Generator
 *
 * IMPORTANT: This script is NON-BLOCKING.
 * - It generates test scenarios but does NOT fail the CI
 * - Test execution results are reported via the e2e-test-reporter
 * - Exit 0 = generation completed
 * - Exit 1 = script itself failed
 *
 * Analyzes PR changes and generates targeted test scenarios that verify
 * the specific features being changed. This catches regressions that
 * static e2e tests miss (like the demo mode event clicking bug).
 *
 * Usage:
 *   npx tsx scripts/ai-pr-test-generator.ts
 *   npx tsx scripts/ai-pr-test-generator.ts --base origin/main
 *
 * Output:
 *   - tests/e2e/generated/pr-scenarios.json - Test scenarios for Playwright
 *   - ai-reviews/pr-test-generator.json - Reviewer output
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { callOpenRouter, getOpenRouterKey, parseJsonFromResponse } from './ai-config'
import { type ReviewerOutput, saveReviewerOutput } from './ai-review-types'

// ============================================
// Types
// ============================================

export interface TestScenario {
  id: string
  name: string
  description: string
  priority: 'critical' | 'high' | 'medium' | 'low'

  // Test configuration
  page: string                    // URL path (e.g., '/uke?demo=true')
  viewport?: 'mobile' | 'desktop' // Default: desktop
  needsAuth: boolean              // Whether test needs mock auth
  needsDemo: boolean              // Whether test uses demo mode

  // Test steps
  steps: TestStep[]

  // Expected outcomes
  assertions: TestAssertion[]

  // Context from PR
  relatedFiles: string[]
  prContext: string              // Why this test is relevant to the PR
}

export interface TestStep {
  action: 'goto' | 'click' | 'fill' | 'wait' | 'scroll' | 'hover'
  target?: string                // Selector or URL
  value?: string                 // For fill actions
  waitFor?: string               // Wait condition
  timeout?: number               // Custom timeout in ms
}

export interface TestAssertion {
  type: 'visible' | 'hidden' | 'text' | 'url' | 'count' | 'attribute'
  target: string                 // Selector or expected URL
  value?: string                 // Expected text/value
  count?: number                 // Expected count
  attribute?: { name: string; value: string }
}

interface GeneratedTests {
  prTitle: string
  prDescription: string
  generatedAt: string
  scenarios: TestScenario[]
}

// ============================================
// PR Analysis
// ============================================

function getGitDiff(baseBranch: string): string {
  try {
    return execSync(`git diff ${baseBranch}...HEAD`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  } catch {
    // Fallback: diff against origin/main
    try {
      return execSync('git diff origin/main...HEAD', { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    } catch {
      // Last resort: diff uncommitted changes
      return execSync('git diff HEAD', { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    }
  }
}

function getChangedFiles(baseBranch: string): string[] {
  try {
    const output = execSync(`git diff --name-only ${baseBranch}...HEAD`, { encoding: 'utf-8' })
    return output.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function getPRContext(): { title: string; body: string } {
  // Try to get PR context from environment (set by CI)
  const title = process.env.GITHUB_PR_TITLE || ''
  const body = process.env.GITHUB_PR_BODY || ''

  // If not in CI, try to infer from commit messages
  if (!title) {
    try {
      const commits = execSync('git log --oneline -10 HEAD ^origin/main', { encoding: 'utf-8' })
      return {
        title: 'Local changes',
        body: commits
      }
    } catch {
      return { title: 'Unknown PR', body: '' }
    }
  }

  return { title, body }
}

// ============================================
// AI Test Generation
// ============================================

const TEST_GENERATION_PROMPT = `You are a QA engineer analyzing a Pull Request to generate targeted E2E test scenarios.

## Context
This is a Norwegian family planning app (Familjen) with:
- Home page (\`/\`) showing today's overview
- Week planner (\`/uke\`) with pickups, meals, events, tasks
- Demo mode (\`?demo=true\`) for testing without auth
- Norwegian i18n (e.g., "Middag" = dinner, "Henting" = pickup)

## Your Task
Analyze the PR diff and generate test scenarios that:
1. Verify the new/changed functionality works
2. Check for regressions in related features
3. Test error states and edge cases
4. Verify demo mode works if demo-related files changed

## Test Scenario Format
For each scenario, provide:
- A descriptive name
- Priority (critical/high/medium/low)
- The page URL to test
- Whether it needs auth or demo mode
- Concrete steps (click, fill, wait)
- Assertions to verify success

## Selector Tips
Use these patterns for robust selectors:
- Text content: \`text=Middag\`, \`text=Legg til\`
- Test IDs: \`[data-testid="week-grid"]\`
- Roles: \`button:has-text("Lagre")\`
- Combine: \`div.modal >> text=Detaljer\`

## Important Notes
- Focus on USER-FACING behavior, not implementation details
- Demo mode is accessed via \`?demo=true\` query param
- Event clicks should open detail modals
- Pickup assignments should be visible with member names
- Meals should show food names or "Middag" label

Generate 3-8 test scenarios based on what changed in the PR.
`

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    scenarios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          page: { type: 'string' },
          viewport: { type: 'string', enum: ['mobile', 'desktop'] },
          needsAuth: { type: 'boolean' },
          needsDemo: { type: 'boolean' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['goto', 'click', 'fill', 'wait', 'scroll', 'hover'] },
                target: { type: 'string' },
                value: { type: 'string' },
                waitFor: { type: 'string' },
                timeout: { type: 'integer' }
              },
              required: ['action'],
              additionalProperties: false
            }
          },
          assertions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['visible', 'hidden', 'text', 'url', 'count', 'attribute'] },
                target: { type: 'string' },
                value: { type: 'string' },
                count: { type: 'integer' },
                attribute: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    value: { type: 'string' }
                  },
                  additionalProperties: false
                }
              },
              required: ['type', 'target'],
              additionalProperties: false
            }
          },
          relatedFiles: { type: 'array', items: { type: 'string' } },
          prContext: { type: 'string' }
        },
        required: ['id', 'name', 'description', 'priority', 'page', 'needsAuth', 'needsDemo', 'steps', 'assertions', 'relatedFiles', 'prContext'],
        additionalProperties: false
      }
    },
    reasoning: { type: 'string' }
  },
  required: ['scenarios', 'reasoning'],
  additionalProperties: false
}

async function generateTestScenarios(
  diff: string,
  changedFiles: string[],
  prContext: { title: string; body: string }
): Promise<{ scenarios: TestScenario[]; reasoning: string }> {
  // Get the model from env
  const model = process.env.OPENROUTER_FAST_MODEL
  if (!model) {
    throw new Error('OPENROUTER_FAST_MODEL environment variable is required')
  }

  // Prepare context
  const relevantFiles = changedFiles.filter(f =>
    f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.css')
  ).slice(0, 20) // Limit to 20 files

  // Truncate diff if too large
  const maxDiffLength = 50000
  const truncatedDiff = diff.length > maxDiffLength
    ? diff.slice(0, maxDiffLength) + '\n\n... (diff truncated)'
    : diff

  const messages = [
    {
      role: 'system',
      content: TEST_GENERATION_PROMPT
    },
    {
      role: 'user',
      content: `## PR Title
${prContext.title}

## PR Description
${prContext.body || '(No description provided)'}

## Changed Files
${relevantFiles.join('\n')}

## Diff
\`\`\`diff
${truncatedDiff}
\`\`\`

Generate test scenarios for this PR. Focus on testing the actual changes, especially any new UI interactions, modals, click handlers, or demo mode changes.`
    }
  ]

  const response = await callOpenRouter(model, messages, {
    schema: TEST_SCHEMA,
    schemaName: 'pr_test_scenarios',
    maxTokens: 4000,
    temperature: 0.2 // Slight creativity for diverse test scenarios
  })

  try {
    const result = JSON.parse(response)
    return {
      scenarios: result.scenarios || [],
      reasoning: result.reasoning || 'No reasoning provided'
    }
  } catch {
    // Fallback parsing
    const parsed = parseJsonFromResponse(response)
    if (parsed && Array.isArray(parsed.scenarios)) {
      return {
        scenarios: parsed.scenarios,
        reasoning: parsed.reasoning || 'Parsed from fallback'
      }
    }
    return { scenarios: [], reasoning: 'Failed to parse AI response' }
  }
}

// ============================================
// Output Generation
// ============================================

function saveTestScenarios(scenarios: TestScenario[], prContext: { title: string; body: string }): string {
  const outputDir = 'tests/e2e/generated'
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const output: GeneratedTests = {
    prTitle: prContext.title,
    prDescription: prContext.body,
    generatedAt: new Date().toISOString(),
    scenarios
  }

  const outputPath = join(outputDir, 'pr-scenarios.json')
  writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(`📄 Saved: ${outputPath}`)

  return outputPath
}

// ============================================
// Main
// ============================================

async function main() {
  const startTime = Date.now()
  const args = process.argv.slice(2)

  console.log('🤖 AI PR Test Generator\n')

  // Check for API key
  try {
    getOpenRouterKey()
  } catch {
    console.log('⚠️ OPENROUTER_API_KEY not set - skipping test generation')
    const skippedOutput: ReviewerOutput = {
      reviewer: 'e2e-tests',
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'PR test generation skipped - no API key.'
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0)
  }

  // Get base branch
  let baseBranch = 'origin/main'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
      baseBranch = args[i + 1]
      i++
    }
  }

  console.log(`📊 Analyzing changes against: ${baseBranch}`)

  // Get PR context
  const prContext = getPRContext()
  console.log(`📝 PR: ${prContext.title}`)

  // Get changed files
  const changedFiles = getChangedFiles(baseBranch)
  console.log(`📁 Changed files: ${changedFiles.length}`)

  if (changedFiles.length === 0) {
    console.log('⚠️ No changed files found - skipping test generation')
    const skippedOutput: ReviewerOutput = {
      reviewer: 'e2e-tests',
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'No changed files to generate tests for.'
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0)
  }

  // Get diff
  const diff = getGitDiff(baseBranch)
  console.log(`📝 Diff size: ${diff.length} characters`)

  // Generate test scenarios
  console.log('\n🧠 Generating test scenarios with AI...')
  try {
    const { scenarios, reasoning } = await generateTestScenarios(diff, changedFiles, prContext)

    console.log(`\n✅ Generated ${scenarios.length} test scenarios`)
    console.log(`\n📋 Reasoning: ${reasoning}`)

    // List scenarios
    for (const scenario of scenarios) {
      const emoji = scenario.priority === 'critical' ? '🔴' :
                    scenario.priority === 'high' ? '🟠' :
                    scenario.priority === 'medium' ? '🟡' : '🟢'
      console.log(`   ${emoji} [${scenario.priority}] ${scenario.name}`)
      console.log(`      Page: ${scenario.page}`)
      console.log(`      Steps: ${scenario.steps.length}, Assertions: ${scenario.assertions.length}`)
    }

    // Save scenarios
    if (scenarios.length > 0) {
      const outputPath = saveTestScenarios(scenarios, prContext)
      console.log(`\n✅ Test scenarios saved to: ${outputPath}`)
      console.log('   Run with: npx playwright test tests/e2e/pr-scenarios.spec.ts')
    } else {
      console.log('\n⚠️ No test scenarios generated')
    }

    // Don't save reviewer output here - let the actual test execution report
    console.log(`\n⏱️ Generation completed in ${Date.now() - startTime}ms`)
    process.exit(0)

  } catch (error) {
    console.error('\n❌ Failed to generate test scenarios:', error)

    // Save error output
    const errorOutput: ReviewerOutput = {
      reviewer: 'e2e-tests',
      model: process.env.OPENROUTER_FAST_MODEL || 'unknown',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'failed',
      verdict: 'ERROR',
      confidence: 0,
      findings: [{
        severity: 'critical',
        category: 'runtime-error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }],
      summary: 'Failed to generate PR-specific test scenarios.'
    }
    saveReviewerOutput(errorOutput)

    process.exit(1)
  }
}

main().catch(console.error)
