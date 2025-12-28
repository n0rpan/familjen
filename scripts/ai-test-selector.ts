#!/usr/bin/env npx tsx
/**
 * AI-Powered Smart Test Selector
 *
 * Analyzes PR changes and intelligently decides which tests to run.
 * Uses a fast LLM model for quick decisions at the start of CI.
 *
 * Key principles:
 * - Conservative: When in doubt, run the test (one extra check > one missed bug)
 * - Incremental: Skip tests if files haven't changed since last green run
 * - Context-aware: Understand semantic impact, not just file patterns
 *
 * Usage:
 *   npx tsx scripts/ai-test-selector.ts [--base <branch>]
 *
 * Environment:
 *   OPENROUTER_API_KEY - Required
 *   OPENROUTER_FAST_MODEL - Required (e.g., google/gemini-2.0-flash-001)
 *   GITHUB_PR_NUMBER - PR number
 *   GITHUB_BASE_REF - Base branch
 *
 * Output:
 *   ci-state/test-selection.json - Decisions for CI jobs to consume
 */

import { execSync } from 'child_process'
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  loadPRState,
  createPRState,
  savePRState,
  recordSelectorDecision,
  canSkipTest,
  getRelevantFiles,
  hasRelevantChanges,
  getCurrentCommitSha,
  getPRChangedFiles,
  type TestType,
  type TestDecision,
  type PRState,
} from './lib/pr-state'
import { quickImpactCheck, categorizeChanges, CORE_FILES } from './lib/dependency-graph'
import { getOpenRouterKey } from './ai-config'

// ============================================
// Configuration
// ============================================

const FAST_MODEL = process.env.OPENROUTER_FAST_MODEL
const API_KEY = process.env.OPENROUTER_API_KEY
const STATE_DIR = 'ci-state'
const OUTPUT_FILE = join(STATE_DIR, 'test-selection.json')

// Timeout for selector (should be fast - 30 seconds)
const SELECTOR_TIMEOUT_MS = 30_000

// ============================================
// Types
// ============================================

interface TestSelectionOutput {
  // Metadata
  commitSha: string
  prNumber: number | null
  baseBranch: string
  timestamp: string
  model: string

  // Decisions
  decisions: TestDecisionOutput[]

  // Summary for logging
  summary: {
    totalTests: number
    testsToRun: number
    testsToSkip: number
    estimatedSavingsMinutes: number
  }

  // Reasoning from LLM
  reasoning: string

  // Files analyzed
  changedFiles: string[]
  categories: ReturnType<typeof categorizeChanges>
}

interface TestDecisionOutput extends TestDecision {
  // GitHub Actions output format
  ghOutput: string
}

// Estimated durations for time savings calculation
const TEST_DURATIONS_MINUTES: Record<TestType, number> = {
  lint: 2,
  typecheck: 3,
  'unit-tests': 5,
  'migration-review': 2,
  'code-review': 5,
  'visual-validation': 10,
  'e2e-tests': 10,
  'api-tests': 5,
}

// ============================================
// Git Utilities
// ============================================

function ensureGitHistory(baseBranch: string): void {
  // Strip 'origin/' prefix if present
  const branch = baseBranch.replace(/^origin\//, '')

  try {
    try {
      execSync(`git fetch --unshallow origin ${branch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    } catch {
      execSync(`git fetch origin ${branch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    }
  } catch (error) {
    console.warn(`⚠️ Could not fetch ${branch}: ${error}`)
  }
}

function getChangedFiles(baseBranch: string): string[] {
  return getPRChangedFiles(baseBranch)
}

function getDeltaSinceLastRun(state: PRState | null): string[] {
  if (!state || state.runs.length === 0) {
    return [] // No previous runs, can't compute delta
  }

  const lastRun = state.runs[state.runs.length - 1]
  try {
    const output = execSync(`git diff --name-only ${lastRun.commitSha}...HEAD`, {
      encoding: 'utf-8',
    })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

// ============================================
// LLM-based Selection
// ============================================

interface LLMDecision {
  test: TestType
  run: boolean
  scope?: string[]
  reason: string
  confidence: number
}

interface LLMResponse {
  decisions: LLMDecision[]
  reasoning: string
}

async function callLLMForDecision(
  changedFiles: string[],
  categories: ReturnType<typeof categorizeChanges>,
  prState: PRState | null,
  deltaFiles: string[]
): Promise<LLMResponse> {
  if (!API_KEY || !FAST_MODEL) {
    throw new Error('OPENROUTER_API_KEY and OPENROUTER_FAST_MODEL are required')
  }

  // Build context about previous runs
  let previousRunsContext = ''
  if (prState && prState.runs.length > 0) {
    const lastDecision = prState.selectorDecisions[prState.selectorDecisions.length - 1]
    if (lastDecision) {
      previousRunsContext = `
## Previous Test Runs in This PR

Last selector decision at ${lastDecision.timestamp}:
${lastDecision.decisions.map(d => `- ${d.testType}: ${d.enabled ? 'RUN' : 'SKIP'} (${d.reason})`).join('\n')}

Files changed since last run: ${deltaFiles.length > 0 ? deltaFiles.join(', ') : 'None'}
`
    }
  }

  const systemPrompt = `You are a smart CI test selector for Familjen, a Norwegian family planning app.

Your job is to decide which tests need to run based on the files changed in a PR.

## CRITICAL: Conservative Approach
- When in doubt, RUN the test (run: true)
- It's better to run one extra test than miss a bug
- Only skip tests when you're CERTAIN they're not needed

## Test Types and When to Run

| Test | Run When | Skip When |
|------|----------|-----------|
| lint | Always | Never (always run) |
| typecheck | Always | Never (always run) |
| unit-tests | Any .ts/.tsx changes | Only docs/config changes |
| migration-review | supabase/migrations/* changes | No migration changes |
| code-review | Any code changes | Only docs changes |
| visual-validation | Component/page/style changes | Only backend/API changes |
| e2e-tests | User-facing code changes | Only backend-only changes |
| api-tests | API route or integration changes | Only frontend-only changes |

## Core Files (always run full suite if changed)
${[...CORE_FILES].join(', ')}

## Output Format

Respond with valid JSON only:
{
  "decisions": [
    {
      "test": "lint",
      "run": true,
      "reason": "Always run lint checks",
      "confidence": 100
    },
    ...
  ],
  "reasoning": "Brief explanation of overall decision logic"
}

Important:
- Include ALL test types in decisions
- Set "run: true" when uncertain (conservative)
- Scope can specify specific files/pages to test (optional optimization)`

  const userPrompt = `## PR Changes

### Categories
- Migrations: ${categories.migrations.length} files
- Components: ${categories.components.length} files
- API: ${categories.api.length} files
- Lib: ${categories.lib.length} files
- Tests: ${categories.tests.length} files
- Config: ${categories.config.length} files
- Docs: ${categories.docs.length} files
- Other: ${categories.other.length} files

### Changed Files (${changedFiles.length} total)
${changedFiles.slice(0, 50).join('\n')}
${changedFiles.length > 50 ? `\n... and ${changedFiles.length - 50} more files` : ''}
${previousRunsContext}

Decide which tests to run. Remember: when in doubt, run the test.`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SELECTOR_TIMEOUT_MS)

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: FAST_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    try {
      return JSON.parse(content) as LLMResponse
    } catch {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as LLMResponse
      }
      throw new Error('Failed to parse LLM response as JSON')
    }
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
}

// ============================================
// Fallback Heuristic Selection
// ============================================

function heuristicSelection(
  changedFiles: string[],
  categories: ReturnType<typeof categorizeChanges>
): LLMResponse {
  console.log('⚠️ Using heuristic fallback for test selection')

  const impact = quickImpactCheck(changedFiles)
  const decisions: LLMDecision[] = []

  // Calculate what was changed
  const hasCodeChanges = categories.components.length > 0 ||
    categories.pages.length > 0 ||
    categories.api.length > 0 ||
    categories.lib.length > 0 ||
    categories.hooks.length > 0

  const hasUiChanges = categories.components.length > 0 ||
    categories.pages.length > 0 ||
    categories.hooks.length > 0

  const onlyDocsOrScripts = changedFiles.every(f =>
    f.endsWith('.md') ||
    f.startsWith('scripts/') ||
    f.startsWith('.github/')
  )

  // Always run lint and typecheck
  decisions.push({
    test: 'lint',
    run: true,
    reason: 'Always run',
    confidence: 100,
  })

  decisions.push({
    test: 'typecheck',
    run: true,
    reason: 'Always run',
    confidence: 100,
  })

  // Unit tests: run unless only docs/scripts/config
  decisions.push({
    test: 'unit-tests',
    run: !onlyDocsOrScripts,
    reason: onlyDocsOrScripts ? 'Only docs/scripts/config changes' : 'Code changes detected',
    confidence: onlyDocsOrScripts ? 90 : 100,
  })

  // Migration review: only if migrations changed
  decisions.push({
    test: 'migration-review',
    run: categories.migrations.length > 0,
    reason: categories.migrations.length > 0 ? 'Migration files changed' : 'No migrations changed',
    confidence: 100,
  })

  // Code review: run unless only docs
  const onlyDocs = categories.docs.length === changedFiles.length
  decisions.push({
    test: 'code-review',
    run: !onlyDocs,
    reason: onlyDocs ? 'Only docs changed' : 'Code changes detected',
    confidence: 95,
  })

  // Visual validation: run if components/pages/styles changed
  decisions.push({
    test: 'visual-validation',
    run: hasUiChanges,
    reason: hasUiChanges ? 'UI components/pages changed' : 'No UI changes',
    confidence: hasUiChanges ? 100 : 85,
  })

  // E2E tests: run if user-facing code changed
  const needsE2E = hasUiChanges || categories.api.length > 0
  decisions.push({
    test: 'e2e-tests',
    run: needsE2E,
    reason: needsE2E ? 'User-facing code changed' : 'No user-facing changes',
    confidence: needsE2E ? 100 : 80,
  })

  // API tests: run if API or lib changed (lib might contain integrations)
  const needsApiTests = categories.api.length > 0 ||
    categories.lib.some(f => f.includes('integrations'))
  decisions.push({
    test: 'api-tests',
    run: needsApiTests,
    reason: needsApiTests ? 'API/integration code changed' : 'No API changes',
    confidence: needsApiTests ? 100 : 85,
  })

  // If core files changed, run everything (conservative approach)
  if (impact.coreFileChanged) {
    for (const decision of decisions) {
      decision.run = true
      decision.reason = 'Core file changed - running all tests'
      decision.confidence = 100
    }
  }

  // Build reasoning
  const parts: string[] = ['Heuristic selection based on file patterns.']
  if (impact.coreFileChanged) parts.push('Core file changed - running full suite.')
  if (onlyDocsOrScripts) parts.push('Only docs/scripts changed.')
  if (categories.migrations.length > 0) parts.push(`${categories.migrations.length} migration(s).`)
  if (hasUiChanges) parts.push('UI changes detected.')

  return {
    decisions,
    reasoning: parts.join(' '),
  }
}

// ============================================
// Main
// ============================================

async function main() {
  const startTime = Date.now()
  console.log('🧠 Smart Test Selector\n')

  // Parse arguments
  const args = process.argv.slice(2)
  const baseIndex = args.indexOf('--base')
  const baseBranch = baseIndex >= 0 ? args[baseIndex + 1] : process.env.GITHUB_BASE_REF || 'main'
  const prNumber = process.env.GITHUB_PR_NUMBER ? parseInt(process.env.GITHUB_PR_NUMBER) : null

  console.log(`📌 Base branch: ${baseBranch}`)
  console.log(`📌 PR number: ${prNumber || 'N/A'}`)

  // Ensure we have git history
  ensureGitHistory(baseBranch)

  // Get changed files
  const changedFiles = getChangedFiles(baseBranch)
  console.log(`\n📁 Changed files: ${changedFiles.length}`)

  if (changedFiles.length === 0) {
    console.log('⚠️ No changed files detected')
    // Still output all tests as enabled (conservative)
    writeDefaultOutput(baseBranch, prNumber)
    return
  }

  // Categorize changes
  const categories = categorizeChanges(changedFiles)
  console.log('\n📊 Categories:')
  console.log(`   Migrations: ${categories.migrations.length}`)
  console.log(`   Components: ${categories.components.length}`)
  console.log(`   Pages: ${categories.pages.length}`)
  console.log(`   API: ${categories.api.length}`)
  console.log(`   Lib: ${categories.lib.length}`)
  console.log(`   Hooks: ${categories.hooks.length}`)
  console.log(`   Tests: ${categories.tests.length}`)
  console.log(`   Scripts: ${categories.scripts.length}`)
  console.log(`   Config: ${categories.config.length}`)
  console.log(`   Docs: ${categories.docs.length}`)

  // Load PR state
  let prState = loadPRState()
  if (!prState && prNumber) {
    prState = createPRState(prNumber, baseBranch, `pr-${prNumber}`)
  }

  // Get delta since last run
  const deltaFiles = getDeltaSinceLastRun(prState)
  if (deltaFiles.length > 0) {
    console.log(`\n📝 Files changed since last CI run: ${deltaFiles.length}`)
  }

  // Get LLM decision (with fallback to heuristics)
  let llmResponse: LLMResponse
  let modelUsed: string

  if (API_KEY && FAST_MODEL) {
    try {
      console.log(`\n🤖 Consulting ${FAST_MODEL}...`)
      llmResponse = await callLLMForDecision(changedFiles, categories, prState, deltaFiles)
      modelUsed = FAST_MODEL
      console.log('   ✓ LLM decision received')
    } catch (error) {
      console.error(`\n❌ LLM call failed: ${error}`)
      console.log('   Falling back to heuristic selection')
      llmResponse = heuristicSelection(changedFiles, categories)
      modelUsed = 'heuristic-fallback'
    }
  } else {
    console.log('\n⚠️ No API key or model configured, using heuristics')
    llmResponse = heuristicSelection(changedFiles, categories)
    modelUsed = 'heuristic-fallback'
  }

  // Apply incremental skip logic (check if files changed since last green)
  const decisions: TestDecisionOutput[] = []
  let testsToRun = 0
  let testsToSkip = 0
  let estimatedSavings = 0

  for (const decision of llmResponse.decisions) {
    let finalDecision = { ...decision }

    // Check if we can skip based on last green run
    if (decision.run && prState) {
      const relevantFiles = getRelevantFiles(decision.test, changedFiles)
      const skipCheck = canSkipTest(prState, decision.test, relevantFiles)

      if (skipCheck.canSkip) {
        // LLM said run, but files haven't changed since last green
        // Only skip if confidence is high
        if (decision.confidence < 90) {
          // Low confidence - run anyway (conservative)
          console.log(
            `   ⚠️ ${decision.test}: Could skip but confidence is low (${decision.confidence}%), running anyway`
          )
        } else {
          finalDecision = {
            ...decision,
            run: false,
            reason: `${decision.reason}. ${skipCheck.reason}`,
          }
          console.log(`   ⏭️ ${decision.test}: Skipping (${skipCheck.reason})`)
        }
      }
    }

    if (finalDecision.run) {
      testsToRun++
    } else {
      testsToSkip++
      estimatedSavings += TEST_DURATIONS_MINUTES[decision.test] || 0
    }

    // Format for GitHub Actions output
    const ghOutput = `run_${decision.test.replace(/-/g, '_')}=${finalDecision.run}`

    decisions.push({
      testType: decision.test,
      enabled: finalDecision.run,
      scope: decision.scope,
      reason: finalDecision.reason,
      overridable: !finalDecision.run, // Skipped tests can be overridden by supervisor
      ghOutput,
    })
  }

  // Build output
  const output: TestSelectionOutput = {
    commitSha: getCurrentCommitSha(),
    prNumber,
    baseBranch,
    timestamp: new Date().toISOString(),
    model: modelUsed,
    decisions,
    summary: {
      totalTests: decisions.length,
      testsToRun,
      testsToSkip,
      estimatedSavingsMinutes: estimatedSavings,
    },
    reasoning: llmResponse.reasoning,
    changedFiles,
    categories,
  }

  // Save output
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2))
  console.log(`\n📄 Saved: ${OUTPUT_FILE}`)

  // Record decision in PR state
  if (prState) {
    recordSelectorDecision(
      prState,
      output.commitSha,
      decisions,
      modelUsed,
      llmResponse.reasoning
    )
    savePRState(prState)
  }

  // Output for GitHub Actions
  const ghOutputFile = process.env.GITHUB_OUTPUT
  if (ghOutputFile) {
    const ghOutputs = decisions.map(d => d.ghOutput).join('\n')
    writeFileSync(ghOutputFile, ghOutputs + '\n', { flag: 'a' })
    console.log('\n📤 GitHub Actions outputs written')
  }

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('📊 SUMMARY')
  console.log('='.repeat(50))
  console.log(`   Tests to run: ${testsToRun}`)
  console.log(`   Tests to skip: ${testsToSkip}`)
  console.log(`   Estimated savings: ~${estimatedSavings} minutes`)
  console.log('')

  for (const decision of decisions) {
    const icon = decision.enabled ? '✅' : '⏭️'
    console.log(`   ${icon} ${decision.testType}: ${decision.enabled ? 'RUN' : 'SKIP'}`)
    console.log(`      ${decision.reason}`)
  }

  console.log('')
  console.log(`🧠 Reasoning: ${llmResponse.reasoning}`)
  console.log(`\n⏱️ Duration: ${Math.round((Date.now() - startTime) / 1000)}s`)
}

/**
 * Write default output (all tests enabled) when no changes detected
 */
function writeDefaultOutput(baseBranch: string, prNumber: number | null): void {
  const allTests: TestType[] = [
    'lint',
    'typecheck',
    'unit-tests',
    'migration-review',
    'code-review',
    'visual-validation',
    'e2e-tests',
    'api-tests',
  ]

  const decisions: TestDecisionOutput[] = allTests.map(test => ({
    testType: test,
    enabled: true,
    reason: 'Default: no changes detected, running all tests',
    overridable: false,
    ghOutput: `run_${test.replace(/-/g, '_')}=true`,
  }))

  const output: TestSelectionOutput = {
    commitSha: getCurrentCommitSha(),
    prNumber,
    baseBranch,
    timestamp: new Date().toISOString(),
    model: 'default',
    decisions,
    summary: {
      totalTests: decisions.length,
      testsToRun: decisions.length,
      testsToSkip: 0,
      estimatedSavingsMinutes: 0,
    },
    reasoning: 'No changes detected, running all tests as default',
    changedFiles: [],
    categories: {
      migrations: [],
      components: [],
      api: [],
      lib: [],
      tests: [],
      config: [],
      docs: [],
      other: [],
    },
  }

  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2))
  console.log(`📄 Saved default output: ${OUTPUT_FILE}`)
}

main().catch(error => {
  console.error('Smart selector failed:', error)
  // On failure, write output with all tests enabled (conservative)
  console.log('⚠️ Writing conservative default (all tests enabled)')
  writeDefaultOutput(process.env.GITHUB_BASE_REF || 'main', null)
  process.exit(0) // Don't fail CI on selector failure - just run all tests
})
