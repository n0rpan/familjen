#!/usr/bin/env npx tsx
/**
 * E2E Test Reporter
 *
 * IMPORTANT: This script is NON-BLOCKING.
 * - It reports findings but does NOT fail the CI
 * - Only the final verdict script can block PRs
 * - Exit 0 = report completed (even if tests failed)
 * - Exit 1 = script itself failed (couldn't read results)
 *
 * Converts Playwright test results into the standardized ReviewerOutput format.
 * E2E tests on demo/mock data serve as UAT (User Acceptance Testing).
 *
 * Usage:
 *   npx tsx scripts/e2e-test-reporter.ts
 *   npx tsx scripts/e2e-test-reporter.ts --results playwright-report/results.json
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  type ReviewerOutput,
  type Finding,
  saveReviewerOutput,
  verdictEmoji,
} from './ai-review-types'

// ============================================
// Types for Playwright JSON output
// ============================================

interface PlaywrightReport {
  config: {
    projects: Array<{ name: string }>
    testDir: string
  }
  suites: PlaywrightSuite[]
  errors: string[]
  stats: {
    startTime: string
    duration: number
    expected: number
    unexpected: number
    flaky: number
    skipped: number
  }
}

interface PlaywrightSuite {
  title: string
  file: string
  line: number
  specs: PlaywrightSpec[]
  suites?: PlaywrightSuite[]
}

interface PlaywrightSpec {
  title: string
  file: string
  line: number
  tests: PlaywrightTest[]
}

interface PlaywrightTest {
  title: string
  projectName: string
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped'
  duration: number
  results: PlaywrightResult[]
}

interface PlaywrightResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
  duration: number
  error?: {
    message: string
    stack?: string
  }
  attachments?: Array<{
    name: string
    path: string
    contentType: string
  }>
}

// ============================================
// Alternative: Simpler JSON format from --json-report
// ============================================

interface SimplePlaywrightReport {
  status: 'passed' | 'failed'
  duration: number
  passed: number
  failed: number
  flaky: number
  skipped: number
  failures: Array<{
    title: string
    file: string
    line: number
    error: string
  }>
}

// ============================================
// Parsing Functions
// ============================================

function findResultsFile(): string | null {
  const possiblePaths = [
    'playwright-report/results.json',
    'test-results/results.json',
    'e2e-results.json',
    '.playwright/results.json',
  ]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path
    }
  }

  // Also check for any JSON file in playwright-report
  if (existsSync('playwright-report')) {
    const files = readdirSync('playwright-report').filter(f => f.endsWith('.json'))
    if (files.length > 0) {
      return join('playwright-report', files[0])
    }
  }

  return null
}

function parsePlaywrightReport(filePath: string): {
  passed: number
  failed: number
  skipped: number
  flaky: number
  duration: number
  failures: Array<{ title: string; file: string; line?: number; error: string }>
} {
  const content = readFileSync(filePath, 'utf-8')
  const data = JSON.parse(content)

  // Try to detect format and parse accordingly
  if ('stats' in data && 'suites' in data) {
    // Full Playwright JSON format
    return parseFullFormat(data as PlaywrightReport)
  } else if ('passed' in data && 'failed' in data) {
    // Simplified format from --reporter=json
    return parseSimpleFormat(data as SimplePlaywrightReport)
  } else {
    // Unknown format - try to extract what we can
    return {
      passed: data.passed || 0,
      failed: data.failed || 0,
      skipped: data.skipped || 0,
      flaky: data.flaky || 0,
      duration: data.duration || 0,
      failures: [],
    }
  }
}

function parseFullFormat(report: PlaywrightReport): {
  passed: number
  failed: number
  skipped: number
  flaky: number
  duration: number
  failures: Array<{ title: string; file: string; line?: number; error: string }>
} {
  const failures: Array<{ title: string; file: string; line?: number; error: string }> = []

  function processSuite(suite: PlaywrightSuite) {
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        if (test.status === 'unexpected') {
          const failedResult = test.results.find(r => r.status === 'failed' || r.status === 'timedOut')
          failures.push({
            title: `${spec.title} > ${test.title}`,
            file: spec.file,
            line: spec.line,
            error: failedResult?.error?.message || 'Test failed',
          })
        }
      }
    }
    // Process nested suites
    for (const nestedSuite of suite.suites || []) {
      processSuite(nestedSuite)
    }
  }

  for (const suite of report.suites) {
    processSuite(suite)
  }

  return {
    passed: report.stats.expected,
    failed: report.stats.unexpected,
    skipped: report.stats.skipped,
    flaky: report.stats.flaky,
    duration: report.stats.duration,
    failures,
  }
}

function parseSimpleFormat(report: SimplePlaywrightReport): {
  passed: number
  failed: number
  skipped: number
  flaky: number
  duration: number
  failures: Array<{ title: string; file: string; line?: number; error: string }>
} {
  return {
    passed: report.passed,
    failed: report.failed,
    skipped: report.skipped,
    flaky: report.flaky,
    duration: report.duration,
    failures: report.failures.map(f => ({
      title: f.title,
      file: f.file,
      line: f.line,
      error: f.error,
    })),
  }
}

// ============================================
// Main
// ============================================

async function main() {
  const startTime = Date.now()
  const args = process.argv.slice(2)

  console.log('📊 E2E Test Reporter (Non-Blocking)\n')

  // Find or parse results file path
  let resultsFile: string | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--results' && args[i + 1]) {
      resultsFile = args[i + 1]
      i++
    }
  }

  if (!resultsFile) {
    resultsFile = findResultsFile()
  }

  if (!resultsFile || !existsSync(resultsFile)) {
    console.log('⚠️ No E2E test results found')
    console.log('\nExpected files:')
    console.log('  - playwright-report/results.json')
    console.log('  - e2e-results.json')
    console.log('\nTo generate results:')
    console.log('  npx playwright test --reporter=json --output=e2e-results.json')

    // Save skipped output
    const skippedOutput: ReviewerOutput = {
      reviewer: 'e2e-tests',
      model: 'playwright',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'No E2E test results to report.',
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0)
  }

  console.log(`📄 Reading results from: ${resultsFile}`)

  try {
    const results = parsePlaywrightReport(resultsFile)

    console.log(`\n📈 Test Results:`)
    console.log(`   ✅ Passed: ${results.passed}`)
    console.log(`   ❌ Failed: ${results.failed}`)
    console.log(`   ⏭️  Skipped: ${results.skipped}`)
    console.log(`   🔄 Flaky: ${results.flaky}`)
    console.log(`   ⏱️  Duration: ${Math.round(results.duration / 1000)}s`)

    // Convert failures to findings
    const findings: Finding[] = results.failures.map(f => ({
      severity: 'critical' as const,
      category: 'test-failure' as const,
      message: `${f.title}: ${f.error}`,
      file: f.file,
      line: f.line,
      testName: f.title,
      error: f.error,
    }))

    // Add flaky tests as warnings
    if (results.flaky > 0) {
      findings.push({
        severity: 'warning',
        category: 'test-failure',
        message: `${results.flaky} flaky test(s) detected - may need investigation`,
      })
    }

    // Determine verdict
    let verdict: 'PASS' | 'WARN' | 'FAIL'
    if (results.failed > 0) {
      verdict = 'FAIL'
    } else if (results.flaky > 0) {
      verdict = 'WARN'
    } else {
      verdict = 'PASS'
    }

    // Calculate confidence based on test coverage
    const total = results.passed + results.failed + results.skipped
    const confidence = total > 0 ? Math.round((results.passed / total) * 100) : 0

    // Save in standardized format
    const output: ReviewerOutput = {
      reviewer: 'e2e-tests',
      model: 'playwright',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'completed',
      verdict,
      confidence,
      findings,
      summary: `E2E UAT: ${results.passed}/${total} tests passed (${results.failed} failed, ${results.flaky} flaky, ${results.skipped} skipped).`,
      raw: results,
    }
    saveReviewerOutput(output)

    // Print failures if any
    if (results.failures.length > 0) {
      console.log('\n❌ Failed Tests:')
      for (const failure of results.failures) {
        console.log(`   • ${failure.title}`)
        console.log(`     ${failure.file}${failure.line ? `:${failure.line}` : ''}`)
        console.log(`     Error: ${failure.error.slice(0, 100)}${failure.error.length > 100 ? '...' : ''}`)
      }
    }

    console.log(`\n📄 Results: .ai-reviews/e2e-tests.json`)

    // Always exit 0 - review completed, final verdict decides blocking
    console.log(`\n${verdictEmoji(verdict)} E2E report complete (${verdict})`)
    process.exit(0)

  } catch (error) {
    console.error('\n❌ Failed to parse E2E results:', error)

    // Save error output
    const errorOutput: ReviewerOutput = {
      reviewer: 'e2e-tests',
      model: 'playwright',
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
      summary: 'Failed to parse E2E test results.',
    }
    saveReviewerOutput(errorOutput)

    process.exit(1) // Script itself failed
  }
}

main().catch(console.error)
