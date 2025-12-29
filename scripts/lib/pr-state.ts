/**
 * PR State Tracking for Smart CI
 *
 * Tracks test results across commits in a PR to enable incremental testing.
 * State is stored as a GitHub artifact and loaded at the start of each CI run.
 *
 * Key concepts:
 * - Each test type has a "last green" commit SHA
 * - We can skip tests if relevant files haven't changed since last green
 * - State persists across commits within a PR
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

// ============================================
// TYPES
// ============================================

export type TestType =
  | 'lint'
  | 'typecheck'
  | 'unit-tests'
  | 'migration-review'
  | 'code-review'
  | 'visual-validation'
  | 'e2e-tests'
  | 'api-tests'

export interface TestRun {
  testType: TestType
  commitSha: string
  timestamp: string
  passed: boolean
  // Scope of what was tested (for partial runs)
  scope?: string[]
  // Hash of files that were tested (for change detection)
  filesHash: string
  // Duration in ms
  durationMs: number
  // Skip reason if skipped
  skipReason?: string
}

export interface PRState {
  prNumber: number
  baseBranch: string
  headBranch: string
  // All test runs in this PR
  runs: TestRun[]
  // Selector decisions from each commit
  selectorDecisions: SelectorDecision[]
  // Created timestamp
  createdAt: string
  // Last updated
  updatedAt: string
}

export interface SelectorDecision {
  commitSha: string
  timestamp: string
  decisions: TestDecision[]
  // Model used for decision
  model: string
  // Reasoning from LLM
  reasoning: string
}

export interface TestDecision {
  testType: TestType
  enabled: boolean
  scope?: string[]
  reason: string
  // Whether supervisor can override this skip
  overridable: boolean
}

// ============================================
// STATE MANAGEMENT
// ============================================

const STATE_DIR = 'ci-state'
const STATE_FILE = 'pr-state.json'

/**
 * Load PR state from file (downloaded from artifacts)
 */
export function loadPRState(): PRState | null {
  const statePath = join(STATE_DIR, STATE_FILE)
  if (!existsSync(statePath)) {
    return null
  }

  try {
    const content = readFileSync(statePath, 'utf-8')
    return JSON.parse(content) as PRState
  } catch (error) {
    console.warn(`⚠️ Failed to load PR state: ${error}`)
    return null
  }
}

/**
 * Save PR state to file (will be uploaded as artifact)
 */
export function savePRState(state: PRState): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }

  state.updatedAt = new Date().toISOString()
  const statePath = join(STATE_DIR, STATE_FILE)
  writeFileSync(statePath, JSON.stringify(state, null, 2))
  console.log(`📄 Saved PR state: ${statePath}`)
}

/**
 * Create initial PR state
 */
export function createPRState(prNumber: number, baseBranch: string, headBranch: string): PRState {
  return {
    prNumber,
    baseBranch,
    headBranch,
    runs: [],
    selectorDecisions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Record a test run result
 */
export function recordTestRun(
  state: PRState,
  testType: TestType,
  commitSha: string,
  passed: boolean,
  relevantFiles: string[],
  durationMs: number,
  scope?: string[],
  skipReason?: string
): void {
  const run: TestRun = {
    testType,
    commitSha,
    timestamp: new Date().toISOString(),
    passed,
    scope,
    filesHash: computeFilesHash(relevantFiles),
    durationMs,
    skipReason,
  }

  state.runs.push(run)
}

/**
 * Record a selector decision
 */
export function recordSelectorDecision(
  state: PRState,
  commitSha: string,
  decisions: TestDecision[],
  model: string,
  reasoning: string
): void {
  state.selectorDecisions.push({
    commitSha,
    timestamp: new Date().toISOString(),
    decisions,
    model,
    reasoning,
  })
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get the last successful run for a test type
 */
export function getLastGreenRun(state: PRState, testType: TestType): TestRun | null {
  const runs = state.runs
    .filter(r => r.testType === testType && r.passed)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return runs[0] || null
}

/**
 * Get all runs for a test type
 */
export function getRunsForType(state: PRState, testType: TestType): TestRun[] {
  return state.runs.filter(r => r.testType === testType)
}

/**
 * Check if a test can be skipped based on file changes
 */
export function canSkipTest(
  state: PRState,
  testType: TestType,
  currentRelevantFiles: string[]
): { canSkip: boolean; reason: string; lastGreen?: TestRun } {
  const lastGreen = getLastGreenRun(state, testType)

  if (!lastGreen) {
    return {
      canSkip: false,
      reason: 'No previous successful run found',
    }
  }

  const currentHash = computeFilesHash(currentRelevantFiles)

  if (currentHash === lastGreen.filesHash) {
    return {
      canSkip: true,
      reason: `Files unchanged since last green run at ${lastGreen.commitSha.slice(0, 7)}`,
      lastGreen,
    }
  }

  return {
    canSkip: false,
    reason: `Files changed since last green run at ${lastGreen.commitSha.slice(0, 7)}`,
    lastGreen,
  }
}

/**
 * Get the last selector decision
 */
export function getLastSelectorDecision(state: PRState): SelectorDecision | null {
  if (state.selectorDecisions.length === 0) return null
  return state.selectorDecisions[state.selectorDecisions.length - 1]
}

// ============================================
// FILE UTILITIES
// ============================================

/**
 * Compute a hash of file contents for change detection
 */
export function computeFilesHash(files: string[]): string {
  const hash = createHash('sha256')

  for (const file of files.sort()) {
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, 'utf-8')
        hash.update(`${file}:${content}`)
      } catch {
        hash.update(`${file}:error`)
      }
    } else {
      hash.update(`${file}:missing`)
    }
  }

  return hash.digest('hex').slice(0, 16)
}

/**
 * Get files changed since a specific commit
 */
export function getChangedFilesSince(commitSha: string): string[] {
  try {
    const output = execSync(`git diff --name-only ${commitSha}...HEAD`, {
      encoding: 'utf-8',
    })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Get current commit SHA
 */
export function getCurrentCommitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * Get files changed in this PR (from base branch)
 */
export function getPRChangedFiles(baseBranch: string): string[] {
  // Normalize: strip leading 'origin/' if present to avoid 'origin/origin/main'
  const normalizedBase = baseBranch.replace(/^origin\//, '')

  try {
    const output = execSync(`git diff --name-only origin/${normalizedBase}...HEAD`, {
      encoding: 'utf-8',
    })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    // Fallback to last commit
    try {
      return execSync('git diff --name-only HEAD~1', { encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean)
    } catch {
      return []
    }
  }
}

// ============================================
// TEST TYPE MAPPINGS
// ============================================

/**
 * Define which files are relevant for each test type
 */
export const TEST_RELEVANT_PATTERNS: Record<TestType, string[]> = {
  lint: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  typecheck: ['**/*.ts', '**/*.tsx', 'tsconfig.json'],
  'unit-tests': ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.test.ts'],
  'migration-review': ['supabase/migrations/**/*.sql'],
  'code-review': ['**/*.ts', '**/*.tsx', '**/*.sql'],
  'visual-validation': [
    'src/components/**/*.tsx',
    'src/app/**/*.tsx',
    'src/app/globals.css',
    'tailwind.config.ts',
  ],
  'e2e-tests': [
    'src/app/**/*.tsx',
    'src/components/**/*.tsx',
    'src/lib/**/*.ts',
    'tests/e2e/**/*.ts',
  ],
  'api-tests': [
    'src/app/api/**/*.ts',
    'src/lib/integrations/**/*.ts',
    'tests/api/**/*.ts',
  ],
}

/**
 * Check if a file matches a glob pattern (simplified)
 */
export function matchesPattern(file: string, pattern: string): boolean {
  // Simple glob matching
  const regexPattern = pattern
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\./g, '\\.')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(file)
}

/**
 * Get files relevant to a test type from a list of changed files
 */
export function getRelevantFiles(testType: TestType, changedFiles: string[]): string[] {
  const patterns = TEST_RELEVANT_PATTERNS[testType]
  return changedFiles.filter(file => patterns.some(pattern => matchesPattern(file, pattern)))
}

/**
 * Check if any files relevant to a test type have changed
 */
export function hasRelevantChanges(testType: TestType, changedFiles: string[]): boolean {
  return getRelevantFiles(testType, changedFiles).length > 0
}
