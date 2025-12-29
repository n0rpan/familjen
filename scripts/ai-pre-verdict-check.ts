#!/usr/bin/env npx tsx
/**
 * AI Pre-Verdict Check
 *
 * A fast, cheap LLM pass that runs BEFORE the expensive supervisor.
 * Reviews selector decisions and gathers additional context if needed.
 *
 * Purpose:
 * - Verify selector decisions make sense
 * - Run quick checks that don't need the expensive model
 * - Gather context for the supervisor to review
 * - Reduce supervisor workload (and cost)
 *
 * Usage:
 *   npx tsx scripts/ai-pre-verdict-check.ts
 *
 * Environment:
 *   OPENROUTER_API_KEY - Required
 *   OPENROUTER_FAST_MODEL - Required (cheap/fast model)
 *   VERCEL_PREVIEW_URL - For smoke tests
 *
 * Output:
 *   ci-state/pre-verdict-check.json - Findings for supervisor
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

const FAST_MODEL = process.env.OPENROUTER_FAST_MODEL
const API_KEY = process.env.OPENROUTER_API_KEY
const PREVIEW_URL = process.env.VERCEL_PREVIEW_URL

const STATE_DIR = 'ci-state'
const OUTPUT_FILE = `${STATE_DIR}/pre-verdict-check.json`

interface SelectorDecision {
  testType: string
  enabled: boolean
  reason: string
  confidence?: number
}

interface TestSelection {
  decisions: SelectorDecision[]
  extendedChecks?: Array<{ type: string; priority: string; reason: string }>
  changedFiles?: string[]
  categories?: Record<string, string[]>
  model?: string
  timestamp?: string
}

interface QuickCheckResult {
  check: string
  status: 'pass' | 'fail' | 'warn' | 'skipped'
  message: string
  details?: string
}

interface PreVerdictOutput {
  selectorReview: {
    verified: boolean
    concerns: string[]
    suggestions: string[]
  }
  quickChecks: QuickCheckResult[]
  additionalContext: Record<string, string>
  recommendation: 'proceed' | 'run_more_tests' | 'needs_investigation'
  reasoning: string
  timestamp: string
}

// ============================================
// Quick Checks (no LLM needed)
// ============================================

async function runQuickChecks(selection: TestSelection): Promise<QuickCheckResult[]> {
  const results: QuickCheckResult[] = []
  const changedFiles = selection.changedFiles || []

  // Check 1: TypeScript compilation on changed files
  if (changedFiles.some(f => f.endsWith('.ts') || f.endsWith('.tsx'))) {
    try {
      execSync('npx tsc --noEmit 2>&1', { encoding: 'utf-8', timeout: 30000 })
      results.push({
        check: 'typescript',
        status: 'pass',
        message: 'TypeScript compilation successful'
      })
    } catch (e) {
      const error = e as { stdout?: string }
      const errors = error.stdout?.split('\n').filter(l => l.includes('error TS')) || []
      results.push({
        check: 'typescript',
        status: 'fail',
        message: `TypeScript errors: ${errors.length}`,
        details: errors.slice(0, 5).join('\n')
      })
    }
  }

  // Check 2: Smoke test the preview URL
  if (PREVIEW_URL) {
    try {
      const response = await fetch(PREVIEW_URL, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000)
      })
      if (response.ok) {
        results.push({
          check: 'preview-health',
          status: 'pass',
          message: `Preview URL responding (${response.status})`
        })
      } else {
        results.push({
          check: 'preview-health',
          status: 'warn',
          message: `Preview URL returned ${response.status}`
        })
      }
    } catch (e) {
      results.push({
        check: 'preview-health',
        status: 'fail',
        message: 'Preview URL not responding',
        details: String(e)
      })
    }
  }

  // Check 3: Look for common issues in changed files
  const dangerousPatterns = [
    { pattern: /console\.log\(/g, name: 'console.log', severity: 'warn' as const },
    { pattern: /TODO|FIXME|HACK/g, name: 'TODO/FIXME', severity: 'warn' as const },
    { pattern: /process\.env\.\w+(?!\s*\|\|)/g, name: 'unchecked env var', severity: 'warn' as const },
  ]

  for (const file of changedFiles.slice(0, 20)) {
    if (!existsSync(file)) continue
    if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue

    try {
      const content = readFileSync(file, 'utf-8')
      for (const { pattern, name, severity } of dangerousPatterns) {
        const matches = content.match(pattern)
        if (matches && matches.length > 3) {
          results.push({
            check: `pattern-${name}`,
            status: severity,
            message: `${file}: ${matches.length} occurrences of ${name}`
          })
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Check 4: Verify imports exist (catch hallucinated packages)
  const packageJson = existsSync('package.json')
    ? JSON.parse(readFileSync('package.json', 'utf-8'))
    : { dependencies: {}, devDependencies: {} }
  const allDeps = new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {})
  ])

  for (const file of changedFiles.slice(0, 10)) {
    if (!existsSync(file) || !file.match(/\.(ts|tsx)$/)) continue

    try {
      const content = readFileSync(file, 'utf-8')
      const imports = content.match(/from ['"]([^'"./][^'"]*)['"]/g) || []

      for (const imp of imports) {
        const pkg = imp.match(/from ['"]([^'"]+)['"]/)?.[1]?.split('/')[0]
        if (pkg && !allDeps.has(pkg) && !pkg.startsWith('@types')) {
          // Check if it's a Node.js built-in
          const builtins = ['fs', 'path', 'crypto', 'http', 'https', 'url', 'util', 'stream', 'events', 'child_process', 'os', 'net']
          if (!builtins.includes(pkg)) {
            results.push({
              check: 'import-verification',
              status: 'fail',
              message: `${file}: imports unknown package "${pkg}"`,
              details: 'Package not in package.json - may be hallucinated'
            })
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results
}

// ============================================
// LLM-based Selector Review
// ============================================

async function reviewSelectorDecisions(selection: TestSelection): Promise<{
  verified: boolean
  concerns: string[]
  suggestions: string[]
  reasoning: string
}> {
  if (!FAST_MODEL || !API_KEY) {
    return {
      verified: true,
      concerns: ['LLM not available for review'],
      suggestions: [],
      reasoning: 'Skipped LLM review - no API key or model configured'
    }
  }

  const skippedTests = selection.decisions.filter(d => !d.enabled)
  const runningTests = selection.decisions.filter(d => d.enabled)

  // If nothing was skipped, no need to review
  if (skippedTests.length === 0) {
    return {
      verified: true,
      concerns: [],
      suggestions: [],
      reasoning: 'All tests are running - no review needed'
    }
  }

  const prompt = `You are a CI reviewer checking if test skip decisions are correct.

## Selector Decisions

**Running (${runningTests.length}):**
${runningTests.map(d => `- ${d.testType}: ${d.reason}`).join('\n')}

**Skipped (${skippedTests.length}):**
${skippedTests.map(d => `- ${d.testType}: ${d.reason} (confidence: ${d.confidence || 'unknown'}%)`).join('\n')}

## Changed Files (${selection.changedFiles?.length || 0})
${selection.changedFiles?.slice(0, 30).join('\n') || 'Unknown'}

## File Categories
${Object.entries(selection.categories || {}).map(([cat, files]) => `- ${cat}: ${files.length} files`).join('\n')}

## Your Task

Review the skip decisions. For each skipped test, verify the reasoning makes sense given the changed files.

Respond in JSON format:
{
  "verified": true/false,  // Are all skip decisions reasonable?
  "concerns": ["..."],     // Any concerns about skipped tests
  "suggestions": ["..."],  // What additional tests might help
  "reasoning": "..."       // Brief explanation
}

Be CONSERVATIVE - if in doubt, flag it as a concern.`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/familjen',
      },
      body: JSON.stringify({
        model: FAST_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        verified: parsed.verified ?? false,
        concerns: parsed.concerns || [],
        suggestions: parsed.suggestions || [],
        reasoning: parsed.reasoning || 'No reasoning provided'
      }
    }

    return {
      verified: false,
      concerns: ['Could not parse LLM response'],
      suggestions: [],
      reasoning: content.slice(0, 500)
    }
  } catch (e) {
    return {
      verified: true, // Default to trusting selector if LLM fails
      concerns: [`LLM review failed: ${e}`],
      suggestions: [],
      reasoning: 'LLM review failed, trusting selector decisions'
    }
  }
}

// ============================================
// Gather Additional Context
// ============================================

function gatherAdditionalContext(selection: TestSelection, quickChecks: QuickCheckResult[]): Record<string, string> {
  const context: Record<string, string> = {}

  // Summarize quick check results
  const failures = quickChecks.filter(c => c.status === 'fail')
  const warnings = quickChecks.filter(c => c.status === 'warn')

  if (failures.length > 0) {
    context['quick_check_failures'] = failures.map(f => `${f.check}: ${f.message}`).join('; ')
  }
  if (warnings.length > 0) {
    context['quick_check_warnings'] = warnings.map(w => `${w.check}: ${w.message}`).join('; ')
  }

  // Check for high-risk file patterns
  const changedFiles = selection.changedFiles || []
  const highRiskPatterns = [
    { pattern: /supabase.*rls|rls.*policy/i, risk: 'RLS policy changes' },
    { pattern: /auth|login|session/i, risk: 'Authentication changes' },
    { pattern: /api\/.*route/i, risk: 'API route changes' },
    { pattern: /migration/i, risk: 'Database migration' },
    { pattern: /\.env|secret|credential/i, risk: 'Credential handling' },
  ]

  const risks: string[] = []
  for (const file of changedFiles) {
    for (const { pattern, risk } of highRiskPatterns) {
      if (pattern.test(file)) {
        risks.push(`${risk}: ${file}`)
      }
    }
  }
  if (risks.length > 0) {
    context['high_risk_changes'] = risks.slice(0, 10).join('; ')
  }

  // Add extended check recommendations
  const extendedChecks = selection.extendedChecks || []
  const highPriority = extendedChecks.filter(c => c.priority === 'high')
  if (highPriority.length > 0) {
    context['recommended_checks'] = highPriority.map(c => `${c.type}: ${c.reason}`).join('; ')
  }

  return context
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('🔍 Pre-Verdict Check - Fast LLM pass before supervisor\n')

  // Ensure state directory exists
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }

  // Load selector decisions
  const selectionPath = `${STATE_DIR}/test-selection.json`
  if (!existsSync(selectionPath)) {
    console.log('⚠️ No test selection found - selector may not have run')
    const output: PreVerdictOutput = {
      selectorReview: {
        verified: true,
        concerns: ['No selector output found'],
        suggestions: []
      },
      quickChecks: [],
      additionalContext: {},
      recommendation: 'proceed',
      reasoning: 'No selector output to review',
      timestamp: new Date().toISOString()
    }
    writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2))
    return
  }

  const selection: TestSelection = JSON.parse(readFileSync(selectionPath, 'utf-8'))
  console.log(`📋 Selector: ${selection.decisions?.length || 0} decisions, ${selection.changedFiles?.length || 0} files changed`)

  // Step 1: Run quick checks (no LLM needed)
  console.log('\n🏃 Running quick checks...')
  const quickChecks = await runQuickChecks(selection)

  const passed = quickChecks.filter(c => c.status === 'pass').length
  const failed = quickChecks.filter(c => c.status === 'fail').length
  const warned = quickChecks.filter(c => c.status === 'warn').length
  console.log(`   ✅ ${passed} passed, ❌ ${failed} failed, ⚠️ ${warned} warnings`)

  // Step 2: Review selector decisions with LLM
  console.log('\n🤖 Reviewing selector decisions...')
  const selectorReview = await reviewSelectorDecisions(selection)
  console.log(`   ${selectorReview.verified ? '✅ Verified' : '⚠️ Concerns found'}`)
  if (selectorReview.concerns.length > 0) {
    selectorReview.concerns.forEach(c => console.log(`   - ${c}`))
  }

  // Step 3: Gather additional context
  console.log('\n📊 Gathering context for supervisor...')
  const additionalContext = gatherAdditionalContext(selection, quickChecks)
  console.log(`   Found ${Object.keys(additionalContext).length} context items`)

  // Step 4: Determine recommendation
  let recommendation: 'proceed' | 'run_more_tests' | 'needs_investigation' = 'proceed'
  let reasoning = 'All checks passed, selector decisions verified'

  if (failed > 0) {
    recommendation = 'needs_investigation'
    reasoning = `${failed} quick checks failed - supervisor should investigate`
  } else if (!selectorReview.verified || selectorReview.concerns.length > 0) {
    recommendation = 'run_more_tests'
    reasoning = `Selector concerns: ${selectorReview.concerns.join(', ')}`
  } else if (warned > 2) {
    recommendation = 'run_more_tests'
    reasoning = `Multiple warnings (${warned}) - additional testing recommended`
  }

  // Save output
  const output: PreVerdictOutput = {
    selectorReview,
    quickChecks,
    additionalContext,
    recommendation,
    reasoning,
    timestamp: new Date().toISOString()
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2))
  console.log(`\n📝 Saved to ${OUTPUT_FILE}`)

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log(`📋 Recommendation: ${recommendation.toUpperCase()}`)
  console.log(`💡 ${reasoning}`)
  console.log('='.repeat(50))
}

main().catch(error => {
  console.error('Pre-verdict check failed:', error)
  process.exit(1)
})
