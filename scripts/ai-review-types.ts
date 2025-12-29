/**
 * Shared Types for AI Review System
 *
 * All AI reviewers output in this standardized format.
 * The final verdict script aggregates these outputs to make decisions.
 *
 * Design principles:
 * - Reviewers INFORM, they don't BLOCK
 * - Only the final verdict can fail the CI
 * - Output must be actionable for both humans and AI agents
 */

// ============================================
// REVIEWER OUTPUT FORMAT
// ============================================

/**
 * Standardized output format for all reviewers.
 * Each reviewer saves this as JSON to ai-reviews/<reviewer>.json
 */
export interface ReviewerOutput {
  // Metadata
  reviewer: ReviewerType
  model: string                 // Model used (for transparency)
  timestamp: string             // ISO timestamp
  duration_ms: number           // How long the review took
  status: 'completed' | 'failed' | 'skipped'

  // Reviewer's opinion (informational, not blocking)
  verdict: ReviewerVerdict
  confidence: number            // 0-100, how confident is the reviewer

  // Categorized findings
  findings: Finding[]

  // Human-readable summary
  summary: string

  // Optional: raw data for debugging
  raw?: unknown
}

export type ReviewerType =
  | 'code-review'
  | 'migration-review'
  | 'visual-validation'
  | 'api-tests'
  | 'e2e-tests'         // UAT on demo/mock data
  | 'demo-quality'
  | 'security-review'   // AI security scanner
  | 'dependency-review' // AI dependency analysis
  | 'pr-quality'        // PR description, size, commits
  | 'bundle-size'       // Bundle size tracking

export type ReviewerVerdict =
  | 'PASS'              // No issues found
  | 'WARN'              // Non-blocking issues found
  | 'FAIL'              // Blocking issues found (but doesn't block CI)
  | 'ERROR'             // Reviewer itself failed

// ============================================
// FINDINGS
// ============================================

export interface Finding {
  severity: 'critical' | 'warning' | 'info'
  category: IssueCategory
  message: string

  // Location (if applicable)
  file?: string
  line?: number
  endLine?: number

  // For test failures
  testName?: string
  error?: string

  // For demo quality issues
  endpoint?: string
  field?: string
  expected?: string
  actual?: string
  migrationRef?: string
}

export type IssueCategory =
  | 'security'           // Auth, injection, secrets
  | 'data-integrity'     // Error handling, RLS, validation
  | 'runtime-error'      // Crashes, null pointers, missing imports
  | 'migration'          // Database schema issues
  | 'api-contract'       // Breaking changes
  | 'i18n'               // Missing translations
  | 'accessibility'      // UI/UX issues
  | 'performance'        // Slow queries, missing indexes
  | 'code-quality'       // Style, patterns, best practices
  | 'test-failure'       // Test didn't pass
  | 'demo-quality'       // Demo data issues
  | 'intent-mismatch'    // PR intent not visible in UI
  | 'intent-verified'    // PR intent confirmed in UI

// ============================================
// FINAL VERDICT OUTPUT
// ============================================

/**
 * Output format for the final verdict.
 * This is what gets posted to the PR and saved as final-verdict.json
 */
export interface FinalVerdictOutput {
  verdict: 'PASS' | 'BLOCK'
  confidence: number            // 0-100
  summary: string               // 1-2 sentences

  // Verification results from tools
  verifications: VerificationResults

  // Blocking issues that MUST be fixed
  requiredFixes: ActionableIssue[]

  // Non-blocking suggestions
  suggestions: ActionableIssue[]

  // Context for why this decision was made
  reasoning: string

  // Aggregated reviewer results
  reviewerSummary: ReviewerSummary[]

  // AI override info (when AI disagrees with mechanical aggregation)
  aiOverride?: {
    from: string    // Original mechanical verdict
    to: string      // AI's verdict
    reason: string  // Why AI overrode
  }
}

export interface VerificationResults {
  typecheck: VerificationStatus
  apiHealth: VerificationStatus
  migrationSafety: VerificationStatus
  rlsCoverage: VerificationStatus
  authRequired: VerificationStatus
  demoQuality: VerificationStatus
}

export type VerificationStatus = 'pass' | 'fail' | 'warn' | 'skipped'

export interface ReviewerSummary {
  reviewer: ReviewerType
  verdict: ReviewerVerdict
  confidence: number
  criticalCount: number
  warningCount: number
  infoCount: number
}

// ============================================
// ACTIONABLE ISSUES
// ============================================

/**
 * An issue with enough context for humans or AI agents to fix it.
 */
export interface ActionableIssue {
  priority: number              // 1 = fix first, 2 = fix second, etc.
  severity: 'critical' | 'warning' | 'info'
  category: IssueCategory

  // Location
  file: string
  line?: number
  endLine?: number              // For multi-line issues

  // Description
  issue: string                 // What's wrong
  whyItMatters: string          // Impact on users

  // How to fix it
  fix: Fix

  // Reference for learning
  reference?: {
    file: string                // Example of correct pattern
    line: number
    description: string
  }
}

export interface Fix {
  type: 'replace' | 'insert_before' | 'insert_after' | 'delete' | 'wrap'

  // For 'replace': what to find and what to replace with
  oldCode?: string
  newCode?: string

  // For 'insert_before' / 'insert_after': code to add
  code?: string

  // For 'wrap': wrapper template with {{content}} placeholder
  wrapper?: string

  // Human explanation
  explanation: string
}

// ============================================
// ROLLBACK MIGRATIONS
// ============================================

export interface RollbackMigration {
  originalFile: string          // e.g., "20251220_add_allergies.sql"
  rollbackSql: string           // Generated reverse SQL
  isReversible: boolean         // Can this be safely rolled back?
  warnings: string[]            // e.g., ["Data loss: allergies column will be dropped"]
  generatedAt: string           // ISO timestamp
  generatedBy: string           // Model that generated it
}

// ============================================
// DEMO QUALITY
// ============================================

export interface DemoQualityResult {
  endpointsTested: number
  issues: DemoIssue[]
  coverage: {
    // Does demo data cover all fields in the type?
    typeCoverage: Record<string, number>  // e.g., { "Child": 100, "Pickup": 85 }
  }
}

export interface DemoIssue {
  endpoint: string
  issue: 'missing_field' | 'wrong_type' | 'stale_pattern' | 'unrealistic_data'
  field?: string
  expected?: string
  actual?: string
  migrationRef?: string         // "Added in migration 20251220_add_allergies.sql"
}

// ============================================
// HELPER FUNCTIONS
// ============================================

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const REVIEWS_DIR = 'ai-reviews'

/**
 * Ensure the ai-reviews directory exists
 */
export function ensureReviewsDir(): void {
  if (!existsSync(REVIEWS_DIR)) {
    mkdirSync(REVIEWS_DIR, { recursive: true })
  }
}

/**
 * Save a reviewer's output to the standard location
 */
export function saveReviewerOutput(output: ReviewerOutput): void {
  ensureReviewsDir()
  const filename = join(REVIEWS_DIR, `${output.reviewer}.json`)
  writeFileSync(filename, JSON.stringify(output, null, 2))
  console.log(`📄 Saved: ${filename}`)
}

/**
 * Load all reviewer outputs from the ai-reviews directory
 */
export function loadAllReviewerOutputs(): Record<string, ReviewerOutput> {
  if (!existsSync(REVIEWS_DIR)) {
    return {}
  }

  const reviews: Record<string, ReviewerOutput> = {}
  for (const file of readdirSync(REVIEWS_DIR)) {
    if (file.endsWith('.json') && !file.startsWith('final-')) {
      const name = file.replace('.json', '')
      try {
        const parsed = JSON.parse(readFileSync(join(REVIEWS_DIR, file), 'utf-8'))
        // Ensure findings is always an array (defensive against malformed JSON)
        reviews[name] = {
          ...parsed,
          findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse ${file}: ${e}`)
      }
    }
  }
  return reviews
}

/**
 * Save the final verdict output
 */
export function saveFinalVerdict(output: FinalVerdictOutput): void {
  ensureReviewsDir()
  const filename = join(REVIEWS_DIR, 'final-verdict.json')
  writeFileSync(filename, JSON.stringify(output, null, 2))
  console.log(`📄 Saved: ${filename}`)
}

/**
 * Save a rollback migration
 */
export function saveRollbackMigration(rollback: RollbackMigration): void {
  const dir = join(REVIEWS_DIR, 'rollback-migrations')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const filename = join(dir, `rollback-${rollback.originalFile}`)
  writeFileSync(filename, rollback.rollbackSql)
  writeFileSync(filename + '.meta.json', JSON.stringify({
    originalFile: rollback.originalFile,
    isReversible: rollback.isReversible,
    warnings: rollback.warnings,
    generatedAt: rollback.generatedAt,
    generatedBy: rollback.generatedBy,
  }, null, 2))
  console.log(`📄 Saved rollback: ${filename}`)
}

/**
 * Create a summary of reviewer results for the final verdict
 */
export function summarizeReviewer(output: ReviewerOutput): ReviewerSummary {
  return {
    reviewer: output.reviewer,
    verdict: output.verdict,
    confidence: output.confidence,
    criticalCount: output.findings.filter(f => f.severity === 'critical').length,
    warningCount: output.findings.filter(f => f.severity === 'warning').length,
    infoCount: output.findings.filter(f => f.severity === 'info').length,
  }
}

/**
 * Generate a human-readable emoji for a verdict
 */
export function verdictEmoji(verdict: ReviewerVerdict | 'PASS' | 'BLOCK'): string {
  switch (verdict) {
    case 'PASS': return '✅'
    case 'WARN': return '⚠️'
    case 'FAIL': return '❌'
    case 'BLOCK': return '🚫'
    case 'ERROR': return '💥'
    default: return '❓'
  }
}

/**
 * Generate a human-readable emoji for a category
 */
export function categoryEmoji(category: IssueCategory): string {
  switch (category) {
    case 'security': return '🔒'
    case 'data-integrity': return '💾'
    case 'runtime-error': return '💥'
    case 'migration': return '🗄️'
    case 'api-contract': return '📋'
    case 'i18n': return '🌐'
    case 'accessibility': return '♿'
    case 'performance': return '⚡'
    case 'code-quality': return '✨'
    case 'test-failure': return '🧪'
    case 'demo-quality': return '🎭'
    default: return '📝'
  }
}
