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

    // Convert failures to findings
    const findings: Finding[] = results.failures.map(f => ({
      severity: 'critical' as const,
      category: 'test-failure' as const,
      message: `${f.title}: ${f.error.slice(0, 200)}${f.error.length > 200 ? '...' : ''}`,
      file: f.file,
      line: f.line,
      testName: f.title,
      error: f.error,
    }))

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
      summary: `API Tests: ${results.passed}/${results.total} passed (${results.failed} failed, ${results.skipped} skipped).`,
      raw: results,
    }
    saveReviewerOutput(output)

    // Print failures if any
    if (results.failures.length > 0) {
      console.log('\n❌ Failed Tests:')
      for (const failure of results.failures) {
        console.log(`   • ${failure.title}`)
        console.log(`     ${failure.file}${failure.line ? `:${failure.line}` : ''}`)
        const errorPreview = failure.error.split('\n')[0].slice(0, 80)
        console.log(`     Error: ${errorPreview}${failure.error.length > 80 ? '...' : ''}`)
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
