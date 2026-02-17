#!/usr/bin/env npx tsx
/**
 * AI-Powered Code Review (Dual-Model)
 *
 * Reviews PR changes using TWO models for comprehensive coverage:
 * - FAST model: Quick check, often different vendor perspective
 * - CAPABLE model: Thorough analysis with deeper reasoning
 *
 * IMPORTANT: This script is NON-BLOCKING.
 * - It reports findings but does NOT fail the CI
 * - Only the final verdict script can block PRs
 * - Exit 0 = review completed (even if issues found)
 * - Exit 1 = script itself failed (API error, couldn't run)
 *
 * Checks for:
 * - Security issues (auth, RLS, injection)
 * - Data integrity (error handling, rollback)
 * - Norwegian app specifics (i18n, colors)
 * - AI agent detection (hallucinated imports, placeholders)
 * - Code quality (TypeScript, patterns)
 *
 * Usage:
 *   npx tsx scripts/ai-code-review.ts
 *   npx tsx scripts/ai-code-review.ts --base origin/main
 *   npx tsx scripts/ai-code-review.ts --single capable  # Use only one model
 */

import { execSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { AI_MODELS, callOpenRouterStructured, SCHEMAS, type CodeReviewResult } from './ai-config'
import {
  type ReviewerOutput,
  type Finding,
  saveReviewerOutput,
  verdictEmoji,
  categoryEmoji,
} from './ai-review-types'

interface DualReviewResult {
  fast: CodeReviewResult | null
  capable: CodeReviewResult | null
  combinedVerdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
}

function getSingleModelMode(): 'fast' | 'capable' | null {
  const args = process.argv.slice(2)
  const singleIdx = args.indexOf('--single')
  if (singleIdx !== -1 && args[singleIdx + 1]) {
    const mode = args[singleIdx + 1].toLowerCase()
    if (mode === 'fast' || mode === 'capable') {
      return mode
    }
  }
  return null
}

function getBaseBranch(): string {
  const args = process.argv.slice(2)
  const baseIdx = args.indexOf('--base')
  if (baseIdx !== -1 && args[baseIdx + 1]) {
    return args[baseIdx + 1]
  }
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`
  }
  return 'origin/main'
}

function ensureBaseBranchFetched(baseBranch: string): void {
  try {
    const remote = baseBranch.split('/')[0] || 'origin'
    const branch = baseBranch.replace(`${remote}/`, '')
    console.log(`Fetching ${remote}/${branch}...`)
    // Use --unshallow if we have a shallow clone, otherwise full fetch
    // This ensures git merge-base can find the common ancestor
    try {
      execSync(`git fetch --unshallow ${remote} ${branch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    } catch {
      // Already unshallowed or not a shallow clone, do regular fetch
      execSync(`git fetch ${remote} ${branch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    }
  } catch (error) {
    console.warn(`Warning: Could not fetch base branch: ${error instanceof Error ? error.message : 'Unknown'}`)
  }
}

function getDiff(baseBranch: string): string {
  ensureBaseBranchFetched(baseBranch)

  try {
    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
      encoding: 'utf-8',
    }).trim()
    console.log(`Merge base: ${mergeBase.slice(0, 8)}`)

    return execSync(`git diff ${mergeBase}...HEAD`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
    })
  } catch (error) {
    console.warn(`Warning: Could not get diff from ${baseBranch}, falling back to HEAD~1`)
    return execSync('git diff HEAD~1', {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
  }
}

function getChangedFiles(baseBranch: string): string[] {
  try {
    return execSync(`git diff --name-only ${baseBranch}...HEAD`, { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return execSync('git diff --name-only HEAD~1', { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean)
  }
}

function getDocumentation(): { claudeMd: string; readmeMd: string } {
  const claudeMd = existsSync('CLAUDE.md') ? readFileSync('CLAUDE.md', 'utf-8') : ''
  const readmeMd = existsSync('README.md') ? readFileSync('README.md', 'utf-8') : ''
  return { claudeMd, readmeMd }
}

// Smart truncation helper - truncate with metadata about what's cut
function smartTruncate(content: string, maxChars: number, label: string): { text: string; wasTruncated: boolean; totalChars: number } {
  if (content.length <= maxChars) {
    return { text: content, wasTruncated: false, totalChars: content.length }
  }
  const truncated = content.slice(0, maxChars)
  // Try to cut at a newline for cleaner truncation
  const lastNewline = truncated.lastIndexOf('\n')
  const cutPoint = lastNewline > maxChars * 0.8 ? lastNewline : maxChars

  return {
    text: truncated.slice(0, cutPoint) + `\n\n... [${label} truncated: ${Math.round((content.length - cutPoint) / 1024)}KB more available]`,
    wasTruncated: true,
    totalChars: content.length
  }
}

// Security-critical file patterns - these should NEVER be truncated
const SECURITY_CRITICAL_PATTERNS = [
  /\/auth/i,                    // Auth handlers
  /\/rls/i,                     // RLS policies
  /credential/i,                // Credential handlers
  /middleware\.ts$/,            // Middleware (auth checks) - legacy
  /proxy\.ts$/,                 // Proxy (auth checks) - Next.js 16+
  /supabase\/migrations\//,     // Database migrations
  /password/i,                  // Password handling
  /encrypt|decrypt/i,           // Encryption
  /api-key|apikey|secret/i,     // API keys/secrets
]

function isSecurityCriticalFile(file: string): boolean {
  return SECURITY_CRITICAL_PATTERNS.some(pattern => pattern.test(file))
}

/**
 * Split a unified diff into per-file chunks
 * Returns a map of filename -> diff content
 */
function splitDiffByFile(diff: string): Map<string, string> {
  const result = new Map<string, string>()
  const lines = diff.split('\n')
  let currentFile = ''
  let currentChunk: string[] = []

  for (const line of lines) {
    // Match diff --git a/path/to/file b/path/to/file
    const fileMatch = line.match(/^diff --git a\/(.+?) b\//)
    if (fileMatch) {
      // Save previous file if exists
      if (currentFile && currentChunk.length > 0) {
        result.set(currentFile, currentChunk.join('\n'))
      }
      currentFile = fileMatch[1]
      currentChunk = [line]
    } else {
      currentChunk.push(line)
    }
  }

  // Save last file
  if (currentFile && currentChunk.length > 0) {
    result.set(currentFile, currentChunk.join('\n'))
  }

  return result
}

function buildReviewPrompt(diff: string, changedFiles: string[], docs: { claudeMd: string; readmeMd: string }): string {
  // Smart truncation limits (balance cost vs context)
  const MAX_DIFF_CHARS = 100000      // ~100KB diff - most PRs fit
  const MAX_DOC_CHARS = 15000        // ~15KB per doc - key sections fit
  const MAX_FILES_SHOWN = 100

  // Track what was truncated for AI awareness
  const truncationInfo: string[] = []

  // Identify security-critical files in this PR - these are NEVER truncated
  const securityFiles = changedFiles.filter(isSecurityCriticalFile)
  if (securityFiles.length > 0) {
    console.log(`🔒 Security-critical files detected (will NOT be truncated): ${securityFiles.join(', ')}`)
  }

  // Split diff by file to preserve security-critical files in full
  const diffByFile = splitDiffByFile(diff)

  // Separate security-critical diffs from regular diffs
  let securityDiff = ''
  let regularDiff = ''

  for (const [file, content] of diffByFile) {
    if (isSecurityCriticalFile(file)) {
      securityDiff += content + '\n'
    } else {
      regularDiff += content + '\n'
    }
  }

  // Security files are NEVER truncated - calculate remaining budget for regular files
  const securityDiffSize = securityDiff.length
  const remainingBudget = Math.max(0, MAX_DIFF_CHARS - securityDiffSize)

  console.log(`🔒 Security diff size: ${Math.round(securityDiffSize / 1024)}KB (preserved in full)`)
  console.log(`📄 Regular diff size: ${Math.round(regularDiff.length / 1024)}KB (budget: ${Math.round(remainingBudget / 1024)}KB)`)

  // Truncate only the regular (non-security) diff
  let finalDiff: string
  if (regularDiff.length > remainingBudget && remainingBudget > 0) {
    const truncatedRegular = smartTruncate(regularDiff, remainingBudget, 'non-security diff')
    truncationInfo.push(`Non-security diff was truncated from ${Math.round(regularDiff.length / 1024)}KB to ${Math.round(remainingBudget / 1024)}KB`)
    finalDiff = securityDiff + '\n\n--- SECURITY-CRITICAL FILES ABOVE (full) | REGULAR FILES BELOW (may be truncated) ---\n\n' + truncatedRegular.text
  } else if (remainingBudget === 0 && regularDiff.length > 0) {
    // Security files used entire budget - include note about skipped files
    truncationInfo.push(`⚠️ Security files used entire ${Math.round(MAX_DIFF_CHARS / 1024)}KB budget. Non-security files (${changedFiles.filter(f => !isSecurityCriticalFile(f)).length} files) not included.`)
    finalDiff = securityDiff + '\n\n--- SECURITY FILES ONLY (non-security files omitted due to size) ---\n'
  } else {
    // Everything fits
    finalDiff = securityDiff + regularDiff
  }

  // Truncate docs
  const claudeMdResult = smartTruncate(docs.claudeMd, MAX_DOC_CHARS, 'CLAUDE.md')
  const readmeMdResult = smartTruncate(docs.readmeMd, MAX_DOC_CHARS, 'README.md')
  if (claudeMdResult.wasTruncated) {
    truncationInfo.push(`CLAUDE.md was truncated from ${Math.round(claudeMdResult.totalChars / 1024)}KB to ${Math.round(MAX_DOC_CHARS / 1024)}KB`)
  }
  if (readmeMdResult.wasTruncated) {
    truncationInfo.push(`README.md was truncated from ${Math.round(readmeMdResult.totalChars / 1024)}KB to ${Math.round(MAX_DOC_CHARS / 1024)}KB`)
  }

  const sizeKB = Math.round(diff.length / 1024)
  console.log(`📦 Diff size: ${sizeKB}KB (${changedFiles.length} files)`)
  if (truncationInfo.length > 0) {
    console.log(`📐 Smart truncation applied: ${truncationInfo.join(', ')}`)
  }

  if (sizeKB > 500) {
    console.warn(`⚠️ Large diff (${sizeKB}KB) - consider breaking into smaller PRs`)
  }

  const fileList = changedFiles.slice(0, MAX_FILES_SHOWN).join('\n')
  const filesNote = changedFiles.length > MAX_FILES_SHOWN
    ? `\n(showing first ${MAX_FILES_SHOWN} of ${changedFiles.length} files)`
    : ''

  // Check if documentation was modified in this PR
  const docsModified = changedFiles.some(f => f === 'CLAUDE.md' || f === 'README.md')

  // Include documentation with smart truncation
  const claudeMdContext = claudeMdResult.text
  const readmeMdContext = readmeMdResult.text

  // Truncation notice for AI
  let truncationNotice = ''
  if (truncationInfo.length > 0) {
    truncationNotice = '\n## ⚠️ Context Truncation\n'
    truncationNotice += truncationInfo.map(t => `- ${t}`).join('\n') + '\n'
    if (securityFiles.length > 0) {
      truncationNotice += '\n🔒 **Security files were preserved in full** - auth, RLS, credentials, and migration files are never truncated.\n'
    }
    truncationNotice += '\nIf you need more context for a specific file or section, note it in your review and the final verdict will investigate.\n'
  }

  return `You are a senior developer reviewing a PR for Familjen, a Norwegian family planning app.

## Project Context
- Next.js 16 with App Router (pages in src/app/)
- Supabase for PostgreSQL + Auth + Row Level Security
- TypeScript strict mode
- Tailwind CSS v4
- OpenRouter for AI features
- Norwegian/Swedish/English i18n (translations in src/lib/i18n/)

## Key Patterns
- Server components: createClient from @/lib/supabase/server
- Client components: createClient from @/lib/supabase/client
- Date handling: formatDateISO() from @/lib/utils
- Child colors: sky, coral, sage, honey, lavender, mint
- Norwegian terms: Henting=Pickup, Middag=Dinner, Husstand=Household

## Current Documentation

### CLAUDE.md (Development Guide)
\`\`\`markdown
${claudeMdContext}
\`\`\`

### README.md (Project Overview)
\`\`\`markdown
${readmeMdContext}
\`\`\`

## Changed Files
${fileList}${filesNote}

## Documentation Status
${docsModified ? '✅ Documentation was updated in this PR' : '⚠️ Documentation was NOT updated in this PR'}
${truncationNotice}
## PR Diff
\`\`\`diff
${finalDiff}
\`\`\`

## Review Checklist

### Security (CRITICAL - any issue blocks merge)
- [ ] No secrets/API keys in code
- [ ] Auth checks on protected routes
- [ ] RLS policies for new tables
- [ ] Input sanitization (lib/sanitize.ts patterns)
- [ ] No SQL injection in raw queries
- [ ] No XSS (dangerouslySetInnerHTML, unescaped user input)

### Data Integrity
- [ ] Supabase errors handled properly (not just console.log)
- [ ] Optimistic updates rollback on error
- [ ] formatDateISO() for dates (not raw toISOString)
- [ ] Async operations properly awaited

### Error Handling Patterns (Familjen-specific)
- [ ] API routes use \`handleApiError()\` or \`ApiErrors.*\` from lib/api-errors.ts
- [ ] API routes return user-friendly Norwegian error messages, not raw errors
- [ ] Supabase calls check for \`error\` response and handle appropriately
- [ ] Integration clients (Spond, MyKid) use try/catch with specific error types
- [ ] Rate limit responses use \`ApiErrors.rateLimit()\` with retry-after
- [ ] Demo mode requests check \`isDemoRequest()\` early and bypass heavy auth
- [ ] Credential decryption failures use \`ApiErrors.internal()\` with internal message only

### Norwegian App Specifics
- [ ] New strings have translations (nb.ts, sv.ts, en.ts)
- [ ] Child colors use CHILD_COLOR_MAP
- [ ] Dates formatted for Norwegian locale

### AI Agent Detection (you're reviewing AI-generated code!)
- [ ] No hallucinated imports (packages not in package.json)
- [ ] No placeholder TODOs left behind
- [ ] Logic actually matches comments
- [ ] No over-engineered abstractions
- [ ] Real error handling, not catch + console.log

### Code Quality
- [ ] Correct TypeScript types (no \`any\` without reason)
- [ ] Follows existing codebase patterns
- [ ] No dead code or unused imports

### Documentation (check against CLAUDE.md and README.md above)
- [ ] New features/patterns are documented in CLAUDE.md
- [ ] New API endpoints added to API Routes table
- [ ] New environment variables added to README.md
- [ ] Rate limiting changes documented in Rate Limiting section
- [ ] If adding new integration: docs/api-integrations.md updated
- [ ] If changing database: schema tables documented

If code adds significant new functionality that is NOT reflected in the documentation, mention it as a **suggestion** (not blocking).

## What NOT to Flag as Blocking

These are suggestions at most — NEVER put them in the "blocking" array:
- Missing or incomplete CLAUDE.md / README.md updates
- Missing unit tests (unless code is obviously broken)
- Style preferences or naming conventions
- "Consider refactoring" on working code
- Type annotations on existing working code
- PR description quality
- "Supabase client could be null" — createClient() never returns null in this codebase
- Missing error handling when the existing pattern handles errors differently

**Only use the "blocking" array for issues that would cause runtime errors, security vulnerabilities, or data corruption.**

Focus on practical issues that would cause problems for busy parents.
Don't be pedantic about style. Be thorough about security and data integrity.`
}

function formatReviewOutput(review: CodeReviewResult): void {
  const emoji = { APPROVE: '✅', REQUEST_CHANGES: '❌', COMMENT: '💬' }

  console.log('\n' + '='.repeat(60))
  console.log(`Verdict: ${emoji[review.verdict]} ${review.verdict}`)
  console.log(`Summary: ${review.summary}`)

  if (review.blocking.length > 0) {
    console.log('\n🚫 Blocking Issues:')
    for (const b of review.blocking) {
      console.log(`  • ${b.file}${b.line ? `:${b.line}` : ''}: ${b.issue}`)
    }
  }

  if (review.suggestions.length > 0) {
    console.log('\n💡 Suggestions:')
    for (const s of review.suggestions) {
      console.log(`  • ${s.file}${s.line ? `:${s.line}` : ''}: ${s.suggestion}`)
    }
  }
}

/**
 * Convert old CodeReviewResult format to new Finding[] format
 */
function convertToFindings(review: CodeReviewResult): Finding[] {
  const findings: Finding[] = []

  // Convert blocking issues to critical findings
  for (const b of review.blocking) {
    findings.push({
      severity: 'critical',
      category: categorizeFinding(b.issue),
      message: b.issue,
      file: b.file,
      line: b.line ?? undefined,
    })
  }

  // Convert suggestions to info/warning findings
  for (const s of review.suggestions) {
    findings.push({
      severity: 'info',
      category: categorizeFinding(s.suggestion),
      message: s.suggestion,
      file: s.file,
      line: s.line ?? undefined,
    })
  }

  return findings
}

/**
 * Try to categorize a finding based on its message content
 */
function categorizeFinding(message: string): Finding['category'] {
  const lower = message.toLowerCase()

  if (lower.includes('auth') || lower.includes('security') || lower.includes('secret') || lower.includes('rls')) {
    return 'security'
  }
  if (lower.includes('error handling') || lower.includes('validation') || lower.includes('null')) {
    return 'data-integrity'
  }
  if (lower.includes('import') || lower.includes('crash') || lower.includes('undefined')) {
    return 'runtime-error'
  }
  if (lower.includes('translation') || lower.includes('i18n') || lower.includes('norwegian')) {
    return 'i18n'
  }
  if (lower.includes('performance') || lower.includes('slow') || lower.includes('index')) {
    return 'performance'
  }

  return 'code-quality'
}

function generateReviewSection(review: CodeReviewResult, modelName: string, label: string): string {
  const emoji = { APPROVE: '✅', REQUEST_CHANGES: '❌', COMMENT: '💬' }

  let body = `### ${label} (${modelName})\n\n`
  body += `**Verdict:** ${emoji[review.verdict]} ${review.verdict}\n\n`
  body += `${review.summary}\n`

  if (review.blocking.length > 0) {
    body += `\n#### 🚫 Blocking Issues\n`
    for (const b of review.blocking) {
      body += `- \`${b.file}${b.line ? `:${b.line}` : ''}\`: ${b.issue}\n`
    }
  }

  if (review.suggestions.length > 0) {
    body += `\n#### 💡 Suggestions\n`
    for (const s of review.suggestions) {
      body += `- \`${s.file}${s.line ? `:${s.line}` : ''}\`: ${s.suggestion}\n`
    }
  }

  return body
}

function generateDualComment(result: DualReviewResult): string {
  const emoji = { APPROVE: '✅', REQUEST_CHANGES: '❌', COMMENT: '💬' }

  let body = `## 🤖 AI Code Review (Dual-Model)\n\n`
  body += `**Combined Verdict:** ${emoji[result.combinedVerdict]} ${result.combinedVerdict}\n\n`

  // Note that this is non-blocking
  body += `> ℹ️ This review is informational. The final verdict will decide if the PR can merge.\n\n`

  body += `---\n\n`

  if (result.fast) {
    const modelName = AI_MODELS.fast.split('/').pop() || AI_MODELS.fast
    body += generateReviewSection(result.fast, modelName, 'Review A')
    body += `\n---\n\n`
  }

  if (result.capable) {
    const modelName = AI_MODELS.capable.split('/').pop() || AI_MODELS.capable
    body += generateReviewSection(result.capable, modelName, 'Review B')
  }

  body += `\n---\n*Reviewed by: ${AI_MODELS.fast} + ${AI_MODELS.capable}*`
  return body
}

function generateSingleComment(review: CodeReviewResult, modelName: string): string {
  let body = `## 🤖 AI Code Review\n\n`
  body += `**Verdict:** ${review.verdict}\n\n`

  // Note that this is non-blocking
  body += `> ℹ️ This review is informational. The final verdict will decide if the PR can merge.\n\n`

  body += `${review.summary}\n`

  if (review.blocking.length > 0) {
    body += `\n### 🚫 Blocking Issues\n`
    for (const b of review.blocking) {
      body += `- \`${b.file}${b.line ? `:${b.line}` : ''}\`: ${b.issue}\n`
    }
  }

  if (review.suggestions.length > 0) {
    body += `\n### 💡 Suggestions\n`
    for (const s of review.suggestions) {
      body += `- \`${s.file}${s.line ? `:${s.line}` : ''}\`: ${s.suggestion}\n`
    }
  }

  body += `\n---\n*Reviewed by AI using ${modelName}*`
  return body
}

async function runReview(model: string, prompt: string, label: string): Promise<CodeReviewResult | null> {
  console.log(`\n${label}: Sending to ${model}...`)
  try {
    const review = await callOpenRouterStructured<CodeReviewResult>(
      model,
      [{ role: 'user', content: prompt }],
      SCHEMAS.codeReview,
      'code_review',
      { temperature: 0, maxTokens: 4000 }
    )
    console.log(`${label}: ✓ Received (${review.verdict})`)
    return review
  } catch (error) {
    console.error(`${label}: ✗ Failed - ${error instanceof Error ? error.message : 'Unknown'}`)
    return null
  }
}

function combineVerdicts(
  fast: CodeReviewResult | null,
  capable: CodeReviewResult | null
): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
  // Only REQUEST_CHANGES if BOTH models agree, OR if either found a genuinely
  // critical security/data-integrity issue. Prevents one model's false positive from blocking.
  const hasCriticalBlocking = (review: CodeReviewResult | null): boolean => {
    if (!review) return false
    return review.blocking.some(b => {
      const lower = b.issue.toLowerCase()
      return lower.includes('security') || lower.includes('injection') ||
        lower.includes('auth bypass') || lower.includes('data loss') ||
        lower.includes('data corruption') || lower.includes('hardcoded secret') ||
        lower.includes('crash') || lower.includes('undefined is not')
    })
  }

  const bothRequestChanges = fast?.verdict === 'REQUEST_CHANGES' && capable?.verdict === 'REQUEST_CHANGES'

  if (bothRequestChanges) {
    return 'REQUEST_CHANGES'
  }
  // Only one model blocks — escalate only for genuinely critical issues
  if (fast?.verdict === 'REQUEST_CHANGES' || capable?.verdict === 'REQUEST_CHANGES') {
    if (hasCriticalBlocking(fast) || hasCriticalBlocking(capable)) {
      return 'REQUEST_CHANGES'
    }
    // Non-critical block from one model — downgrade to informational
    return 'COMMENT'
  }
  if (fast?.verdict === 'APPROVE' && capable?.verdict === 'APPROVE') {
    return 'APPROVE'
  }
  if (fast?.verdict === 'APPROVE' || capable?.verdict === 'APPROVE') {
    return 'APPROVE'
  }
  return 'COMMENT'
}

/**
 * Map combined verdict to new ReviewerVerdict type
 */
function mapVerdict(verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'): 'PASS' | 'WARN' | 'FAIL' {
  switch (verdict) {
    case 'APPROVE': return 'PASS'
    case 'REQUEST_CHANGES': return 'FAIL'
    case 'COMMENT': return 'WARN'
  }
}

async function main() {
  const startTime = Date.now()
  const singleMode = getSingleModelMode()

  console.log('🔍 AI Code Review (Non-Blocking)')
  if (singleMode) {
    console.log(`Mode: Single (${singleMode === 'fast' ? AI_MODELS.fast : AI_MODELS.capable})`)
  } else {
    console.log(`Mode: Dual (${AI_MODELS.fast} + ${AI_MODELS.capable})`)
  }

  // Check for API key
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set')
    // Save error output
    const errorOutput: ReviewerOutput = {
      reviewer: 'code-review',
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'failed',
      verdict: 'ERROR',
      confidence: 0,
      findings: [{
        severity: 'critical',
        category: 'runtime-error',
        message: 'OPENROUTER_API_KEY not set',
      }],
      summary: 'Code review failed: API key not configured.',
    }
    saveReviewerOutput(errorOutput)
    process.exit(1) // Script failed to run
  }

  const baseBranch = getBaseBranch()
  console.log(`Base: ${baseBranch}`)

  const diff = getDiff(baseBranch)
  if (!diff.trim()) {
    console.log('✅ No changes to review')
    // Save skipped output
    const skippedOutput: ReviewerOutput = {
      reviewer: 'code-review',
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'No changes to review.',
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0)
  }

  const changedFiles = getChangedFiles(baseBranch)
  console.log(`Files: ${changedFiles.length}`)

  // Skip for config-only changes (but NOT docs - we want to review doc changes too)
  const codeOrDocsFiles = changedFiles.filter(
    (f) => !f.endsWith('.txt') && !f.endsWith('.json') && !f.startsWith('.') || f === 'CLAUDE.md' || f === 'README.md'
  )
  if (codeOrDocsFiles.length === 0) {
    console.log('✅ Only config changes, skipping')
    const skippedOutput: ReviewerOutput = {
      reviewer: 'code-review',
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'Only configuration changes, no code review needed.',
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0)
  }

  // Load current documentation for context
  const docs = getDocumentation()
  console.log(`📚 Documentation: CLAUDE.md (${Math.round(docs.claudeMd.length / 1024)}KB), README.md (${Math.round(docs.readmeMd.length / 1024)}KB)`)

  const prompt = buildReviewPrompt(diff, changedFiles, docs)

  let comment: string
  let finalVerdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  let allFindings: Finding[] = []
  let modelsUsed: string

  try {
    if (singleMode) {
      const model = singleMode === 'fast' ? AI_MODELS.fast : AI_MODELS.capable
      modelsUsed = model
      const review = await runReview(model, prompt, '🤖 Review')

      if (!review) {
        throw new Error('AI review returned null')
      }

      formatReviewOutput(review)
      allFindings = convertToFindings(review)
      comment = generateSingleComment(review, model)
      finalVerdict = review.verdict
    } else {
      console.log('\n🚀 Running dual-model review...')
      modelsUsed = `${AI_MODELS.fast} + ${AI_MODELS.capable}`

      const [fastReview, capableReview] = await Promise.all([
        runReview(AI_MODELS.fast, prompt, `A (${AI_MODELS.fast.split('/').pop()})`),
        runReview(AI_MODELS.capable, prompt, `B (${AI_MODELS.capable.split('/').pop()})`),
      ])

      if (!fastReview && !capableReview) {
        throw new Error('Both AI reviews failed')
      }

      finalVerdict = combineVerdicts(fastReview, capableReview)

      // Combine findings from both reviews
      if (fastReview) {
        allFindings.push(...convertToFindings(fastReview))
      }
      if (capableReview) {
        allFindings.push(...convertToFindings(capableReview))
      }

      // Deduplicate findings by message
      const seen = new Set<string>()
      allFindings = allFindings.filter(f => {
        const key = `${f.file}:${f.line}:${f.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const result: DualReviewResult = {
        fast: fastReview,
        capable: capableReview,
        combinedVerdict: finalVerdict,
      }

      if (fastReview) {
        console.log('\n' + '='.repeat(60))
        console.log(`MODEL A (${AI_MODELS.fast})`)
        formatReviewOutput(fastReview)
      }
      if (capableReview) {
        console.log('\n' + '='.repeat(60))
        console.log(`MODEL B (${AI_MODELS.capable})`)
        formatReviewOutput(capableReview)
      }

      console.log('\n' + '='.repeat(60))
      console.log(`COMBINED: ${finalVerdict}`)

      // Keep old format for backwards compatibility
      writeFileSync('ai-review-result.json', JSON.stringify(result, null, 2))
      comment = generateDualComment(result)
    }

    // Save in new standardized format
    const output: ReviewerOutput = {
      reviewer: 'code-review',
      model: modelsUsed,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'completed',
      verdict: mapVerdict(finalVerdict),
      confidence: finalVerdict === 'APPROVE' ? 85 : finalVerdict === 'COMMENT' ? 70 : 90,
      findings: allFindings,
      summary: allFindings.length === 0
        ? 'No issues found in code review.'
        : `Found ${allFindings.filter(f => f.severity === 'critical').length} critical issues, ${allFindings.filter(f => f.severity === 'warning').length} warnings.`,
    }
    saveReviewerOutput(output)

    // Save comment for GitHub posting
    writeFileSync('ai-review-comment.md', comment)
    console.log('\n📄 Results: ai-reviews/code-review.json, ai-review-comment.md')

    // Always exit 0 - we completed the review successfully
    // The verdict doesn't affect exit code; final verdict will decide
    console.log(`\n${verdictEmoji(mapVerdict(finalVerdict))} Review complete (${mapVerdict(finalVerdict)})`)
    process.exit(0)

  } catch (error) {
    console.error('❌ Review failed:', error instanceof Error ? error.message : error)

    // Save error output
    const errorOutput: ReviewerOutput = {
      reviewer: 'code-review',
      model: singleMode ? (singleMode === 'fast' ? AI_MODELS.fast : AI_MODELS.capable) : `${AI_MODELS.fast} + ${AI_MODELS.capable}`,
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
      summary: 'Code review failed due to an error. Manual review recommended.',
    }
    saveReviewerOutput(errorOutput)

    // Save a basic comment so something gets posted
    writeFileSync('ai-review-comment.md', `## 🤖 AI Code Review

**Status:** ❌ ERROR

The AI code review failed to complete. Manual review recommended.

Error: ${error instanceof Error ? error.message : 'Unknown error'}

---
*Review attempted but failed*`)

    // Exit 1 because the script itself failed
    process.exit(1)
  }
}

main()
