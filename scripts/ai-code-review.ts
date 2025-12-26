#!/usr/bin/env npx tsx
/**
 * AI-Powered Code Review (Dual-Model)
 *
 * Reviews PR changes using TWO models for comprehensive coverage:
 * - FAST model: Quick check, often different vendor perspective
 * - CAPABLE model: Thorough analysis with deeper reasoning
 *
 * Both reviews are posted to give reviewers multiple perspectives.
 * Request changes if EITHER model finds blocking issues.
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
import { writeFileSync } from 'fs'
import { AI_MODELS, callOpenRouterStructured, SCHEMAS, type CodeReviewResult } from './ai-config'

// Dual-model review result
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
  // Try to determine base from GitHub event
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`
  }
  return 'origin/main'
}

function ensureBaseBranchFetched(baseBranch: string): void {
  // Fetch the base branch to ensure we have the latest
  try {
    const remote = baseBranch.split('/')[0] || 'origin'
    const branch = baseBranch.replace(`${remote}/`, '')
    console.log(`Fetching ${remote}/${branch} to ensure we have latest...`)
    execSync(`git fetch ${remote} ${branch} --depth=1`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  } catch (error) {
    console.warn(`Warning: Could not fetch base branch: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

function getDiff(baseBranch: string): string {
  // Ensure we have the base branch fetched
  ensureBaseBranchFetched(baseBranch)

  try {
    // Use merge-base to get the correct diff point
    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
      encoding: 'utf-8',
    }).trim()

    console.log(`Merge base: ${mergeBase.slice(0, 8)}`)

    return execSync(`git diff ${mergeBase}...HEAD`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (error) {
    console.warn(`Warning: Could not get diff from ${baseBranch}, falling back to HEAD~1`)
    console.warn(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    // Fallback to comparing with last commit
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

function loadRelevantContext(): string {
  // SECURITY: Strict allowlist approach - only include minimal safe context
  // Never load database schemas, credentials, SQL examples, or security implementation details
  // This context is sent to an external AI API

  const safeContext = `## Tech Stack Summary
- Next.js 16 with App Router
- Supabase for PostgreSQL + Auth + RLS
- TypeScript strict mode
- Tailwind CSS v4
- Norwegian/Swedish/English i18n

## File Structure
- src/app/ - Next.js pages and API routes
- src/components/ - React components
- src/lib/ - Utilities and Supabase clients
- tests/ - Unit and E2E tests
- supabase/migrations/ - Database migrations

## Norwegian Terms
- Henting = Pickup
- Middag = Dinner
- Oppgave = Task
- Husstand = Household
- Innstillinger = Settings

## Key Patterns
- Use createClient from @/lib/supabase/server for server components
- Use createClient from @/lib/supabase/client for client components
- Use formatDateISO() for date handling
- Child colors: sky, coral, sage, honey, lavender, mint`

  return safeContext
}

function buildReviewPrompt(diff: string, changedFiles: string[], context: string): string {
  // Truncate diff if too large
  const maxDiffLength = 50000
  const truncatedDiff = diff.length > maxDiffLength ? diff.slice(0, maxDiffLength) + '\n\n[... diff truncated ...]' : diff

  const fileList = changedFiles.slice(0, 50).join('\n')

  return `You are a senior developer reviewing a PR for Familjen, a Norwegian family planning app.

## Project Context
${context || 'See CLAUDE.md for full context.'}

## Tech Stack Summary
- Next.js 16 with App Router (pages in src/app/)
- Supabase for PostgreSQL + Auth + RLS
- TypeScript strict mode
- Tailwind CSS v4
- OpenRouter for AI features
- Norwegian/Swedish/English i18n

## Changed Files
${fileList}

## PR Diff
\`\`\`diff
${truncatedDiff}
\`\`\`

## Review Checklist

### Security (CRITICAL - any fail blocks merge)
- [ ] No secrets/API keys in code
- [ ] Auth checks on protected routes (middleware or server component)
- [ ] RLS policies for new tables
- [ ] Input sanitization (use lib/sanitize.ts patterns)
- [ ] No SQL injection in raw queries
- [ ] No XSS vectors (dangerouslySetInnerHTML, unescaped user input)

### Data Integrity
- [ ] Supabase operations handle errors (not just console.log)
- [ ] Optimistic updates have rollback on error
- [ ] Uses formatDateISO() for date handling (not raw toISOString)
- [ ] Async operations properly awaited

### Norwegian App Specifics
- [ ] New user-facing strings have translations (nb.ts, sv.ts, en.ts)
- [ ] Child colors use CHILD_COLOR_MAP
- [ ] Dates formatted for Norwegian locale

### AI Agent Detection (you're reviewing AI-generated code!)
- [ ] No hallucinated imports (packages that don't exist in package.json)
- [ ] No placeholder TODOs left behind
- [ ] Logic actually matches comments
- [ ] No over-engineered abstractions for simple tasks
- [ ] Error handling is real, not just catch + console.log

### Code Quality
- [ ] TypeScript types are correct (no \`any\` without reason)
- [ ] Follows existing patterns in codebase
- [ ] No dead code or unused imports
- [ ] Components are properly memoized if needed for perf

Focus on practical issues that would cause problems for busy parents using the app.
Don't be pedantic about style. Be thorough about security and data integrity.

Analyze the changes and provide your assessment.`
}

function formatReviewOutput(review: CodeReviewResult): void {
  const verdictEmoji = {
    APPROVE: '✅',
    REQUEST_CHANGES: '❌',
    COMMENT: '💬',
  }

  console.log('\n' + '='.repeat(60))
  console.log('AI CODE REVIEW')
  console.log('='.repeat(60))
  console.log(`\nVerdict: ${verdictEmoji[review.verdict]} ${review.verdict}`)
  console.log(`\nSummary: ${review.summary}`)

  if (review.blocking.length > 0) {
    console.log('\n🚫 Blocking Issues:')
    for (const b of review.blocking) {
      const lineInfo = b.line ? `:${b.line}` : ''
      console.log(`  • ${b.file}${lineInfo}`)
      console.log(`    ${b.issue}`)
    }
  }

  if (review.suggestions.length > 0) {
    console.log('\n💡 Suggestions:')
    for (const s of review.suggestions) {
      const lineInfo = s.line ? `:${s.line}` : ''
      console.log(`  • ${s.file}${lineInfo}`)
      console.log(`    ${s.suggestion}`)
    }
  }
}

function generateSingleReviewSection(review: CodeReviewResult, modelName: string, label: string): string {
  const verdictEmoji = {
    APPROVE: '✅',
    REQUEST_CHANGES: '❌',
    COMMENT: '💬',
  }

  let body = `### ${label} (${modelName})\n\n`
  body += `**Verdict:** ${verdictEmoji[review.verdict]} ${review.verdict}\n\n`
  body += `${review.summary}\n`

  if (review.blocking.length > 0) {
    body += `\n#### 🚫 Blocking Issues\n`
    for (const b of review.blocking) {
      const lineInfo = b.line ? `:${b.line}` : ''
      body += `- \`${b.file}${lineInfo}\`: ${b.issue}\n`
    }
  }

  if (review.suggestions.length > 0) {
    body += `\n#### 💡 Suggestions\n`
    for (const s of review.suggestions) {
      const lineInfo = s.line ? `:${s.line}` : ''
      body += `- \`${s.file}${lineInfo}\`: ${s.suggestion}\n`
    }
  }

  return body
}

function generateDualGitHubComment(result: DualReviewResult): string {
  const verdictEmoji = {
    APPROVE: '✅',
    REQUEST_CHANGES: '❌',
    COMMENT: '💬',
  }

  let body = `## 🤖 AI Code Review (Dual-Model)\n\n`
  body += `**Combined Verdict:** ${verdictEmoji[result.combinedVerdict]} ${result.combinedVerdict}\n\n`

  if (result.combinedVerdict === 'REQUEST_CHANGES') {
    body += `> ⚠️ At least one model found blocking issues that should be addressed.\n\n`
  }

  body += `---\n\n`

  // First model review
  if (result.fast) {
    const modelName = AI_MODELS.fast.split('/').pop() || AI_MODELS.fast
    body += generateSingleReviewSection(result.fast, modelName, `Review A`)
    body += `\n---\n\n`
  }

  // Second model review
  if (result.capable) {
    const modelName = AI_MODELS.capable.split('/').pop() || AI_MODELS.capable
    body += generateSingleReviewSection(result.capable, modelName, `Review B`)
  }

  body += `\n---\n*Reviewed by: ${AI_MODELS.fast} + ${AI_MODELS.capable}*`

  return body
}

function generateGitHubComment(review: CodeReviewResult, modelName: string): string {
  let body = `## 🤖 AI Code Review\n\n`
  body += `**Verdict:** ${review.verdict}\n\n`
  body += `${review.summary}\n`

  if (review.blocking.length > 0) {
    body += `\n### 🚫 Blocking Issues\n`
    for (const b of review.blocking) {
      const lineInfo = b.line ? `:${b.line}` : ''
      body += `- \`${b.file}${lineInfo}\`: ${b.issue}\n`
    }
  }

  if (review.suggestions.length > 0) {
    body += `\n### 💡 Suggestions\n`
    for (const s of review.suggestions) {
      const lineInfo = s.line ? `:${s.line}` : ''
      body += `- \`${s.file}${lineInfo}\`: ${s.suggestion}\n`
    }
  }

  body += `\n---\n*Reviewed by AI using ${modelName}*`

  return body
}

async function runSingleModelReview(
  model: string,
  prompt: string,
  label: string
): Promise<CodeReviewResult | null> {
  console.log(`\n${label}: Sending to ${model}...`)
  try {
    const review = await callOpenRouterStructured<CodeReviewResult>(
      model,
      [{ role: 'user', content: prompt }],
      SCHEMAS.codeReview,
      'code_review',
      { temperature: 0, maxTokens: 4000 }
    )
    console.log(`${label}: ✓ Received response (${review.verdict})`)
    return review
  } catch (error) {
    console.error(`${label}: ✗ Failed - ${error instanceof Error ? error.message : 'Unknown error'}`)
    return null
  }
}

function combineVerdicts(fast: CodeReviewResult | null, capable: CodeReviewResult | null): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
  // If either model requests changes, we request changes (conservative)
  if (fast?.verdict === 'REQUEST_CHANGES' || capable?.verdict === 'REQUEST_CHANGES') {
    return 'REQUEST_CHANGES'
  }
  // If both approve, we approve
  if (fast?.verdict === 'APPROVE' && capable?.verdict === 'APPROVE') {
    return 'APPROVE'
  }
  // If one approves and the other is null/comment, go with approve
  if (fast?.verdict === 'APPROVE' || capable?.verdict === 'APPROVE') {
    return 'APPROVE'
  }
  // Default to comment (e.g., both have comments or both failed)
  return 'COMMENT'
}

async function main() {
  const singleMode = getSingleModelMode()

  console.log('🔍 AI Code Review (Dual-Model)')
  if (singleMode) {
    console.log(`Mode: Single model (${singleMode})`)
    console.log(`Model: ${singleMode === 'fast' ? AI_MODELS.fast : AI_MODELS.capable}`)
  } else {
    console.log(`Mode: Dual model`)
    console.log(`Fast model: ${AI_MODELS.fast}`)
    console.log(`Capable model: ${AI_MODELS.capable}`)
  }

  // Check API key availability
  const hasApiKey = !!process.env.OPENROUTER_API_KEY
  console.log(`API Key: ${hasApiKey ? '✓ Available' : '✗ Missing'}`)
  if (!hasApiKey) {
    console.error('❌ OPENROUTER_API_KEY is not set. Skipping AI review.')
    process.exit(0)
  }

  const baseBranch = getBaseBranch()
  console.log(`Comparing against: ${baseBranch}`)

  const diff = getDiff(baseBranch)
  if (!diff.trim()) {
    console.log('✅ No changes to review')
    process.exit(0)
  }

  const changedFiles = getChangedFiles(baseBranch)
  console.log(`Changed files: ${changedFiles.length}`)

  // Skip review for documentation-only changes
  const codeFiles = changedFiles.filter(
    (f) => !f.endsWith('.md') && !f.endsWith('.txt') && !f.endsWith('.json') && !f.startsWith('.')
  )
  if (codeFiles.length === 0) {
    console.log('✅ Only documentation/config changes, skipping code review')
    process.exit(0)
  }

  const context = loadRelevantContext()
  const prompt = buildReviewPrompt(diff, changedFiles, context)

  let comment: string
  let finalVerdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

  if (singleMode) {
    // Single model mode
    const model = singleMode === 'fast' ? AI_MODELS.fast : AI_MODELS.capable
    const review = await runSingleModelReview(model, prompt, '🤖 Review')

    if (!review) {
      writeFileSync(
        'ai-review-result.json',
        JSON.stringify({
          verdict: 'COMMENT',
          blocking: [],
          suggestions: [],
          summary: 'AI review could not be completed. Manual review recommended.',
        }, null, 2)
      )
      process.exit(0)
    }

    formatReviewOutput(review)
    writeFileSync('ai-review-result.json', JSON.stringify(review, null, 2))
    comment = generateGitHubComment(review, model)
    finalVerdict = review.verdict
  } else {
    // Dual model mode - run both in parallel
    console.log('\n🚀 Running dual-model review...')

    const [fastReview, capableReview] = await Promise.all([
      runSingleModelReview(AI_MODELS.fast, prompt, `Model A (${AI_MODELS.fast.split('/').pop()})`),
      runSingleModelReview(AI_MODELS.capable, prompt, `Model B (${AI_MODELS.capable.split('/').pop()})`),
    ])

    if (!fastReview && !capableReview) {
      writeFileSync(
        'ai-review-result.json',
        JSON.stringify({
          verdict: 'COMMENT',
          blocking: [],
          suggestions: [],
          summary: 'Both AI reviews failed. Manual review recommended.',
        }, null, 2)
      )
      process.exit(0)
    }

    const combinedVerdict = combineVerdicts(fastReview, capableReview)

    const dualResult: DualReviewResult = {
      fast: fastReview,
      capable: capableReview,
      combinedVerdict,
    }

    // Print both reviews to console
    if (fastReview) {
      console.log('\n' + '='.repeat(60))
      console.log(`MODEL A REVIEW (${AI_MODELS.fast})`)
      formatReviewOutput(fastReview)
    }
    if (capableReview) {
      console.log('\n' + '='.repeat(60))
      console.log(`MODEL B REVIEW (${AI_MODELS.capable})`)
      formatReviewOutput(capableReview)
    }

    console.log('\n' + '='.repeat(60))
    console.log(`COMBINED VERDICT: ${combinedVerdict}`)
    console.log('='.repeat(60))

    writeFileSync('ai-review-result.json', JSON.stringify(dualResult, null, 2))
    comment = generateDualGitHubComment(dualResult)
    finalVerdict = combinedVerdict
  }

  writeFileSync('ai-review-comment.md', comment)

  console.log('\n📄 Results written to ai-review-result.json')
  console.log('📄 GitHub comment written to ai-review-comment.md')

  if (finalVerdict === 'REQUEST_CHANGES') {
    console.log('\n❌ Review requests changes')
    process.exit(1)
  } else {
    console.log('\n✅ Review complete')
    process.exit(0)
  }
}

main().catch((error) => {
  console.error('Code review failed:', error.message)
  process.exit(1)
})
