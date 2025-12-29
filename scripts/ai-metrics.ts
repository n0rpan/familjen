/**
 * AI Metrics Tracking
 *
 * Tracks cost, accuracy, and performance metrics for AI-powered CI.
 * Stores data in ci-state/ for trend analysis and dashboard display.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// ============================================
// TYPES
// ============================================

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface APICall {
  timestamp: string
  model: string
  operation: string
  tokens: TokenUsage
  cost_usd: number
  duration_ms: number
  success: boolean
}

export interface PRMetrics {
  pr_number: number
  pr_title: string
  timestamp: string
  total_cost_usd: number
  total_tokens: number
  api_calls: APICall[]
  verdict: 'PASS' | 'BLOCK' | 'ERROR'
  accuracy?: {
    // Filled in later when PR is merged/closed
    actual_outcome: 'merged' | 'closed' | 'reverted' | null
    was_correct: boolean | null
  }
  labels_suggested: string[]
  labels_applied: string[]
}

export interface TrendData {
  last_updated: string
  total_prs_reviewed: number
  total_cost_usd: number
  average_cost_per_pr: number
  accuracy_rate: number // % of correct verdicts
  cost_trend: Array<{
    date: string
    cost_usd: number
    pr_count: number
  }>
  model_usage: Record<string, {
    calls: number
    tokens: number
    cost_usd: number
  }>
}

// ============================================
// COST CALCULATION
// ============================================

// OpenRouter pricing (per 1M tokens) - Update as needed
// Source: https://openrouter.ai/docs/pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Google
  'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-flash-preview': { input: 0.15, output: 0.60 },
  'google/gemini-2.5-flash-lite': { input: 0.075, output: 0.30 },
  // Anthropic
  'anthropic/claude-sonnet-4': { input: 3.00, output: 15.00 },
  'anthropic/claude-opus-4': { input: 15.00, output: 75.00 },
  'anthropic/claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  // OpenAI
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  // Default fallback
  'default': { input: 1.00, output: 4.00 },
}

export function calculateCost(model: string, tokens: TokenUsage): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default']
  const inputCost = (tokens.prompt_tokens / 1_000_000) * pricing.input
  const outputCost = (tokens.completion_tokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}

// ============================================
// METRICS STORAGE
// ============================================

const METRICS_DIR = 'ci-state'
const CURRENT_PR_FILE = 'pr-metrics.json'
const TREND_FILE = 'trend-data.json'
const HISTORY_FILE = 'pr-history.json'

function ensureMetricsDir(): void {
  if (!existsSync(METRICS_DIR)) {
    mkdirSync(METRICS_DIR, { recursive: true })
  }
}

// Current PR metrics (reset per PR)
let currentPRMetrics: PRMetrics | null = null

export function initPRMetrics(prNumber: number, prTitle: string): void {
  ensureMetricsDir()
  currentPRMetrics = {
    pr_number: prNumber,
    pr_title: prTitle,
    timestamp: new Date().toISOString(),
    total_cost_usd: 0,
    total_tokens: 0,
    api_calls: [],
    verdict: 'ERROR',
    labels_suggested: [],
    labels_applied: [],
  }
}

export function recordAPICall(call: Omit<APICall, 'timestamp'>): void {
  if (!currentPRMetrics) {
    console.warn('PR metrics not initialized, call initPRMetrics first')
    return
  }

  const fullCall: APICall = {
    ...call,
    timestamp: new Date().toISOString(),
  }

  currentPRMetrics.api_calls.push(fullCall)
  currentPRMetrics.total_cost_usd += call.cost_usd
  currentPRMetrics.total_tokens += call.tokens.total_tokens
}

export function setVerdict(verdict: 'PASS' | 'BLOCK' | 'ERROR'): void {
  if (currentPRMetrics) {
    currentPRMetrics.verdict = verdict
  }
}

export function setSuggestedLabels(labels: string[]): void {
  if (currentPRMetrics) {
    currentPRMetrics.labels_suggested = labels
  }
}

export function setAppliedLabels(labels: string[]): void {
  if (currentPRMetrics) {
    currentPRMetrics.labels_applied = labels
  }
}

export function savePRMetrics(): PRMetrics | null {
  if (!currentPRMetrics) return null

  ensureMetricsDir()
  writeFileSync(
    join(METRICS_DIR, CURRENT_PR_FILE),
    JSON.stringify(currentPRMetrics, null, 2)
  )
  console.log(`📊 Saved PR metrics: $${currentPRMetrics.total_cost_usd.toFixed(4)} total cost`)
  return currentPRMetrics
}

export function loadPRMetrics(): PRMetrics | null {
  const path = join(METRICS_DIR, CURRENT_PR_FILE)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

// ============================================
// TREND DATA
// ============================================

export function loadTrendData(): TrendData {
  const path = join(METRICS_DIR, TREND_FILE)
  if (!existsSync(path)) {
    return {
      last_updated: new Date().toISOString(),
      total_prs_reviewed: 0,
      total_cost_usd: 0,
      average_cost_per_pr: 0,
      accuracy_rate: 100,
      cost_trend: [],
      model_usage: {},
    }
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return loadTrendData() // Return default
  }
}

export function updateTrendData(prMetrics: PRMetrics): void {
  const trend = loadTrendData()

  // Update totals
  trend.total_prs_reviewed += 1
  trend.total_cost_usd += prMetrics.total_cost_usd
  trend.average_cost_per_pr = trend.total_cost_usd / trend.total_prs_reviewed
  trend.last_updated = new Date().toISOString()

  // Update daily cost trend
  const today = new Date().toISOString().split('T')[0]
  const todayEntry = trend.cost_trend.find(e => e.date === today)
  if (todayEntry) {
    todayEntry.cost_usd += prMetrics.total_cost_usd
    todayEntry.pr_count += 1
  } else {
    trend.cost_trend.push({
      date: today,
      cost_usd: prMetrics.total_cost_usd,
      pr_count: 1,
    })
  }

  // Keep only last 30 days
  trend.cost_trend = trend.cost_trend.slice(-30)

  // Update model usage
  for (const call of prMetrics.api_calls) {
    if (!trend.model_usage[call.model]) {
      trend.model_usage[call.model] = { calls: 0, tokens: 0, cost_usd: 0 }
    }
    trend.model_usage[call.model].calls += 1
    trend.model_usage[call.model].tokens += call.tokens.total_tokens
    trend.model_usage[call.model].cost_usd += call.cost_usd
  }

  ensureMetricsDir()
  writeFileSync(join(METRICS_DIR, TREND_FILE), JSON.stringify(trend, null, 2))
}

// ============================================
// PR HISTORY (for accuracy tracking)
// ============================================

interface PRHistoryEntry {
  pr_number: number
  pr_title: string
  timestamp: string
  verdict: 'PASS' | 'BLOCK' | 'ERROR'
  actual_outcome: 'merged' | 'closed' | 'reverted' | null
  cost_usd: number
}

export function loadPRHistory(): PRHistoryEntry[] {
  const path = join(METRICS_DIR, HISTORY_FILE)
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return []
  }
}

export function addToPRHistory(prMetrics: PRMetrics): void {
  const history = loadPRHistory()

  // Check if PR already exists (update it)
  const existing = history.findIndex(h => h.pr_number === prMetrics.pr_number)
  const entry: PRHistoryEntry = {
    pr_number: prMetrics.pr_number,
    pr_title: prMetrics.pr_title,
    timestamp: prMetrics.timestamp,
    verdict: prMetrics.verdict,
    actual_outcome: null, // Will be updated later
    cost_usd: prMetrics.total_cost_usd,
  }

  if (existing >= 0) {
    history[existing] = { ...history[existing], ...entry }
  } else {
    history.push(entry)
  }

  // Keep last 100 PRs
  const trimmed = history.slice(-100)

  ensureMetricsDir()
  writeFileSync(join(METRICS_DIR, HISTORY_FILE), JSON.stringify(trimmed, null, 2))
}

export function updatePROutcome(prNumber: number, outcome: 'merged' | 'closed' | 'reverted'): void {
  const history = loadPRHistory()
  const entry = history.find(h => h.pr_number === prNumber)
  if (entry) {
    entry.actual_outcome = outcome

    // Calculate accuracy
    const trend = loadTrendData()
    const withOutcomes = history.filter(h => h.actual_outcome !== null)
    const correct = withOutcomes.filter(h => {
      if (h.verdict === 'PASS' && h.actual_outcome === 'merged') return true
      if (h.verdict === 'BLOCK' && (h.actual_outcome === 'closed' || h.actual_outcome === 'reverted')) return true
      return false
    })
    trend.accuracy_rate = withOutcomes.length > 0
      ? (correct.length / withOutcomes.length) * 100
      : 100

    ensureMetricsDir()
    writeFileSync(join(METRICS_DIR, HISTORY_FILE), JSON.stringify(history, null, 2))
    writeFileSync(join(METRICS_DIR, TREND_FILE), JSON.stringify(trend, null, 2))
  }
}

// ============================================
// SUMMARY FOR DASHBOARD
// ============================================

export interface DashboardSummary {
  current_pr: PRMetrics | null
  trend: TrendData
  recent_prs: PRHistoryEntry[]
}

export function getDashboardSummary(): DashboardSummary {
  return {
    current_pr: loadPRMetrics(),
    trend: loadTrendData(),
    recent_prs: loadPRHistory().slice(-10).reverse(),
  }
}

// ============================================
// WRAPPED API CALL (tracks metrics automatically)
// ============================================

export interface TrackedAPIResponse {
  content: string
  usage: TokenUsage
  cost_usd: number
}

/**
 * Make an API call with automatic metrics tracking.
 * Use this instead of callOpenRouter for full tracking.
 */
export async function trackedAPICall(
  model: string,
  operation: string,
  apiCallFn: () => Promise<Response>
): Promise<TrackedAPIResponse> {
  const startTime = Date.now()

  try {
    const response = await apiCallFn()

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    const usage: TokenUsage = data.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    }
    const cost_usd = calculateCost(model, usage)

    // Record the call
    recordAPICall({
      model,
      operation,
      tokens: usage,
      cost_usd,
      duration_ms: Date.now() - startTime,
      success: true,
    })

    return { content, usage, cost_usd }
  } catch (error) {
    // Record failed call
    recordAPICall({
      model,
      operation,
      tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      success: false,
    })
    throw error
  }
}
