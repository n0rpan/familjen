/**
 * LLM Utilities for Smart CI
 *
 * Shared utilities for:
 * - Cost tracking and estimation
 * - Diff-based caching
 * - Audit trail logging
 * - Feedback loop for selector accuracy
 */

import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const STATE_DIR = 'ci-state'

// ============================================
// COST TRACKING
// ============================================

// Approximate costs per 1M tokens (as of Dec 2024)
// These are estimates - actual costs depend on OpenRouter pricing
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'google/gemini-2.0-flash-001': { input: 0.075, output: 0.30 },
  'google/gemini-2.5-flash-lite': { input: 0.075, output: 0.30 },
  'anthropic/claude-sonnet-4': { input: 3.0, output: 15.0 },
  'anthropic/claude-opus-4': { input: 15.0, output: 75.0 },
  // Default fallback
  '_default': { input: 1.0, output: 3.0 },
}

export interface LLMUsage {
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCostUSD: number
  timestamp: string
  operation: 'selector' | 'verdict' | 'code-review' | 'migration-review' | 'other'
  prNumber?: number
  commitSha?: string
  durationMs: number
}

export interface CostSummary {
  totalCostUSD: number
  totalInputTokens: number
  totalOutputTokens: number
  callCount: number
  byOperation: Record<string, { cost: number; calls: number }>
  byModel: Record<string, { cost: number; calls: number }>
}

/**
 * Calculate estimated cost for an LLM call
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[model] || MODEL_COSTS._default
  const inputCost = (inputTokens / 1_000_000) * costs.input
  const outputCost = (outputTokens / 1_000_000) * costs.output
  return Math.round((inputCost + outputCost) * 10000) / 10000 // Round to 4 decimals
}

/**
 * Record LLM usage for cost tracking
 */
export function recordLLMUsage(usage: LLMUsage): void {
  ensureStateDir()
  const usageFile = join(STATE_DIR, 'llm-usage.jsonl')

  const record = {
    ...usage,
    estimatedCostUSD: calculateCost(usage.model, usage.inputTokens, usage.outputTokens),
  }

  appendFileSync(usageFile, JSON.stringify(record) + '\n')
}

// ============================================
// COST LIMITS
// ============================================

// Maximum cost per CI run before warning/blocking
const MAX_COST_WARNING_USD = 0.50   // Warn at $0.50
const MAX_COST_LIMIT_USD = 2.00     // Block at $2.00

export interface CostLimitResult {
  allowed: boolean
  warning: boolean
  currentCost: number
  limit: number
  message: string
}

/**
 * Check if we're approaching or exceeding cost limits
 * Call this before making expensive LLM calls
 */
export function checkCostLimit(): CostLimitResult {
  const summary = getCostSummary()
  const currentCost = summary.totalCostUSD

  if (currentCost >= MAX_COST_LIMIT_USD) {
    return {
      allowed: false,
      warning: true,
      currentCost,
      limit: MAX_COST_LIMIT_USD,
      message: `Cost limit exceeded: $${currentCost.toFixed(4)} >= $${MAX_COST_LIMIT_USD} limit. ` +
        'This prevents runaway costs from infinite tool loops. ' +
        'If this is expected, increase MAX_COST_LIMIT_USD in llm-utils.ts.',
    }
  }

  if (currentCost >= MAX_COST_WARNING_USD) {
    return {
      allowed: true,
      warning: true,
      currentCost,
      limit: MAX_COST_LIMIT_USD,
      message: `Cost warning: $${currentCost.toFixed(4)} approaching $${MAX_COST_LIMIT_USD} limit. ` +
        `${summary.callCount} LLM calls made so far.`,
    }
  }

  return {
    allowed: true,
    warning: false,
    currentCost,
    limit: MAX_COST_LIMIT_USD,
    message: '',
  }
}

/**
 * Get cost summary for current CI run
 */
export function getCostSummary(): CostSummary {
  const usageFile = join(STATE_DIR, 'llm-usage.jsonl')

  if (!existsSync(usageFile)) {
    return {
      totalCostUSD: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      callCount: 0,
      byOperation: {},
      byModel: {},
    }
  }

  const lines = readFileSync(usageFile, 'utf-8').trim().split('\n').filter(Boolean)
  const summary: CostSummary = {
    totalCostUSD: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    callCount: 0,
    byOperation: {},
    byModel: {},
  }

  for (const line of lines) {
    try {
      const usage = JSON.parse(line) as LLMUsage
      summary.totalCostUSD += usage.estimatedCostUSD
      summary.totalInputTokens += usage.inputTokens
      summary.totalOutputTokens += usage.outputTokens
      summary.callCount++

      // By operation
      if (!summary.byOperation[usage.operation]) {
        summary.byOperation[usage.operation] = { cost: 0, calls: 0 }
      }
      summary.byOperation[usage.operation].cost += usage.estimatedCostUSD
      summary.byOperation[usage.operation].calls++

      // By model
      const modelShort = usage.model.split('/').pop() || usage.model
      if (!summary.byModel[modelShort]) {
        summary.byModel[modelShort] = { cost: 0, calls: 0 }
      }
      summary.byModel[modelShort].cost += usage.estimatedCostUSD
      summary.byModel[modelShort].calls++
    } catch {
      // Skip malformed lines
    }
  }

  // Round totals
  summary.totalCostUSD = Math.round(summary.totalCostUSD * 10000) / 10000

  return summary
}

// ============================================
// DIFF-BASED CACHING
// ============================================

export interface CachedDecision {
  diffHash: string
  timestamp: string
  decisions: unknown
  extendedChecks: unknown
  reasoning: string
  model: string
  // Cache expires after 24 hours (in case prompts change)
  expiresAt: string
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Generate a hash for the diff content
 */
export function hashDiff(diff: string): string {
  return createHash('sha256').update(diff).digest('hex').slice(0, 16)
}

/**
 * Check if we have a cached decision for this diff
 */
export function getCachedDecision(diffHash: string): CachedDecision | null {
  const cacheFile = join(STATE_DIR, 'decision-cache.json')

  if (!existsSync(cacheFile)) {
    return null
  }

  try {
    const cache = JSON.parse(readFileSync(cacheFile, 'utf-8')) as Record<string, CachedDecision>
    const cached = cache[diffHash]

    if (!cached) {
      return null
    }

    // Check if expired
    if (new Date(cached.expiresAt) < new Date()) {
      console.log('   📦 Cache expired, will re-query LLM')
      return null
    }

    return cached
  } catch {
    return null
  }
}

/**
 * Save a decision to cache
 */
export function cacheDecision(
  diffHash: string,
  decisions: unknown,
  extendedChecks: unknown,
  reasoning: string,
  model: string
): void {
  ensureStateDir()
  const cacheFile = join(STATE_DIR, 'decision-cache.json')

  let cache: Record<string, CachedDecision> = {}
  if (existsSync(cacheFile)) {
    try {
      cache = JSON.parse(readFileSync(cacheFile, 'utf-8'))
    } catch {
      cache = {}
    }
  }

  // Clean expired entries
  const now = new Date()
  for (const key of Object.keys(cache)) {
    if (new Date(cache[key].expiresAt) < now) {
      delete cache[key]
    }
  }

  // Add new entry
  cache[diffHash] = {
    diffHash,
    timestamp: now.toISOString(),
    decisions,
    extendedChecks,
    reasoning,
    model,
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
  }

  writeFileSync(cacheFile, JSON.stringify(cache, null, 2))
}

// ============================================
// AUDIT TRAIL
// ============================================

export interface AuditEntry {
  timestamp: string
  type: 'selector' | 'verdict' | 'override' | 'extended-check'
  prNumber?: number
  commitSha: string
  model: string
  decision: string // 'PASS' | 'BLOCK' | test decisions summary
  reasoning: string
  metadata?: Record<string, unknown>
}

/**
 * Log an audit entry for selector/verdict decisions
 */
export function logAuditEntry(entry: AuditEntry): void {
  ensureStateDir()
  const auditFile = join(STATE_DIR, 'audit-trail.jsonl')
  appendFileSync(auditFile, JSON.stringify(entry) + '\n')
}

/**
 * Get audit trail for the current PR
 */
export function getAuditTrail(): AuditEntry[] {
  const auditFile = join(STATE_DIR, 'audit-trail.jsonl')

  if (!existsSync(auditFile)) {
    return []
  }

  const lines = readFileSync(auditFile, 'utf-8').trim().split('\n').filter(Boolean)
  return lines.map(line => {
    try {
      return JSON.parse(line) as AuditEntry
    } catch {
      return null
    }
  }).filter(Boolean) as AuditEntry[]
}

// ============================================
// FEEDBACK LOOP (Selector Accuracy)
// ============================================

export interface SelectorFeedback {
  timestamp: string
  prNumber?: number
  commitSha: string
  selectorModel: string
  selectorDecisions: Array<{ testType: string; enabled: boolean; reason: string }>
  supervisorOverride: {
    from: string
    to: string
    reason: string
  } | null
  // Tests that were skipped but supervisor ran
  additionalTestsRun: string[]
  // Results of additional tests (if any failed, selector was wrong)
  additionalTestResults: Array<{ test: string; passed: boolean }>
  // Overall: was selector correct?
  selectorAccurate: boolean
  // What selector should have done differently
  lesson?: string
}

/**
 * Record selector feedback for accuracy tracking
 */
export function recordSelectorFeedback(feedback: SelectorFeedback): void {
  ensureStateDir()
  const feedbackFile = join(STATE_DIR, 'selector-feedback.jsonl')
  appendFileSync(feedbackFile, JSON.stringify(feedback) + '\n')
}

/**
 * Get selector accuracy stats (for reporting)
 */
export function getSelectorAccuracyStats(): {
  total: number
  accurate: number
  overridden: number
  accuracyRate: number
} {
  const feedbackFile = join(STATE_DIR, 'selector-feedback.jsonl')

  if (!existsSync(feedbackFile)) {
    return { total: 0, accurate: 0, overridden: 0, accuracyRate: 100 }
  }

  const lines = readFileSync(feedbackFile, 'utf-8').trim().split('\n').filter(Boolean)
  let total = 0
  let accurate = 0
  let overridden = 0

  for (const line of lines) {
    try {
      const feedback = JSON.parse(line) as SelectorFeedback
      total++
      if (feedback.selectorAccurate) accurate++
      if (feedback.supervisorOverride) overridden++
    } catch {
      // Skip malformed
    }
  }

  return {
    total,
    accurate,
    overridden,
    accuracyRate: total > 0 ? Math.round((accurate / total) * 100) : 100,
  }
}

// ============================================
// HELPERS
// ============================================

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
}

/**
 * Format cost for display
 */
export function formatCost(costUSD: number): string {
  if (costUSD < 0.01) {
    return `$${(costUSD * 100).toFixed(2)}¢`
  }
  return `$${costUSD.toFixed(4)}`
}

/**
 * Generate a cost summary for PR comment
 */
export function generateCostSummaryMarkdown(): string {
  const summary = getCostSummary()

  if (summary.callCount === 0) {
    return ''
  }

  let md = `### 💰 LLM Cost Summary

| Metric | Value |
|--------|-------|
| Total Cost | ${formatCost(summary.totalCostUSD)} |
| API Calls | ${summary.callCount} |
| Input Tokens | ${summary.totalInputTokens.toLocaleString()} |
| Output Tokens | ${summary.totalOutputTokens.toLocaleString()} |

`

  if (Object.keys(summary.byOperation).length > 1) {
    md += `**By Operation:**\n`
    for (const [op, data] of Object.entries(summary.byOperation)) {
      md += `- ${op}: ${formatCost(data.cost)} (${data.calls} calls)\n`
    }
    md += '\n'
  }

  return md
}
