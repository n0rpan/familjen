#!/usr/bin/env npx tsx
/**
 * Model Benchmark for Final Verdict Role
 *
 * Tests candidate models against realistic CI scenarios to evaluate:
 * - Judgment quality (does it PASS when it should? BLOCK when it should?)
 * - Response speed
 * - Cost per call
 * - False positive resistance
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/benchmark-verdict-models.ts
 *   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/benchmark-verdict-models.ts --models "openai/gpt-5.2,google/gemini-3-flash-preview"
 */

const API_KEY = process.env.OPENROUTER_API_KEY
if (!API_KEY) {
  console.error('❌ OPENROUTER_API_KEY is required')
  process.exit(1)
}

// Parse --models flag
const modelsArg = process.argv.find(a => a.startsWith('--models='))?.split('=')[1]
  || (process.argv.indexOf('--models') >= 0 ? process.argv[process.argv.indexOf('--models') + 1] : null)

const DEFAULT_MODELS = [
  'google/gemini-3-flash-preview',
  'google/gemini-2.5-flash-lite',
  'openai/gpt-5.2',
  'minimax/minimax-m2.5',
  'moonshotai/kimi-k2.5',
  'z-ai/glm-5',
  'deepseek/deepseek-chat-v3-0324',
  'x-ai/grok-4-fast',
]

const MODELS = modelsArg ? modelsArg.split(',').map(m => m.trim()) : DEFAULT_MODELS

// ============================================
// Test Scenarios
// ============================================

interface Scenario {
  name: string
  expectedVerdict: 'PASS' | 'BLOCK'
  description: string
  prompt: string
}

const SCENARIOS: Scenario[] = [
  {
    name: 'Clear PASS - only suggestions',
    expectedVerdict: 'PASS',
    description: 'Code review flagged missing docs as critical. Should PASS because docs are never blocking.',
    prompt: `You are the FINAL decision maker for a PR to Familjen, a Norwegian family planning app.

YOUR VERDICT DETERMINES THE CI STATUS. If you say BLOCK, the PR cannot be merged. If you say PASS, the PR can merge.

## The #1 Rule: Only BLOCK for Real Problems

**BLOCK means:** "This code will break things, lose data, or compromise security if merged."
**PASS means:** "This code is good enough to ship. Any remaining items are suggestions for follow-up."

## What is NOT a Blocking Issue
- Missing documentation / CLAUDE.md updates
- Missing unit tests (unless code is clearly broken)
- Style preferences, refactoring ideas
- PR description quality

## What IS a Blocking Issue
- Security vulnerabilities, data corruption, runtime crashes, core functionality broken

## PR Information
Title: Add freshness indicator to feed page
Files: src/components/feed/FeedPageContent.tsx, src/components/FreshnessIndicator.tsx, translations

## Reviewer Findings

### code-review (FAIL, 72%)
- [critical] Missing CLAUDE.md documentation for FreshnessIndicator on feed page
- [info] Consider adding unit test for timer cleanup
- [info] Translation key could be more specific

### security-review (WARN, 85%)
- [info] Date.now() usage is fine, no user input involved

### unit-tests (PASS, 100%)
- All 220 tests passed

---
Analyze and decide. End with FINAL VERDICT: PASS or FINAL VERDICT: BLOCK`,
  },
  {
    name: 'Clear PASS - false positive from reviewer',
    expectedVerdict: 'PASS',
    description: 'Reviewer says supabase client could be null. This is a known false positive.',
    prompt: `You are the FINAL decision maker for a PR to Familjen, a Norwegian family planning app.

YOUR VERDICT DETERMINES THE CI STATUS.

## The #1 Rule: Only BLOCK for Real Problems
BLOCK = code will break things. PASS = good enough to ship.

## Reviewer False Positives to IGNORE
- "Supabase client could be null" — createClient() NEVER returns null in this codebase
- "Missing documentation" flagged as critical — documentation is never critical

## PR Information
Title: Refactor meal selector to shared hook pattern
Files: src/hooks/data/useMeals.ts, src/components/week/MealSelector.tsx

## Reviewer Findings

### code-review (FAIL, 68%)
- [critical] CLAUDE.md not updated for new useMeals hook
- [critical] useMeals hook doesn't handle case where supabase client is null
- [info] Consider extracting meal type constants

### security-review (PASS, 90%)
- No security issues. RLS protections maintained.

### unit-tests (PASS, 100%)
- All 220 tests passed

---
End with FINAL VERDICT: PASS or FINAL VERDICT: BLOCK`,
  },
  {
    name: 'Clear BLOCK - hardcoded secret',
    expectedVerdict: 'BLOCK',
    description: 'Actual security issue - API key hardcoded in source.',
    prompt: `You are the FINAL decision maker for a PR to Familjen, a Norwegian family planning app.

YOUR VERDICT DETERMINES THE CI STATUS.

## The #1 Rule: Only BLOCK for Real Problems
BLOCK = code will break things, lose data, or compromise security.

## What IS a Blocking Issue
- Security vulnerabilities: hardcoded secrets, auth bypass, injection

## PR Information
Title: Add weather widget to home page
Files: src/components/home/WeatherWidget.tsx, src/lib/weather.ts

## Reviewer Findings

### code-review (FAIL, 95%)
- [critical] Hardcoded OpenWeatherMap API key in src/lib/weather.ts:12 — should use environment variable
- [info] Consider caching weather responses

### security-review (FAIL, 98%)
- [critical] API key "sk-weather-abc123" hardcoded in source code. Must use process.env

### unit-tests (PASS, 100%)
- All tests passed

---
End with FINAL VERDICT: PASS or FINAL VERDICT: BLOCK`,
  },
  {
    name: 'Borderline - one model blocks, one approves',
    expectedVerdict: 'PASS',
    description: 'Mixed signals from reviewers. Issues are valid suggestions but not actual bugs.',
    prompt: `You are the FINAL decision maker for a PR to Familjen, a Norwegian family planning app.

YOUR VERDICT DETERMINES THE CI STATUS.

## The #1 Rule: Only BLOCK for Real Problems
Ask yourself: "Will users actually be harmed by this code?" If no, PASS with suggestions.

## What is NOT a Blocking Issue
- Missing docs, missing tests, style preferences, "could be improved" observations

## PR Information
Title: Add pull-to-refresh on recipe page
Files: src/app/oppskrifter/page.tsx, src/components/recipes/RecipesPageContent.tsx

## Reviewer Findings

### code-review (FAIL, 60%)
- [critical] No loading state shown during refresh (poor UX but works)
- [warning] Should debounce rapid pull-to-refresh gestures
- [info] Consider adding haptic feedback

### security-review (PASS, 95%)
- No issues

### unit-tests (PASS, 100%)
- All tests passed

### pr-quality (WARN, 70%)
- PR description could be more detailed

---
End with FINAL VERDICT: PASS or FINAL VERDICT: BLOCK`,
  },
]

// ============================================
// API Call
// ============================================

interface TestResult {
  model: string
  scenario: string
  verdict: string
  correct: boolean
  timeMs: number
  tokens: { input: number; output: number }
  cost: number | null
  responsePreview: string
}

async function testModel(model: string, scenario: Scenario): Promise<TestResult> {
  const start = Date.now()

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/n0rpan/familjen',
        'X-Title': 'Familjen Model Benchmark',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: scenario.prompt }],
        temperature: 0,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(60_000),
    })

    const timeMs = Date.now() - start

    if (!response.ok) {
      const error = await response.text()
      return {
        model, scenario: scenario.name, verdict: `ERROR: ${response.status}`,
        correct: false, timeMs, tokens: { input: 0, output: 0 }, cost: null,
        responsePreview: error.slice(0, 200),
      }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    const usage = data.usage || {}

    const verdictMatch = content.match(/FINAL VERDICT:\s*(PASS|BLOCK)/i)
    const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'NO VERDICT'
    const correct = verdict === scenario.expectedVerdict

    return {
      model,
      scenario: scenario.name,
      verdict,
      correct,
      timeMs,
      tokens: { input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0 },
      cost: usage.cost ?? usage.total_cost ?? null,
      responsePreview: content.slice(0, 300),
    }
  } catch (error) {
    return {
      model, scenario: scenario.name,
      verdict: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
      correct: false, timeMs: Date.now() - start,
      tokens: { input: 0, output: 0 }, cost: null, responsePreview: '',
    }
  }
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('🏋️ Model Benchmark for Final Verdict Role')
  console.log(`Testing ${MODELS.length} models × ${SCENARIOS.length} scenarios = ${MODELS.length * SCENARIOS.length} calls\n`)

  const results: TestResult[] = []

  for (const scenario of SCENARIOS) {
    console.log(`\n📋 Scenario: ${scenario.name}`)
    console.log(`   Expected: ${scenario.expectedVerdict}`)
    console.log(`   ${scenario.description}\n`)

    // Run all models in parallel for this scenario
    const promises = MODELS.map(model => testModel(model, scenario))
    const scenarioResults = await Promise.all(promises)

    for (const result of scenarioResults) {
      results.push(result)
      const icon = result.correct ? '✅' : '❌'
      const costStr = result.cost !== null ? `$${result.cost.toFixed(4)}` : 'N/A'
      const modelShort = result.model.split('/').pop() || result.model
      console.log(`   ${icon} ${modelShort.padEnd(30)} | ${result.verdict.padEnd(10)} | ${result.timeMs}ms | ${costStr}`)
    }
  }

  // ============================================
  // Summary
  // ============================================

  console.log('\n' + '='.repeat(90))
  console.log('SUMMARY')
  console.log('='.repeat(90))

  // Per-model accuracy
  const modelStats = new Map<string, { correct: number; total: number; totalMs: number; totalCost: number }>()

  for (const r of results) {
    const stats = modelStats.get(r.model) || { correct: 0, total: 0, totalMs: 0, totalCost: 0 }
    stats.total++
    if (r.correct) stats.correct++
    stats.totalMs += r.timeMs
    if (r.cost) stats.totalCost += r.cost
    modelStats.set(r.model, stats)
  }

  console.log('\n| Model                              | Accuracy | Avg Time | Total Cost |')
  console.log('|------------------------------------|----------|----------|------------|')

  const sorted = [...modelStats.entries()].sort((a, b) => {
    // Sort by accuracy desc, then cost asc
    const accDiff = (b[1].correct / b[1].total) - (a[1].correct / a[1].total)
    if (accDiff !== 0) return accDiff
    return a[1].totalCost - b[1].totalCost
  })

  for (const [model, stats] of sorted) {
    const accuracy = `${stats.correct}/${stats.total} (${Math.round(stats.correct / stats.total * 100)}%)`
    const avgMs = `${Math.round(stats.totalMs / stats.total)}ms`
    const cost = stats.totalCost > 0 ? `$${stats.totalCost.toFixed(4)}` : 'N/A'
    const modelShort = model.split('/').pop() || model
    console.log(`| ${modelShort.padEnd(34)} | ${accuracy.padEnd(8)} | ${avgMs.padEnd(8)} | ${cost.padEnd(10)} |`)
  }

  // Recommendations
  console.log('\n📋 RECOMMENDATIONS:')
  const bestAccuracy = sorted[0]
  if (bestAccuracy) {
    const [model, stats] = bestAccuracy
    console.log(`   Best accuracy: ${model} (${stats.correct}/${stats.total})`)
  }

  const cheapest = sorted.filter(([, s]) => s.correct === s.total).sort((a, b) => a[1].totalCost - b[1].totalCost)[0]
  if (cheapest) {
    console.log(`   Cheapest with 100%: ${cheapest[0]} ($${cheapest[1].totalCost.toFixed(4)})`)
  }

  const fastest = sorted.filter(([, s]) => s.correct === s.total).sort((a, b) => a[1].totalMs - b[1].totalMs)[0]
  if (fastest) {
    console.log(`   Fastest with 100%: ${fastest[0]} (${Math.round(fastest[1].totalMs / fastest[1].total)}ms avg)`)
  }

  // Failures detail
  const failures = results.filter(r => !r.correct)
  if (failures.length > 0) {
    console.log('\n⚠️ INCORRECT VERDICTS:')
    for (const f of failures) {
      const modelShort = f.model.split('/').pop() || f.model
      console.log(`   ${modelShort} on "${f.scenario}": said ${f.verdict}, expected ${SCENARIOS.find(s => s.name === f.scenario)?.expectedVerdict}`)
      console.log(`   Preview: ${f.responsePreview.slice(0, 150)}...`)
    }
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
