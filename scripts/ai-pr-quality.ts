/**
 * AI-Powered PR Quality Check
 *
 * Validates PR description, size, and commit messages using AI analysis.
 * Ensures PRs are well-documented and follow best practices.
 *
 * Usage: npx tsx scripts/ai-pr-quality.ts
 */

import { execFileSync } from 'child_process'
import { writeFileSync } from 'fs'
import { AI_MODELS, callOpenRouter, withRetry } from './ai-config'
import {
  ReviewerOutput,
  Finding,
  saveReviewerOutput,
  ensureReviewsDir,
} from './ai-review-types'

// ============================================
// CONFIGURATION
// ============================================

const PR_TITLE = process.env.GITHUB_PR_TITLE || ''
const PR_BODY = process.env.GITHUB_PR_BODY || ''
const PR_NUMBER = process.env.GITHUB_PR_NUMBER || ''
const BASE_REF = process.env.GITHUB_BASE_REF || 'main'

// Thresholds
const MAX_FILES_CHANGED = 30
const MAX_LINES_CHANGED = 1000
const MIN_DESCRIPTION_LENGTH = 50
const MAX_COMMITS = 20

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('📋 AI PR Quality Check')
  console.log('='.repeat(50))
  console.log(`PR #${PR_NUMBER}: ${PR_TITLE}`)
  console.log('')

  const startTime = Date.now()
  ensureReviewsDir()

  try {
    const findings: Finding[] = []

    // Get PR stats
    const stats = getPRStats()
    console.log(`📊 Files changed: ${stats.filesChanged}`)
    console.log(`📊 Lines added: ${stats.linesAdded}`)
    console.log(`📊 Lines removed: ${stats.linesRemoved}`)
    console.log(`📊 Commits: ${stats.commitCount}`)
    console.log('')

    // Check 1: PR Size
    console.log('🔍 Checking PR size...')
    const sizeFindings = checkPRSize(stats)
    findings.push(...sizeFindings)

    // Check 2: PR Description
    console.log('🔍 Checking PR description...')
    const descriptionFindings = checkPRDescription()
    findings.push(...descriptionFindings)

    // Check 3: Commit Messages
    console.log('🔍 Checking commit messages...')
    const commitFindings = await checkCommitMessages(stats.commits)
    findings.push(...commitFindings)

    // Check 4: AI Quality Analysis
    console.log('🧠 Running AI quality analysis...')
    const aiFindings = await runAIAnalysis(stats)
    findings.push(...aiFindings)

    // Determine verdict
    const criticalCount = findings.filter(f => f.severity === 'critical').length
    const warningCount = findings.filter(f => f.severity === 'warning').length
    const verdict = criticalCount > 0 ? 'FAIL' : warningCount > 0 ? 'WARN' : 'PASS'

    const output: ReviewerOutput = {
      reviewer: 'pr-quality' as any,
      model: AI_MODELS.fast,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'completed',
      verdict,
      confidence: 90,
      findings,
      summary: generateSummary(findings, stats),
    }

    saveReviewerOutput(output)

    console.log(`\n${verdict === 'PASS' ? '✅' : verdict === 'WARN' ? '⚠️' : '❌'} Verdict: ${verdict}`)

  } catch (error) {
    console.error('❌ PR quality check failed:', error)
    const output: ReviewerOutput = {
      reviewer: 'pr-quality' as any,
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'failed',
      verdict: 'ERROR',
      confidence: 0,
      findings: [{
        severity: 'critical',
        category: 'code-quality',
        message: `PR quality check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      summary: 'PR quality check encountered an error.',
    }
    saveReviewerOutput(output)
    process.exit(1)
  }
}

// ============================================
// HELPERS
// ============================================

interface PRStats {
  filesChanged: number
  linesAdded: number
  linesRemoved: number
  commitCount: number
  commits: string[]
  changedFiles: string[]
}

function getPRStats(): PRStats {
  // Get file stats
  let diffStat = ''
  try {
    diffStat = execFileSync('git', ['diff', '--stat', `origin/${BASE_REF}...HEAD`], {
      encoding: 'utf-8',
    })
  } catch {
    diffStat = execFileSync('git', ['diff', '--stat', 'HEAD~1'], {
      encoding: 'utf-8',
    })
  }

  // Parse stats
  const statMatch = diffStat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/)
  const filesChanged = statMatch ? parseInt(statMatch[1], 10) : 0
  const linesAdded = statMatch && statMatch[2] ? parseInt(statMatch[2], 10) : 0
  const linesRemoved = statMatch && statMatch[3] ? parseInt(statMatch[3], 10) : 0

  // Get commits
  let commitsOutput = ''
  try {
    commitsOutput = execFileSync('git', ['log', '--oneline', `origin/${BASE_REF}...HEAD`], {
      encoding: 'utf-8',
    })
  } catch {
    commitsOutput = execFileSync('git', ['log', '--oneline', '-10'], {
      encoding: 'utf-8',
    })
  }
  const commits = commitsOutput.trim().split('\n').filter(Boolean)

  // Get changed files
  let filesOutput = ''
  try {
    filesOutput = execFileSync('git', ['diff', '--name-only', `origin/${BASE_REF}...HEAD`], {
      encoding: 'utf-8',
    })
  } catch {
    filesOutput = execFileSync('git', ['diff', '--name-only', 'HEAD~1'], {
      encoding: 'utf-8',
    })
  }
  const changedFiles = filesOutput.trim().split('\n').filter(Boolean)

  return {
    filesChanged,
    linesAdded,
    linesRemoved,
    commitCount: commits.length,
    commits,
    changedFiles,
  }
}

function checkPRSize(stats: PRStats): Finding[] {
  const findings: Finding[] = []
  const totalLines = stats.linesAdded + stats.linesRemoved

  if (stats.filesChanged > MAX_FILES_CHANGED) {
    findings.push({
      severity: 'warning',
      category: 'code-quality',
      message: `PR modifies ${stats.filesChanged} files (recommended max: ${MAX_FILES_CHANGED}). Consider splitting into smaller PRs for easier review.`,
    })
  }

  if (totalLines > MAX_LINES_CHANGED) {
    findings.push({
      severity: 'warning',
      category: 'code-quality',
      message: `PR has ${totalLines} lines changed (recommended max: ${MAX_LINES_CHANGED}). Large PRs are harder to review thoroughly.`,
    })
  }

  if (stats.commitCount > MAX_COMMITS) {
    findings.push({
      severity: 'info',
      category: 'code-quality',
      message: `PR has ${stats.commitCount} commits. Consider squashing related commits for a cleaner history.`,
    })
  }

  return findings
}

function checkPRDescription(): Finding[] {
  const findings: Finding[] = []

  if (!PR_BODY || PR_BODY.trim().length < MIN_DESCRIPTION_LENGTH) {
    findings.push({
      severity: 'warning',
      category: 'code-quality',
      message: `PR description is too short or missing. Please add a meaningful description explaining what this PR does and why.`,
    })
  }

  // Check for required sections
  const hasWhatSection = /##?\s*(?:what|summary|overview|changes)/i.test(PR_BODY)
  const hasWhySection = /##?\s*(?:why|motivation|reason|context)/i.test(PR_BODY)
  const hasTestSection = /##?\s*(?:test|testing|how to test|verification)/i.test(PR_BODY)

  if (!hasWhatSection && PR_BODY.length > 0) {
    findings.push({
      severity: 'info',
      category: 'code-quality',
      message: 'Consider adding a "## Summary" or "## What" section to describe changes.',
    })
  }

  if (!hasTestSection && PR_BODY.length > 0) {
    findings.push({
      severity: 'info',
      category: 'code-quality',
      message: 'Consider adding a "## Test plan" section to describe how changes were tested.',
    })
  }

  // Check title format
  if (PR_TITLE.length < 10) {
    findings.push({
      severity: 'warning',
      category: 'code-quality',
      message: 'PR title is too short. Use a descriptive title that summarizes the changes.',
    })
  }

  if (PR_TITLE.length > 72) {
    findings.push({
      severity: 'info',
      category: 'code-quality',
      message: 'PR title exceeds 72 characters. Consider shortening for better readability.',
    })
  }

  return findings
}

async function checkCommitMessages(commits: string[]): Promise<Finding[]> {
  const findings: Finding[] = []

  for (const commit of commits.slice(0, 10)) { // Check first 10 commits
    const message = commit.replace(/^[a-f0-9]+\s+/, '') // Remove hash

    // Check for conventional commit format (optional but recommended)
    const hasConventionalPrefix = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?!?:/.test(message)

    // Check for WIP commits
    if (/^(wip|WIP|fixup|squash)/.test(message)) {
      findings.push({
        severity: 'warning',
        category: 'code-quality',
        message: `Commit "${message.slice(0, 50)}..." appears to be a work-in-progress. Consider squashing before merge.`,
      })
    }

    // Check for very short messages
    if (message.length < 10) {
      findings.push({
        severity: 'info',
        category: 'code-quality',
        message: `Commit message "${message}" is very short. Consider using more descriptive messages.`,
      })
    }
  }

  return findings
}

async function runAIAnalysis(stats: PRStats): Promise<Finding[]> {
  const model = AI_MODELS.fast

  const prompt = `You are a code review assistant analyzing a pull request for quality.

## PR Details
- Title: ${PR_TITLE}
- Description:
${PR_BODY || '(No description provided)'}

## PR Stats
- Files changed: ${stats.filesChanged}
- Lines added: ${stats.linesAdded}
- Lines removed: ${stats.linesRemoved}
- Commits: ${stats.commitCount}

## Changed Files
${stats.changedFiles.slice(0, 30).join('\n')}
${stats.changedFiles.length > 30 ? `... and ${stats.changedFiles.length - 30} more files` : ''}

## Commits
${stats.commits.slice(0, 10).join('\n')}
${stats.commits.length > 10 ? `... and ${stats.commits.length - 10} more commits` : ''}

## Your Task
Analyze this PR for quality issues. Consider:

1. **Coherence**: Do the changes form a logical, cohesive unit?
2. **Scope**: Is the PR focused or trying to do too many things?
3. **Description quality**: Does the description explain the what and why?
4. **Breaking changes**: Are there signs of breaking changes that should be called out?
5. **Documentation**: Should this PR update docs (README, CLAUDE.md)?

## Response Format
Return a JSON array of findings. Each finding must have:
- severity: "critical" | "warning" | "info"
- category: "code-quality"
- message: Clear, actionable feedback

Only report meaningful issues. Return [] if the PR looks good.

Example:
[
  {
    "severity": "warning",
    "category": "code-quality",
    "message": "PR includes both feature work and unrelated refactoring. Consider splitting into separate PRs."
  }
]

Return only the JSON array, no other text.`

  try {
    const response = await withRetry(
      () => callOpenRouter(model, [{ role: 'user', content: prompt }], {
        temperature: 0,
        maxTokens: 2000,
      }),
      'AI PR quality analysis'
    )

    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      severity: string
      category: string
      message: string
    }>

    return parsed.map(f => ({
      severity: f.severity as 'critical' | 'warning' | 'info',
      category: 'code-quality' as const,
      message: f.message,
    }))

  } catch (error) {
    console.error('AI analysis failed:', error)
    return []
  }
}

function generateSummary(findings: Finding[], stats: PRStats): string {
  const critical = findings.filter(f => f.severity === 'critical').length
  const warning = findings.filter(f => f.severity === 'warning').length

  if (critical > 0) {
    return `🚨 Found ${critical} critical PR quality issue(s). Please address before merge.`
  } else if (warning > 0) {
    return `⚠️ Found ${warning} PR quality suggestion(s). PR has ${stats.filesChanged} files and ${stats.linesAdded + stats.linesRemoved} lines changed.`
  } else {
    return `✅ PR quality looks good! ${stats.filesChanged} files changed, ${stats.commitCount} commits.`
  }
}

// Run
main()
