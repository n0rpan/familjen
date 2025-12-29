#!/usr/bin/env npx tsx
/**
 * AI-Powered Smart Test Selector
 *
 * Analyzes PR changes and intelligently decides which tests to run.
 * Uses a fast LLM model for quick decisions at the start of CI.
 *
 * Key principles:
 * - LLM Required: No fallback - if LLM fails, CI fails (blocks PR until fixed)
 * - Conservative: When in doubt, run the test (one extra check > one missed bug)
 * - Incremental: Skip tests if files haven't changed since last green run
 * - Context-aware: Recommend extended checks based on PR content
 * - Cached: Same diff = same decision (saves API calls)
 *
 * Extended Checks (recommended by LLM based on context):
 * - dead-code-analysis: For refactoring PRs
 * - mobile-ux-validation: For mobile-critical component changes
 * - accessibility-audit: For UI changes affecting a11y
 * - performance-check: For changes affecting load times
 * - security-audit: For auth/API changes
 *
 * Usage:
 *   npx tsx scripts/ai-test-selector.ts [--base <branch>] [--dry-run]
 *
 * Flags:
 *   --base <branch>  Base branch for diff (default: main)
 *   --dry-run        Show what would happen without calling LLM
 *
 * Environment:
 *   OPENROUTER_API_KEY - Required (unless --dry-run)
 *   OPENROUTER_FAST_MODEL - Required (unless --dry-run)
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
  getCurrentCommitSha,
  getPRChangedFiles,
  type TestType,
  type TestDecision,
  type PRState,
} from './lib/pr-state'
import { quickImpactCheck, categorizeChanges, CORE_FILES } from './lib/dependency-graph'
import {
  recordLLMUsage,
  hashDiff,
  getCachedDecision,
  cacheDecision,
  logAuditEntry,
  formatCost,
  calculateCost,
} from './lib/llm-utils'

// ============================================
// Configuration
// ============================================

const FAST_MODEL = process.env.OPENROUTER_FAST_MODEL
const API_KEY = process.env.OPENROUTER_API_KEY
const STATE_DIR = 'ci-state'
const OUTPUT_FILE = join(STATE_DIR, 'test-selection.json')

// Timeout for selector (30 seconds - should be fast)
const SELECTOR_TIMEOUT_MS = 30_000

// Minimum confidence to skip a test (conservative: require high confidence to skip)
// Lower = more aggressive skipping, Higher = more conservative (run more tests)
const MIN_SKIP_CONFIDENCE = 90

// ============================================
// Types
// ============================================

// Extended check types that LLM can recommend
type ExtendedCheckType =
  | 'dead-code-analysis'
  | 'mobile-ux-validation'
  | 'accessibility-audit'
  | 'performance-check'
  | 'security-audit'
  | 'bundle-size-check'
  | 'i18n-completeness'

interface ExtendedCheck {
  type: ExtendedCheckType
  reason: string
  priority: 'high' | 'medium' | 'low'
  scope?: string[] // Specific files/components to check
}

interface TestSelectionOutput {
  // Metadata
  commitSha: string
  prNumber: number | null
  baseBranch: string
  timestamp: string
  model: string

  // Core test decisions
  decisions: TestDecisionOutput[]

  // Extended checks recommended by LLM
  extendedChecks: ExtendedCheck[]

  // Summary for logging
  summary: {
    totalTests: number
    testsToRun: number
    testsToSkip: number
    extendedChecksCount: number
    estimatedSavingsMinutes: number
  }

  // Reasoning from LLM
  reasoning: string

  // Files analyzed
  changedFiles: string[]
  categories: ReturnType<typeof categorizeChanges>
}

interface TestDecisionOutput extends TestDecision {
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
    return []
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
  extendedChecks: ExtendedCheck[]
  reasoning: string
}

interface LLMCallResult {
  response: LLMResponse
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

async function callLLMForDecision(
  changedFiles: string[],
  categories: ReturnType<typeof categorizeChanges>,
  prState: PRState | null,
  deltaFiles: string[]
): Promise<LLMCallResult> {
  if (!API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required - CI cannot proceed without LLM')
  }
  if (!FAST_MODEL) {
    throw new Error('OPENROUTER_FAST_MODEL is required - CI cannot proceed without LLM')
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

  const systemPrompt = `You are a smart CI test selector for Familjen, a Norwegian family planning app used by busy parents.

Your job is to:
1. Decide which core tests need to run based on the PR changes
2. Recommend extended checks based on the PR context (refactoring, mobile changes, etc.)

## CRITICAL: Conservative Approach
- When in doubt, RUN the test (run: true)
- It's better to run one extra test than miss a bug
- Only skip tests when you're CERTAIN they're not needed
- Parents depend on this app - quality is paramount

## Core Test Types

| Test | Run When | Skip When |
|------|----------|-----------|
| lint | Always | Never |
| typecheck | Always | Never |
| unit-tests | Any .ts/.tsx changes | Only docs/config changes |
| migration-review | supabase/migrations/* changes | No migration changes |
| code-review | Any code changes | Only docs changes |
| visual-validation | Component/page/style changes | Only backend/API changes |
| e2e-tests | User-facing code changes | Only backend-only changes |
| api-tests | API route or integration changes | Only frontend-only changes |

## Extended Checks (Recommend based on context)

| Check | When to Recommend |
|-------|-------------------|
| dead-code-analysis | Refactoring PRs, file deletions, major restructuring |
| mobile-ux-validation | Changes to touch handlers, mobile components, responsive styles |
| accessibility-audit | UI changes affecting navigation, colors, focus states |
| performance-check | Changes to data fetching, large components, images |
| security-audit | Auth changes, API routes, credential handling |
| bundle-size-check | Adding new dependencies, large component additions |
| i18n-completeness | Changes to translation files, new UI text |

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
    }
  ],
  "extendedChecks": [
    {
      "type": "dead-code-analysis",
      "reason": "PR removes 5 files, should check for orphaned imports",
      "priority": "high",
      "scope": ["src/components/old/"]
    }
  ],
  "reasoning": "Brief explanation of overall decision logic"
}

Important:
- Include ALL 8 core test types in decisions
- Set "run: true" when uncertain (conservative)
- Recommend extended checks when relevant (empty array if none needed)
- Priority: high (blocking), medium (should run), low (nice to have)`

  const userPrompt = `## PR Changes

### Categories
- Migrations: ${categories.migrations.length} files
- Components: ${categories.components.length} files
- Pages: ${categories.pages.length} files
- API: ${categories.api.length} files
- Lib: ${categories.lib.length} files
- Hooks: ${categories.hooks.length} files
- Tests: ${categories.tests.length} files
- Scripts: ${categories.scripts.length} files
- Config: ${categories.config.length} files
- Docs: ${categories.docs.length} files

### Changed Files (${changedFiles.length} total)
${changedFiles.slice(0, 100).join('\n')}
${changedFiles.length > 100 ? `\n... and ${changedFiles.length - 100} more files` : ''}
${previousRunsContext}

### Quick Impact Analysis
${JSON.stringify(quickImpactCheck(changedFiles), null, 2)}

Decide which tests to run and recommend any extended checks. Remember: when in doubt, run the test.`

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
        max_tokens: 3000,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`LLM API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    // Extract usage stats
    const usage = {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    }

    try {
      const parsed = JSON.parse(content) as LLMResponse
      // Ensure extendedChecks is an array
      if (!Array.isArray(parsed.extendedChecks)) {
        parsed.extendedChecks = []
      }
      return { response: parsed, usage }
    } catch {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as LLMResponse
        if (!Array.isArray(parsed.extendedChecks)) {
          parsed.extendedChecks = []
        }
        return { response: parsed, usage }
      }
      throw new Error('Failed to parse LLM response as JSON')
    }
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
}

/**
 * Write error output for PR comment
 */
function writeErrorOutput(errorMessage: string, baseBranch: string, prNumber: number | null): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }

  const errorOutput = {
    error: true,
    message: errorMessage,
    timestamp: new Date().toISOString(),
    baseBranch,
    prNumber,
    help: {
      possibleCauses: [
        'OpenRouter API is down',
        'Invalid or expired API key',
        'Invalid model name',
        'Rate limited',
      ],
      howToFix: [
        'Check OpenRouter status: https://status.openrouter.ai',
        'Verify OPENROUTER_API_KEY in GitHub Secrets',
        'Verify OPENROUTER_FAST_MODEL in GitHub Secrets',
        'Wait a few minutes and re-run the workflow',
      ],
      localTesting: 'npx tsx scripts/ai-test-selector.ts --dry-run --base main',
    },
  }

  writeFileSync(join(STATE_DIR, 'selector-error.json'), JSON.stringify(errorOutput, null, 2))
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
  const isDryRun = args.includes('--dry-run')

  console.log(`📌 Base branch: ${baseBranch}`)
  console.log(`📌 PR number: ${prNumber || 'N/A'}`)
  if (isDryRun) {
    console.log('📌 Mode: DRY RUN (no LLM calls)')
  }

  // Validate required environment variables (unless dry-run)
  if (!isDryRun) {
    if (!API_KEY) {
      writeErrorOutput('OPENROUTER_API_KEY is required', baseBranch, prNumber)
      console.error('❌ OPENROUTER_API_KEY is required')
      console.error('')
      console.error('   The smart selector requires LLM to make decisions.')
      console.error('')
      console.error('   To fix this:')
      console.error('   1. Go to GitHub repo → Settings → Secrets → Actions')
      console.error('   2. Add OPENROUTER_API_KEY secret')
      console.error('   3. Get key from https://openrouter.ai/keys')
      console.error('')
      console.error('   For local testing, use --dry-run flag:')
      console.error('   npx tsx scripts/ai-test-selector.ts --dry-run --base main')
      process.exit(1)
    }

    if (!FAST_MODEL) {
      writeErrorOutput('OPENROUTER_FAST_MODEL is required', baseBranch, prNumber)
      console.error('❌ OPENROUTER_FAST_MODEL is required')
      console.error('')
      console.error('   The smart selector requires a model to make decisions.')
      console.error('')
      console.error('   To fix this:')
      console.error('   1. Go to GitHub repo → Settings → Secrets → Actions')
      console.error('   2. Add OPENROUTER_FAST_MODEL secret')
      console.error('   3. Recommended: google/gemini-2.0-flash-001')
      process.exit(1)
    }
  }

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

  // Get the diff for caching
  let diff = ''
  try {
    diff = execSync(`git diff origin/${baseBranch.replace(/^origin\//, '')}...HEAD`, {
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024,
    })
  } catch {
    diff = changedFiles.join('\n') // Fallback to file list
  }
  const diffHash = hashDiff(diff)
  console.log(`📝 Diff hash: ${diffHash}`)

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

  // DRY RUN: Show what would happen and exit
  if (isDryRun) {
    console.log('\n' + '='.repeat(50))
    console.log('🏃 DRY RUN - What would happen:')
    console.log('='.repeat(50))

    const impact = quickImpactCheck(changedFiles)
    const isDocsOnly = categories.docs.length > 0 &&
      categories.components.length === 0 &&
      categories.pages.length === 0 &&
      categories.api.length === 0 &&
      categories.lib.length === 0

    console.log('\n📋 Impact Analysis:')
    console.log(`   Core files touched: ${impact.coreFileChanged}`)
    console.log(`   Has migrations: ${impact.affectsMigrations}`)
    console.log(`   Has UI changes: ${impact.affectsComponents}`)
    console.log(`   Has API changes: ${impact.affectsApi}`)
    console.log(`   Is docs only: ${isDocsOnly}`)

    console.log('\n🔮 Predicted decisions (heuristic):')
    console.log('   lint: RUN (always)')
    console.log('   typecheck: RUN (always)')
    console.log(`   unit-tests: ${isDocsOnly ? 'SKIP' : 'RUN'}`)
    console.log(`   migration-review: ${impact.affectsMigrations ? 'RUN' : 'SKIP'}`)
    console.log('   code-review: RUN (always for PRs)')
    console.log(`   visual-validation: ${impact.affectsComponents ? 'RUN' : 'SKIP'}`)
    console.log(`   e2e-tests: ${isDocsOnly ? 'SKIP' : 'RUN'}`)
    console.log(`   api-tests: ${impact.affectsApi ? 'RUN' : 'SKIP'}`)

    console.log('\n💡 Extended checks that might be recommended:')
    if (categories.components.length > 3) {
      console.log('   - accessibility-audit (many component changes)')
    }
    if (changedFiles.some(f => f.includes('package.json'))) {
      console.log('   - bundle-size-check (package.json changed)')
    }
    if (categories.lib.length > 5) {
      console.log('   - dead-code-analysis (many lib changes)')
    }

    console.log('\n📝 To run with LLM, remove --dry-run flag')
    console.log('   (requires OPENROUTER_API_KEY and OPENROUTER_FAST_MODEL)')
    return
  }

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

  // Check cache first
  const cached = getCachedDecision(diffHash)
  let llmResponse: LLMResponse
  let fromCache = false

  if (cached) {
    console.log(`\n📦 Using cached decision (hash: ${diffHash})`)
    console.log(`   Cached at: ${cached.timestamp}`)
    console.log(`   Model: ${cached.model}`)
    llmResponse = {
      decisions: cached.decisions as LLMDecision[],
      extendedChecks: cached.extendedChecks as ExtendedCheck[],
      reasoning: cached.reasoning,
    }
    fromCache = true
  } else {
    // Get LLM decision - NO FALLBACK, will fail if LLM fails
    console.log(`\n🤖 Consulting ${FAST_MODEL}...`)

    const llmStartTime = Date.now()
    try {
      const result = await callLLMForDecision(changedFiles, categories, prState, deltaFiles)
      llmResponse = result.response
      const llmDuration = Date.now() - llmStartTime

      console.log('   ✓ LLM decision received')

      // Record cost
      const cost = calculateCost(FAST_MODEL!, result.usage.inputTokens, result.usage.outputTokens)
      console.log(`   💰 Cost: ${formatCost(cost)} (${result.usage.inputTokens} in, ${result.usage.outputTokens} out)`)

      recordLLMUsage({
        model: FAST_MODEL!,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostUSD: cost,
        timestamp: new Date().toISOString(),
        operation: 'selector',
        prNumber: prNumber || undefined,
        commitSha: getCurrentCommitSha(),
        durationMs: llmDuration,
      })

      // Cache the decision
      cacheDecision(
        diffHash,
        llmResponse.decisions,
        llmResponse.extendedChecks,
        llmResponse.reasoning,
        FAST_MODEL!
      )
      console.log(`   📦 Decision cached (hash: ${diffHash})`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      writeErrorOutput(errorMessage, baseBranch, prNumber)

      console.error(`\n❌ LLM call failed: ${errorMessage}`)
      console.error('')
      console.error('   CI cannot proceed without LLM decision.')
      console.error('')
      console.error('   Possible causes:')
      console.error('   1. OpenRouter API is down → Check https://status.openrouter.ai')
      console.error('   2. Invalid API key → Verify OPENROUTER_API_KEY secret')
      console.error('   3. Invalid model → Verify OPENROUTER_FAST_MODEL secret')
      console.error('   4. Rate limited → Wait and retry')
      console.error('')
      console.error('   To retry: Re-run the workflow')
      process.exit(1)
    }
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
        // Only skip if confidence is high enough
        if (decision.confidence < MIN_SKIP_CONFIDENCE) {
          console.log(
            `   ⚠️ ${decision.test}: Could skip but confidence is low (${decision.confidence}% < ${MIN_SKIP_CONFIDENCE}%), running anyway`
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

    const ghOutput = `run_${decision.test.replace(/-/g, '_')}=${finalDecision.run}`

    decisions.push({
      testType: decision.test,
      enabled: finalDecision.run,
      scope: decision.scope,
      reason: finalDecision.reason,
      overridable: !finalDecision.run,
      ghOutput,
    })
  }

  // Process extended checks
  const extendedChecks = llmResponse.extendedChecks || []
  if (extendedChecks.length > 0) {
    console.log(`\n🔍 Extended checks recommended: ${extendedChecks.length}`)
    for (const check of extendedChecks) {
      console.log(`   ${check.priority === 'high' ? '🔴' : check.priority === 'medium' ? '🟡' : '🟢'} ${check.type}: ${check.reason}`)
    }
  }

  // Build output
  const output: TestSelectionOutput = {
    commitSha: getCurrentCommitSha(),
    prNumber,
    baseBranch,
    timestamp: new Date().toISOString(),
    model: FAST_MODEL,
    decisions,
    extendedChecks,
    summary: {
      totalTests: decisions.length,
      testsToRun,
      testsToSkip,
      extendedChecksCount: extendedChecks.length,
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
      FAST_MODEL,
      llmResponse.reasoning
    )
    savePRState(prState)
  }

  // Output for GitHub Actions
  const ghOutputFile = process.env.GITHUB_OUTPUT
  if (ghOutputFile) {
    const ghOutputs = [
      ...decisions.map(d => d.ghOutput),
      `extended_checks=${JSON.stringify(extendedChecks.map(c => c.type))}`,
      `has_high_priority_checks=${extendedChecks.some(c => c.priority === 'high')}`,
    ]
    writeFileSync(ghOutputFile, ghOutputs.join('\n') + '\n', { flag: 'a' })
    console.log('\n📤 GitHub Actions outputs written')
  }

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('📊 SUMMARY')
  console.log('='.repeat(50))
  console.log(`   Tests to run: ${testsToRun}`)
  console.log(`   Tests to skip: ${testsToSkip}`)
  console.log(`   Extended checks: ${extendedChecks.length}`)
  console.log(`   Estimated savings: ~${estimatedSavings} minutes`)
  console.log('')

  for (const decision of decisions) {
    const icon = decision.enabled ? '✅' : '⏭️'
    console.log(`   ${icon} ${decision.testType}: ${decision.enabled ? 'RUN' : 'SKIP'}`)
    console.log(`      ${decision.reason}`)
  }

  if (extendedChecks.length > 0) {
    console.log('\n   📋 Extended Checks:')
    for (const check of extendedChecks) {
      console.log(`      ${check.type} (${check.priority}): ${check.reason}`)
    }
  }

  console.log('')
  console.log(`🧠 Reasoning: ${llmResponse.reasoning}`)

  // Log audit trail
  logAuditEntry({
    timestamp: new Date().toISOString(),
    type: 'selector',
    prNumber: prNumber || undefined,
    commitSha: getCurrentCommitSha(),
    model: fromCache ? `${FAST_MODEL} (cached)` : FAST_MODEL!,
    decision: `${testsToRun} run, ${testsToSkip} skip, ${extendedChecks.length} extended`,
    reasoning: llmResponse.reasoning,
    metadata: {
      fromCache,
      testsToRun,
      testsToSkip,
      extendedChecks: extendedChecks.map(c => c.type),
      changedFilesCount: changedFiles.length,
    },
  })

  console.log(`\n⏱️ Duration: ${Math.round((Date.now() - startTime) / 1000)}s`)
  if (fromCache) {
    console.log('   📦 (from cache - no API cost)')
  }
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
    extendedChecks: [],
    summary: {
      totalTests: decisions.length,
      testsToRun: decisions.length,
      testsToSkip: 0,
      extendedChecksCount: 0,
      estimatedSavingsMinutes: 0,
    },
    reasoning: 'No changes detected, running all tests as default',
    changedFiles: [],
    categories: {
      migrations: [],
      components: [],
      pages: [],
      api: [],
      lib: [],
      hooks: [],
      tests: [],
      config: [],
      docs: [],
      scripts: [],
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
  console.error('❌ Smart selector failed:', error)
  console.error('   CI cannot proceed without LLM decision.')
  process.exit(1)
})
