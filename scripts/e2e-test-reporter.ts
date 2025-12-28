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
// PR-Specific Test Scenarios
// ============================================

interface PRTestScenario {
  id: string
  name: string
  description: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  page: string
  prContext: string
}

interface PRTestScenarios {
  prTitle: string
  prDescription: string
  generatedAt: string
  scenarios: PRTestScenario[]
}

function loadPRScenarios(): PRTestScenarios | null {
  const scenariosPath = 'tests/e2e/generated/pr-scenarios.json'
  if (!existsSync(scenariosPath)) {
    return null
  }
  try {
    const content = readFileSync(scenariosPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

interface PRTestCorrelation {
  prTestsFailed: number
  prTestsPassed: number
  prTestsTotal: number
  staticTestsFailed: number
  failedPRScenarios: Array<{
    scenario: PRTestScenario
    error: string
  }>
}

/**
 * Correlate test failures with PR-specific scenarios
 * This helps identify which failures are directly related to PR changes
 */
function correlatePRTests(
  failures: Array<{ title: string; file: string; error: string }>,
  prScenarios: PRTestScenarios | null,
  totalPassed: number
): PRTestCorrelation {
  if (!prScenarios || prScenarios.scenarios.length === 0) {
    return {
      prTestsFailed: 0,
      prTestsPassed: 0,
      prTestsTotal: 0,
      staticTestsFailed: failures.length,
      failedPRScenarios: []
    }
  }

  const failedPRScenarios: PRTestCorrelation['failedPRScenarios'] = []
  let prTestsFailed = 0
  let staticTestsFailed = 0

  for (const failure of failures) {
    // Check if this failure matches a PR scenario
    const matchingScenario = prScenarios.scenarios.find(scenario => {
      // Match by scenario name or ID in test title
      const lowerTitle = failure.title.toLowerCase()
      const lowerName = scenario.name.toLowerCase()
      const lowerId = scenario.id.toLowerCase()

      return lowerTitle.includes(lowerName) ||
             lowerTitle.includes(lowerId) ||
             lowerTitle.includes(scenario.page) ||
             failure.file.includes('pr-scenarios')
    })

    if (matchingScenario) {
      prTestsFailed++
      failedPRScenarios.push({
        scenario: matchingScenario,
        error: failure.error
      })
    } else {
      staticTestsFailed++
    }
  }

  // Estimate passed PR tests (total scenarios minus failed)
  const prTestsPassed = Math.max(0, prScenarios.scenarios.length - prTestsFailed)

  return {
    prTestsFailed,
    prTestsPassed,
    prTestsTotal: prScenarios.scenarios.length,
    staticTestsFailed,
    failedPRScenarios
  }
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

interface TestWithDuration {
  title: string
  file: string
  duration: number
  status: 'passed' | 'failed' | 'skipped'
}

function parsePlaywrightReport(filePath: string): {
  passed: number
  failed: number
  skipped: number
  flaky: number
  duration: number
  failures: Array<{ title: string; file: string; line?: number; error: string }>
  slowTests: TestWithDuration[]
  averageTestDuration: number
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
      slowTests: [],
      averageTestDuration: 0,
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
  slowTests: TestWithDuration[]
  averageTestDuration: number
} {
  const failures: Array<{ title: string; file: string; line?: number; error: string }> = []
  const allTests: TestWithDuration[] = []
  const SLOW_TEST_THRESHOLD_MS = 30000 // 30 seconds

  function processSuite(suite: PlaywrightSuite) {
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        // Track all test durations
        allTests.push({
          title: `${spec.title} > ${test.title}`,
          file: spec.file,
          duration: test.duration,
          status: test.status === 'expected' ? 'passed' :
                  test.status === 'unexpected' ? 'failed' : 'skipped'
        })

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

  // Find slow tests
  const slowTests = allTests
    .filter(t => t.duration > SLOW_TEST_THRESHOLD_MS)
    .sort((a, b) => b.duration - a.duration)

  // Calculate average duration
  const totalDuration = allTests.reduce((sum, t) => sum + t.duration, 0)
  const averageTestDuration = allTests.length > 0 ? totalDuration / allTests.length : 0

  return {
    passed: report.stats.expected,
    failed: report.stats.unexpected,
    skipped: report.stats.skipped,
    flaky: report.stats.flaky,
    duration: report.stats.duration,
    failures,
    slowTests,
    averageTestDuration,
  }
}

function parseSimpleFormat(report: SimplePlaywrightReport): {
  passed: number
  failed: number
  skipped: number
  flaky: number
  duration: number
  failures: Array<{ title: string; file: string; line?: number; error: string }>
  slowTests: TestWithDuration[]
  averageTestDuration: number
} {
  // Simple format doesn't have per-test duration, so we estimate
  const totalTests = report.passed + report.failed + report.skipped
  const averageTestDuration = totalTests > 0 ? report.duration / totalTests : 0

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
    slowTests: [], // Simple format doesn't have per-test timing
    averageTestDuration,
  }
}

// ============================================
// Main
// ============================================

async function main() {
  const startTime = Date.now()
  const args = process.argv.slice(2)

  console.log('📊 E2E Test Reporter (Non-Blocking)\n')

  // Check for PR-specific test scenarios
  const prScenarios = loadPRScenarios()
  if (prScenarios) {
    console.log('🤖 PR-Specific Tests Generated:')
    console.log(`   PR: ${prScenarios.prTitle}`)
    console.log(`   Scenarios: ${prScenarios.scenarios.length}`)
    const criticalCount = prScenarios.scenarios.filter(s => s.priority === 'critical').length
    const highCount = prScenarios.scenarios.filter(s => s.priority === 'high').length
    if (criticalCount > 0) console.log(`   🔴 Critical: ${criticalCount}`)
    if (highCount > 0) console.log(`   🟠 High: ${highCount}`)
    console.log('')
    for (const scenario of prScenarios.scenarios.slice(0, 5)) {
      const icon = scenario.priority === 'critical' ? '🔴' :
                   scenario.priority === 'high' ? '🟠' :
                   scenario.priority === 'medium' ? '🟡' : '🟢'
      console.log(`   ${icon} ${scenario.name}`)
      console.log(`      → ${scenario.prContext}`)
    }
    if (prScenarios.scenarios.length > 5) {
      console.log(`   ... and ${prScenarios.scenarios.length - 5} more scenarios`)
    }
    console.log('')
  } else {
    console.log('ℹ️  No PR-specific test scenarios found')
    console.log('   Run: npx tsx scripts/ai-pr-test-generator.ts\n')
  }

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

    // Build summary including PR-specific info
    let summary = 'No E2E test results to report.'
    if (prScenarios) {
      summary = `🤖 ${prScenarios.scenarios.length} PR-specific tests generated for "${prScenarios.prTitle}", but no Playwright results found.`
    }

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
      summary,
      raw: prScenarios ? { prScenarios: prScenarios.scenarios.length } : undefined,
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

    // Correlate failures with PR-specific scenarios
    const correlation = correlatePRTests(results.failures, prScenarios, results.passed)

    // Convert failures to findings with PR-specific marking
    const findings: Finding[] = results.failures.map(f => {
      const isPRTest = correlation.failedPRScenarios.some(
        fpr => fpr.scenario.name.toLowerCase().includes(f.title.toLowerCase().slice(0, 20))
      ) || f.file.includes('pr-scenarios')

      return {
        severity: isPRTest ? 'critical' as const : 'warning' as const,
        category: isPRTest ? 'test-failure' as const : 'test-failure' as const,
        message: `${isPRTest ? '[PR-SPECIFIC] ' : ''}${f.title}: ${f.error}`,
        file: f.file,
        line: f.line,
        testName: f.title,
        error: f.error,
      }
    })

    // Sort PR-specific failures first
    findings.sort((a, b) => {
      const aIsPR = a.message.includes('[PR-SPECIFIC]') ? 0 : 1
      const bIsPR = b.message.includes('[PR-SPECIFIC]') ? 0 : 1
      return aIsPR - bIsPR
    })

    // Add flaky tests as warnings
    if (results.flaky > 0) {
      findings.push({
        severity: 'warning',
        category: 'test-failure',
        message: `${results.flaky} flaky test(s) detected - may need investigation`,
      })
    }

    // Add slow tests as performance warnings
    if (results.slowTests.length > 0) {
      for (const slowTest of results.slowTests.slice(0, 3)) {
        findings.push({
          severity: 'info',
          category: 'performance',
          message: `Slow test (${Math.round(slowTest.duration / 1000)}s): ${slowTest.title}`,
          file: slowTest.file,
        })
      }
      if (results.slowTests.length > 3) {
        findings.push({
          severity: 'info',
          category: 'performance',
          message: `${results.slowTests.length - 3} more slow tests (>30s) detected`,
        })
      }
    }

    // Determine verdict - weight PR test failures higher
    let verdict: 'PASS' | 'WARN' | 'FAIL'
    if (correlation.prTestsFailed > 0) {
      verdict = 'FAIL' // PR-specific test failures always FAIL
    } else if (results.failed > 0) {
      verdict = 'WARN' // Static test failures are warnings (could be pre-existing)
    } else if (results.flaky > 0) {
      verdict = 'WARN'
    } else {
      verdict = 'PASS'
    }

    // Calculate confidence based on test coverage
    const total = results.passed + results.failed + results.skipped
    const confidence = total > 0 ? Math.round((results.passed / total) * 100) : 0

    // Build summary with PR-specific correlation
    let summary = `E2E UAT: ${results.passed}/${total} tests passed`
    if (prScenarios && prScenarios.scenarios.length > 0) {
      summary = `🤖 PR Tests: ${correlation.prTestsPassed}/${correlation.prTestsTotal} passed`
      if (correlation.prTestsFailed > 0) {
        summary += ` (${correlation.prTestsFailed} PR-specific failures!)`
      }
      summary += `. Static: ${results.passed - correlation.prTestsPassed}/${total - correlation.prTestsTotal}`
      if (correlation.staticTestsFailed > 0) {
        summary += ` (${correlation.staticTestsFailed} failed)`
      }
    } else {
      summary += ` (${results.failed} failed, ${results.flaky} flaky, ${results.skipped} skipped)`
    }

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
      summary,
      raw: {
        ...results,
        prScenarios: prScenarios ? {
          count: prScenarios.scenarios.length,
          criticalCount: prScenarios.scenarios.filter(s => s.priority === 'critical').length,
          highCount: prScenarios.scenarios.filter(s => s.priority === 'high').length,
          prTitle: prScenarios.prTitle,
        } : null,
        correlation: {
          prTestsFailed: correlation.prTestsFailed,
          prTestsPassed: correlation.prTestsPassed,
          prTestsTotal: correlation.prTestsTotal,
          staticTestsFailed: correlation.staticTestsFailed,
          failedPRScenarioIds: correlation.failedPRScenarios.map(f => f.scenario.id),
        },
        performance: {
          averageTestDuration: Math.round(results.averageTestDuration),
          slowTestCount: results.slowTests.length,
          slowestTests: results.slowTests.slice(0, 5).map(t => ({
            title: t.title,
            duration: Math.round(t.duration / 1000),
          })),
        },
      },
    }
    saveReviewerOutput(output)

    // Print failures with PR correlation
    if (results.failures.length > 0) {
      // First show PR-specific failures (critical!)
      if (correlation.failedPRScenarios.length > 0) {
        console.log('\n🔴 PR-SPECIFIC TEST FAILURES (directly related to your changes):')
        for (const { scenario, error } of correlation.failedPRScenarios) {
          console.log(`   • [${scenario.priority.toUpperCase()}] ${scenario.name}`)
          console.log(`     Page: ${scenario.page}`)
          console.log(`     Context: ${scenario.prContext}`)
          console.log(`     Error: ${error.slice(0, 80)}${error.length > 80 ? '...' : ''}`)
        }
      }

      // Then show static test failures (might be pre-existing)
      const staticFailures = results.failures.filter(
        f => !correlation.failedPRScenarios.some(
          fpr => f.title.toLowerCase().includes(fpr.scenario.name.toLowerCase().slice(0, 20))
        ) && !f.file.includes('pr-scenarios')
      )
      if (staticFailures.length > 0) {
        console.log('\n🟠 Static Test Failures (may be pre-existing):')
        for (const failure of staticFailures.slice(0, 5)) {
          console.log(`   • ${failure.title}`)
          console.log(`     ${failure.file}${failure.line ? `:${failure.line}` : ''}`)
        }
        if (staticFailures.length > 5) {
          console.log(`   ... and ${staticFailures.length - 5} more`)
        }
      }
    }

    // Print slow tests if any
    if (results.slowTests.length > 0) {
      console.log(`\n⏱️ Slow Tests (>${Math.round(30)}s):`)
      for (const slowTest of results.slowTests.slice(0, 5)) {
        console.log(`   🐌 ${Math.round(slowTest.duration / 1000)}s - ${slowTest.title}`)
      }
      if (results.slowTests.length > 5) {
        console.log(`   ... and ${results.slowTests.length - 5} more slow tests`)
      }
      console.log(`\n📊 Average test duration: ${Math.round(results.averageTestDuration / 1000)}s`)
    }

    console.log(`\n📄 Results: ai-reviews/e2e-tests.json`)

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
