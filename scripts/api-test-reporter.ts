#!/usr/bin/env npx tsx
/**
 * API Test Reporter
 *
 * IMPORTANT: This script is NON-BLOCKING.
 * - It reports findings but does NOT fail the CI
 * - Only the final verdict script can block PRs
 * - Exit 0 = report completed (even if tests failed)
 * - Exit 1 = script itself failed (couldn't read results)
 *
 * Converts Vitest test results into the standardized ReviewerOutput format.
 * API tests verify that the app's endpoints work correctly.
 *
 * Usage:
 *   npm run test:api -- --reporter=json --outputFile=api-test-results.json
 *   npx tsx scripts/api-test-reporter.ts
 *   npx tsx scripts/api-test-reporter.ts --results api-test-results.json
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import {
  type ReviewerOutput,
  type Finding,
  saveReviewerOutput,
  verdictEmoji,
} from './ai-review-types'

// ============================================
// Types for Vitest JSON output
// ============================================

interface VitestJsonReport {
  numTotalTestSuites: number
  numPassedTestSuites: number
  numFailedTestSuites: number
  numPendingTestSuites: number
  numTotalTests: number
  numPassedTests: number
  numFailedTests: number
  numPendingTests: number
  numTodoTests: number
  startTime: number
  success: boolean
  testResults: VitestTestFile[]
}

interface VitestTestFile {
  name: string
  status: 'passed' | 'failed' | 'pending'
  startTime: number
  endTime: number
  assertionResults: VitestAssertion[]
  message?: string
}

interface VitestAssertion {
  ancestorTitles: string[]
  fullName: string
  status: 'passed' | 'failed' | 'pending'
  title: string
  duration: number
  failureMessages: string[]
  location?: {
    line: number
    column: number
  }
}

// ============================================
// Alternative format from vitest --reporter=json (newer)
// ============================================

interface VitestJsonReportV2 {
  testResults: Array<{
    file: string
    status: 'pass' | 'fail' | 'skip'
    tests: Array<{
      name: string
      status: 'pass' | 'fail' | 'skip'
      duration: number
      errors?: string[]
    }>
  }>
  success: boolean
  duration: number
}

// ============================================
// Test Categorization
// ============================================

type TestSeverity = 'critical' | 'warning' | 'info'

/**
 * Categorize test severity based on file path and test name
 * Security and API tests are critical, UI tests are warnings, utilities are info
 */
function categorizeTestSeverity(file: string, testName: string): TestSeverity {
  const lowerFile = file.toLowerCase()
  const lowerName = testName.toLowerCase()

  // Critical: Security, auth, API, integration tests
  if (
    lowerFile.includes('security') ||
    lowerFile.includes('auth') ||
    lowerFile.includes('/api/') ||
    lowerFile.includes('integration') ||
    lowerFile.includes('rls') ||
    lowerName.includes('security') ||
    lowerName.includes('auth') ||
    lowerName.includes('injection') ||
    lowerName.includes('xss') ||
    lowerName.includes('credential')
  ) {
    return 'critical'
  }

  // High priority (mapped to warning): E2E, hooks, components
  if (
    lowerFile.includes('/e2e/') ||
    lowerFile.includes('/hooks/') ||
    lowerFile.includes('/components/') ||
    lowerFile.includes('integration')
  ) {
    return 'warning'
  }

  // Info: Utilities, helpers, pure functions
  return 'info'
}

/**
 * Get a category label for the test based on file path
 */
function getTestCategory(file: string): string {
  const lowerFile = file.toLowerCase()

  if (lowerFile.includes('security') || lowerFile.includes('auth')) return 'security'
  if (lowerFile.includes('/api/')) return 'api'
  if (lowerFile.includes('integration')) return 'integration'
  if (lowerFile.includes('/hooks/')) return 'hooks'
  if (lowerFile.includes('/components/')) return 'components'
  if (lowerFile.includes('/lib/')) return 'lib'
  if (lowerFile.includes('/utils/')) return 'utils'

  return 'other'
}

// ============================================
// Parsing Functions
// ============================================

function findResultsFile(): string | null {
  const possiblePaths = [
    'api-test-results.json',
    'test-results.json',
    'vitest-results.json',
    'coverage/test-results.json',
  ]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path
    }
  }

  return null
}

function parseVitestReport(filePath: string): {
  passed: number
  failed: number
  skipped: number
  total: number
  duration: number
  failures: Array<{ title: string; file: string; line?: number; error: string }>
} {
  const content = readFileSync(filePath, 'utf-8')
  const data = JSON.parse(content)

  // Detect format version and parse
  if ('numTotalTests' in data) {
    return parseV1Format(data as VitestJsonReport)
  } else if ('testResults' in data && Array.isArray(data.testResults)) {
    return parseV2Format(data as VitestJsonReportV2)
  } else {
    // Unknown format - try to extract what we can
    return {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration: 0,
      failures: [],
    }
  }
}

function parseV1Format(report: VitestJsonReport): {
  passed: number
  failed: number
  skipped: number
  total: number
  duration: number
  failures: Array<{ title: string; file: string; line?: number; error: string }>
} {
  const failures: Array<{ title: string; file: string; line?: number; error: string }> = []

  for (const testFile of report.testResults) {
    for (const assertion of testFile.assertionResults) {
      if (assertion.status === 'failed') {
        failures.push({
          title: assertion.fullName || assertion.title,
          file: testFile.name,
          line: assertion.location?.line,
          error: assertion.failureMessages.join('\n') || 'Test failed',
        })
      }
    }
  }

  return {
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests + report.numTodoTests,
    total: report.numTotalTests,
    duration: Date.now() - report.startTime,
    failures,
  }
}

function parseV2Format(report: VitestJsonReportV2): {
  passed: number
  failed: number
  skipped: number
  total: number
  duration: number
  failures: Array<{ title: string; file: string; line?: number; error: string }>
} {
  const failures: Array<{ title: string; file: string; line?: number; error: string }> = []
  let passed = 0
  let failed = 0
  let skipped = 0

  for (const testFile of report.testResults) {
    for (const test of testFile.tests) {
      if (test.status === 'pass') {
        passed++
      } else if (test.status === 'fail') {
        failed++
        failures.push({
          title: test.name,
          file: testFile.file,
          error: test.errors?.join('\n') || 'Test failed',
        })
      } else {
        skipped++
      }
    }
  }

  return {
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    duration: report.duration,
    failures,
  }
}

// ============================================
// Main
// ============================================

async function main() {
  const startTime = Date.now()
  const args = process.argv.slice(2)

  console.log('📊 API Test Reporter (Non-Blocking)\n')

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
    console.log('⚠️ No API test results found')
    console.log('\nExpected files:')
    console.log('  - api-test-results.json')
    console.log('  - test-results.json')
    console.log('\nTo generate results:')
    console.log('  npm run test:api -- --reporter=json --outputFile=api-test-results.json')

    // Save skipped output
    const skippedOutput: ReviewerOutput = {
      reviewer: 'api-tests',
      model: 'vitest',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'No API test results to report.',
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0)
  }

  console.log(`📄 Reading results from: ${resultsFile}`)

  try {
    const results = parseVitestReport(resultsFile)

    console.log(`\n📈 Test Results:`)
    console.log(`   ✅ Passed: ${results.passed}`)
    console.log(`   ❌ Failed: ${results.failed}`)
    console.log(`   ⏭️  Skipped: ${results.skipped}`)
    console.log(`   📊 Total: ${results.total}`)
    console.log(`   ⏱️  Duration: ${Math.round(results.duration / 1000)}s`)

    // Convert failures to findings with severity based on test type
    const findings: Finding[] = results.failures.map(f => {
      const severity = categorizeTestSeverity(f.file, f.title)
      const category = getTestCategory(f.file)

      return {
        severity,
        category: category === 'security' ? 'security' as const :
                  category === 'api' ? 'api-contract' as const :
                  'test-failure' as const,
        message: `[${category.toUpperCase()}] ${f.title}: ${f.error.slice(0, 200)}${f.error.length > 200 ? '...' : ''}`,
        file: f.file,
        line: f.line,
        testName: f.title,
        error: f.error,
      }
    })

    // Sort by severity (critical first)
    findings.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 }
      return severityOrder[a.severity] - severityOrder[b.severity]
    })

    // Determine verdict
    let verdict: 'PASS' | 'WARN' | 'FAIL'
    if (results.failed > 0) {
      verdict = 'FAIL'
    } else if (results.skipped > results.passed) {
      verdict = 'WARN'
    } else {
      verdict = 'PASS'
    }

    // Calculate confidence based on pass rate
    const confidence = results.total > 0 ? Math.round((results.passed / results.total) * 100) : 100

    // Build summary with severity breakdown
    const criticalCount = findings.filter(f => f.severity === 'critical').length
    const warningCount = findings.filter(f => f.severity === 'warning').length
    const infoCount = findings.filter(f => f.severity === 'info').length

    let summary = `API Tests: ${results.passed}/${results.total} passed`
    if (results.failed > 0) {
      summary += ` (${results.failed} failed: ${criticalCount} critical, ${warningCount} high, ${infoCount} low)`
    }
    if (results.skipped > 0) {
      summary += `, ${results.skipped} skipped`
    }

    // Save in standardized format
    const output: ReviewerOutput = {
      reviewer: 'api-tests',
      model: 'vitest',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'completed',
      verdict,
      confidence,
      findings,
      summary,
      raw: results,
    }
    saveReviewerOutput(output)

    // Print failures by severity
    if (findings.length > 0) {
      console.log('\n❌ Failed Tests (by severity):')

      // Group by severity
      const bySeverity = { critical: [] as typeof findings, warning: [] as typeof findings, info: [] as typeof findings }
      for (const f of findings) {
        bySeverity[f.severity].push(f)
      }

      if (bySeverity.critical.length > 0) {
        console.log(`\n   🔴 CRITICAL (${bySeverity.critical.length}):`)
        for (const f of bySeverity.critical) {
          console.log(`      • ${f.testName}`)
          console.log(`        ${f.file}${f.line ? `:${f.line}` : ''}`)
        }
      }

      if (bySeverity.warning.length > 0) {
        console.log(`\n   🟠 HIGH (${bySeverity.warning.length}):`)
        for (const f of bySeverity.warning) {
          console.log(`      • ${f.testName}`)
          console.log(`        ${f.file}${f.line ? `:${f.line}` : ''}`)
        }
      }

      if (bySeverity.info.length > 0) {
        console.log(`\n   🟡 LOW (${bySeverity.info.length}):`)
        for (const f of bySeverity.info.slice(0, 5)) {
          console.log(`      • ${f.testName}`)
        }
        if (bySeverity.info.length > 5) {
          console.log(`      ... and ${bySeverity.info.length - 5} more`)
        }
      }
    }

    console.log(`\n📄 Results: ai-reviews/api-tests.json`)

    // Always exit 0 - review completed, final verdict decides blocking
    console.log(`\n${verdictEmoji(verdict)} API test report complete (${verdict})`)
    process.exit(0)

  } catch (error) {
    console.error('\n❌ Failed to parse API test results:', error)

    // Save error output
    const errorOutput: ReviewerOutput = {
      reviewer: 'api-tests',
      model: 'vitest',
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
      summary: 'Failed to parse API test results.',
    }
    saveReviewerOutput(errorOutput)

    process.exit(1) // Script itself failed
  }
}

main().catch(console.error)
