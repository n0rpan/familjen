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

interface ExtendedCheckResult {
  type: string
  status: 'pass' | 'fail' | 'warn' | 'skipped'
  summary: string
  findings: Array<{ severity: string; message: string; file?: string }>
}

interface PreVerdictOutput {
  selectorReview: {
    verified: boolean
    concerns: string[]
    suggestions: string[]
  }
  quickChecks: QuickCheckResult[]
  extendedChecks: ExtendedCheckResult[]
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
// Extended Checks (run what selector recommended)
// ============================================

async function runExtendedChecks(
  selection: TestSelection,
  changedFiles: string[]
): Promise<ExtendedCheckResult[]> {
  const results: ExtendedCheckResult[] = []
  const extendedChecks = selection.extendedChecks || []

  // Only run high priority checks (to save time/cost)
  const highPriorityChecks = extendedChecks.filter(c => c.priority === 'high')

  for (const check of highPriorityChecks) {
    console.log(`   Running extended check: ${check.type}...`)

    try {
      switch (check.type) {
        case 'dead-code-analysis': {
          const result = await runDeadCodeAnalysis(changedFiles)
          results.push(result)
          break
        }
        case 'accessibility-audit': {
          const result = await runAccessibilityAudit(changedFiles)
          results.push(result)
          break
        }
        case 'i18n-completeness': {
          const result = await runI18nCheck(changedFiles)
          results.push(result)
          break
        }
        case 'security-audit': {
          const result = await runSecurityAudit(changedFiles)
          results.push(result)
          break
        }
        case 'bundle-size-check': {
          const result = await runBundleSizeCheck()
          results.push(result)
          break
        }
        default: {
          results.push({
            type: check.type,
            status: 'skipped',
            summary: `Unknown check type: ${check.type}`,
            findings: []
          })
        }
      }
    } catch (e) {
      results.push({
        type: check.type,
        status: 'fail',
        summary: `Check failed: ${e}`,
        findings: []
      })
    }
  }

  return results
}

async function runDeadCodeAnalysis(changedFiles: string[]): Promise<ExtendedCheckResult> {
  const findings: Array<{ severity: string; message: string; file?: string }> = []

  // Check for unused exports in changed files
  for (const file of changedFiles.slice(0, 20)) {
    if (!existsSync(file) || !file.match(/\.(ts|tsx)$/)) continue

    try {
      const content = readFileSync(file, 'utf-8')

      // Find exports
      const exports = content.match(/export\s+(const|function|class|type|interface)\s+(\w+)/g) || []

      for (const exp of exports) {
        const name = exp.match(/export\s+\w+\s+(\w+)/)?.[1]
        if (!name) continue

        // Search for usages in other files (quick grep)
        try {
          const grepResult = execSync(
            `grep -r "${name}" src/ --include="*.ts" --include="*.tsx" -l 2>/dev/null | head -5`,
            { encoding: 'utf-8', timeout: 5000 }
          )
          const usages = grepResult.trim().split('\n').filter(Boolean)

          // If only used in the same file, might be dead code
          if (usages.length === 1 && usages[0] === file) {
            findings.push({
              severity: 'warning',
              message: `Potentially unused export: ${name}`,
              file
            })
          }
        } catch {
          // grep failed, skip
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return {
    type: 'dead-code-analysis',
    status: findings.length > 0 ? 'warn' : 'pass',
    summary: findings.length > 0
      ? `Found ${findings.length} potentially unused exports`
      : 'No obvious dead code found',
    findings: findings.slice(0, 10)
  }
}

async function runAccessibilityAudit(changedFiles: string[]): Promise<ExtendedCheckResult> {
  const findings: Array<{ severity: string; message: string; file?: string }> = []

  const a11yPatterns = [
    { pattern: /<img(?![^>]*alt=)/g, issue: 'Image missing alt attribute' },
    { pattern: /<button(?![^>]*aria-label)(?![^>]*>[\w\s]+<)/g, issue: 'Button may need aria-label' },
    { pattern: /onClick=\{[^}]+\}(?![^>]*role=)/g, issue: 'Click handler without role attribute' },
    { pattern: /<div\s+onClick/g, issue: 'Clickable div - consider using button' },
  ]

  for (const file of changedFiles.slice(0, 20)) {
    if (!existsSync(file) || !file.match(/\.(tsx|jsx)$/)) continue

    try {
      const content = readFileSync(file, 'utf-8')

      for (const { pattern, issue } of a11yPatterns) {
        const matches = content.match(pattern)
        if (matches && matches.length > 0) {
          findings.push({
            severity: 'warning',
            message: `${issue} (${matches.length} occurrences)`,
            file
          })
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return {
    type: 'accessibility-audit',
    status: findings.length > 0 ? 'warn' : 'pass',
    summary: findings.length > 0
      ? `Found ${findings.length} potential accessibility issues`
      : 'No obvious accessibility issues',
    findings: findings.slice(0, 10)
  }
}

async function runI18nCheck(changedFiles: string[]): Promise<ExtendedCheckResult> {
  const findings: Array<{ severity: string; message: string; file?: string }> = []

  // Check if translation files are in sync
  const translationFiles = ['src/lib/i18n/translations/nb.ts', 'src/lib/i18n/translations/sv.ts', 'src/lib/i18n/translations/en.ts']

  const keysByFile: Record<string, Set<string>> = {}

  for (const file of translationFiles) {
    if (!existsSync(file)) continue

    try {
      const content = readFileSync(file, 'utf-8')
      // Extract translation keys (simplified - looks for key: patterns)
      const keys = content.match(/^\s{2,4}(\w+):/gm) || []
      keysByFile[file] = new Set(keys.map(k => k.trim().replace(':', '')))
    } catch {
      // Skip
    }
  }

  // Compare key sets
  const allKeys = new Set<string>()
  for (const keys of Object.values(keysByFile)) {
    Array.from(keys).forEach(key => allKeys.add(key))
  }

  for (const [file, keys] of Object.entries(keysByFile)) {
    const missing = Array.from(allKeys).filter(k => !keys.has(k))
    if (missing.length > 0) {
      findings.push({
        severity: 'warning',
        message: `Missing ${missing.length} translation keys`,
        file
      })
    }
  }

  // Check for hardcoded strings in changed components
  for (const file of changedFiles.slice(0, 10)) {
    if (!existsSync(file) || !file.match(/\.(tsx)$/)) continue
    if (file.includes('i18n') || file.includes('translations')) continue

    try {
      const content = readFileSync(file, 'utf-8')
      // Look for Norwegian text that should probably be translated
      const norwegianPatterns = [/>[A-ZÆØÅ][a-zæøå]+\s+[a-zæøå]+</g, />Legg til</g, />Lagre</g, />Avbryt</g]

      for (const pattern of norwegianPatterns) {
        const matches = content.match(pattern)
        if (matches && matches.length > 2) {
          findings.push({
            severity: 'info',
            message: `Possible hardcoded Norwegian text (${matches.length} matches)`,
            file
          })
          break
        }
      }
    } catch {
      // Skip
    }
  }

  return {
    type: 'i18n-completeness',
    status: findings.some(f => f.severity === 'warning') ? 'warn' : 'pass',
    summary: findings.length > 0
      ? `Found ${findings.length} i18n concerns`
      : 'Translations appear complete',
    findings: findings.slice(0, 10)
  }
}

async function runSecurityAudit(changedFiles: string[]): Promise<ExtendedCheckResult> {
  const findings: Array<{ severity: string; message: string; file?: string }> = []

  const securityPatterns = [
    { pattern: /dangerouslySetInnerHTML/g, issue: 'XSS risk: dangerouslySetInnerHTML', severity: 'critical' },
    { pattern: /eval\s*\(/g, issue: 'Security risk: eval()', severity: 'critical' },
    { pattern: /innerHTML\s*=/g, issue: 'XSS risk: innerHTML assignment', severity: 'warning' },
    { pattern: /process\.env\.\w+(?!\s*\|\||\s*\?\?)/g, issue: 'Unchecked env variable', severity: 'info' },
    { pattern: /password.*=.*['"][^'"]+['"]/gi, issue: 'Possible hardcoded password', severity: 'critical' },
    { pattern: /api[_-]?key.*=.*['"][^'"]+['"]/gi, issue: 'Possible hardcoded API key', severity: 'critical' },
  ]

  for (const file of changedFiles.slice(0, 20)) {
    if (!existsSync(file) || !file.match(/\.(ts|tsx|js|jsx)$/)) continue
    if (file.includes('.test.') || file.includes('.spec.')) continue

    try {
      const content = readFileSync(file, 'utf-8')

      for (const { pattern, issue, severity } of securityPatterns) {
        const matches = content.match(pattern)
        if (matches && matches.length > 0) {
          findings.push({
            severity,
            message: `${issue} (${matches.length} occurrences)`,
            file
          })
        }
      }
    } catch {
      // Skip
    }
  }

  const hasCritical = findings.some(f => f.severity === 'critical')
  return {
    type: 'security-audit',
    status: hasCritical ? 'fail' : findings.length > 0 ? 'warn' : 'pass',
    summary: hasCritical
      ? `Found ${findings.filter(f => f.severity === 'critical').length} critical security issues`
      : findings.length > 0
        ? `Found ${findings.length} security concerns`
        : 'No obvious security issues',
    findings: findings.slice(0, 10)
  }
}

async function runBundleSizeCheck(): Promise<ExtendedCheckResult> {
  try {
    // Check if package.json has new dependencies
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'))
    const deps = Object.keys(packageJson.dependencies || {})
    const devDeps = Object.keys(packageJson.devDependencies || {})

    // Check for known large packages
    const largePackages = ['moment', 'lodash', 'jquery', '@mui/material', 'antd', 'bootstrap']
    const foundLarge = deps.filter(d => largePackages.some(lp => d.includes(lp)))

    if (foundLarge.length > 0) {
      return {
        type: 'bundle-size-check',
        status: 'warn',
        summary: `Found ${foundLarge.length} potentially large dependencies`,
        findings: foundLarge.map(pkg => ({
          severity: 'warning',
          message: `Large package: ${pkg} - consider alternatives or tree-shaking`
        }))
      }
    }

    return {
      type: 'bundle-size-check',
      status: 'pass',
      summary: `${deps.length} dependencies, ${devDeps.length} devDependencies`,
      findings: []
    }
  } catch (e) {
    return {
      type: 'bundle-size-check',
      status: 'skipped',
      summary: `Could not check bundle size: ${e}`,
      findings: []
    }
  }
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
      extendedChecks: [],
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

  // Step 3: Run extended checks recommended by selector
  console.log('\n🔧 Running extended checks...')
  const changedFiles = selection.changedFiles || []
  const extendedChecks = await runExtendedChecks(selection, changedFiles)

  const extPassed = extendedChecks.filter(c => c.status === 'pass').length
  const extFailed = extendedChecks.filter(c => c.status === 'fail').length
  const extWarned = extendedChecks.filter(c => c.status === 'warn').length
  console.log(`   ✅ ${extPassed} passed, ❌ ${extFailed} failed, ⚠️ ${extWarned} warnings`)

  // Step 4: Gather additional context
  console.log('\n📊 Gathering context for supervisor...')
  const additionalContext = gatherAdditionalContext(selection, quickChecks)
  console.log(`   Found ${Object.keys(additionalContext).length} context items`)

  // Step 5: Determine recommendation
  let recommendation: 'proceed' | 'run_more_tests' | 'needs_investigation' = 'proceed'
  let reasoning = 'All checks passed, selector decisions verified'

  // Check for critical issues
  const hasCriticalExtended = extendedChecks.some(c => c.status === 'fail')

  if (failed > 0 || hasCriticalExtended) {
    recommendation = 'needs_investigation'
    reasoning = hasCriticalExtended
      ? `Extended check failed: ${extendedChecks.filter(c => c.status === 'fail').map(c => c.type).join(', ')}`
      : `${failed} quick checks failed - supervisor should investigate`
  } else if (!selectorReview.verified || selectorReview.concerns.length > 0) {
    recommendation = 'run_more_tests'
    reasoning = `Selector concerns: ${selectorReview.concerns.join(', ')}`
  } else if (warned > 2 || extWarned > 0) {
    recommendation = 'run_more_tests'
    reasoning = extWarned > 0
      ? `Extended check warnings: ${extendedChecks.filter(c => c.status === 'warn').map(c => c.type).join(', ')}`
      : `Multiple warnings (${warned}) - additional testing recommended`
  }

  // Save output
  const output: PreVerdictOutput = {
    selectorReview,
    quickChecks,
    extendedChecks,
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
