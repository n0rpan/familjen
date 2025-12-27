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
    execSync(`git fetch ${remote} ${branch} --depth=1`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
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

function buildReviewPrompt(diff: string, changedFiles: string[]): string {
  // Log size for awareness - no truncation, modern LLMs handle large contexts
  const sizeKB = Math.round(diff.length / 1024)
  console.log(`📦 Diff size: ${sizeKB}KB (${changedFiles.length} files)`)

  if (sizeKB > 500) {
    console.warn(`⚠️ Large diff (${sizeKB}KB) - consider breaking into smaller PRs`)
  }

  const fileList = changedFiles.slice(0, 100).join('\n')

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

## Changed Files
${fileList}

## PR Diff
\`\`\`diff
${diff}
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

  if (result.combinedVerdict === 'REQUEST_CHANGES') {
    body += `> ⚠️ At least one model found blocking issues that should be addressed.\n\n`
  }

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
  // Conservative: if either requests changes, we request changes
  if (fast?.verdict === 'REQUEST_CHANGES' || capable?.verdict === 'REQUEST_CHANGES') {
    return 'REQUEST_CHANGES'
  }
  if (fast?.verdict === 'APPROVE' && capable?.verdict === 'APPROVE') {
    return 'APPROVE'
  }
  if (fast?.verdict === 'APPROVE' || capable?.verdict === 'APPROVE') {
    return 'APPROVE'
  }
  return 'COMMENT'
}

async function main() {
  const singleMode = getSingleModelMode()

  console.log('🔍 AI Code Review')
  if (singleMode) {
    console.log(`Mode: Single (${singleMode === 'fast' ? AI_MODELS.fast : AI_MODELS.capable})`)
  } else {
    console.log(`Mode: Dual (${AI_MODELS.fast} + ${AI_MODELS.capable})`)
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set')
    process.exit(0)
  }

  const baseBranch = getBaseBranch()
  console.log(`Base: ${baseBranch}`)

  const diff = getDiff(baseBranch)
  if (!diff.trim()) {
    console.log('✅ No changes to review')
    process.exit(0)
  }

  const changedFiles = getChangedFiles(baseBranch)
  console.log(`Files: ${changedFiles.length}`)

  // Skip for docs-only changes
  const codeFiles = changedFiles.filter(
    (f) => !f.endsWith('.md') && !f.endsWith('.txt') && !f.endsWith('.json') && !f.startsWith('.')
  )
  if (codeFiles.length === 0) {
    console.log('✅ Only docs/config changes, skipping')
    process.exit(0)
  }

  const prompt = buildReviewPrompt(diff, changedFiles)

  let comment: string
  let finalVerdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

  if (singleMode) {
    const model = singleMode === 'fast' ? AI_MODELS.fast : AI_MODELS.capable
    const review = await runReview(model, prompt, '🤖 Review')

    if (!review) {
      writeFileSync('ai-review-result.json', JSON.stringify({
        verdict: 'COMMENT',
        blocking: [],
        suggestions: [],
        summary: 'AI review failed. Manual review recommended.',
      }, null, 2))
      process.exit(0)
    }

    formatReviewOutput(review)
    writeFileSync('ai-review-result.json', JSON.stringify(review, null, 2))
    comment = generateSingleComment(review, model)
    finalVerdict = review.verdict
  } else {
    console.log('\n🚀 Running dual-model review...')

    const [fastReview, capableReview] = await Promise.all([
      runReview(AI_MODELS.fast, prompt, `A (${AI_MODELS.fast.split('/').pop()})`),
      runReview(AI_MODELS.capable, prompt, `B (${AI_MODELS.capable.split('/').pop()})`),
    ])

    if (!fastReview && !capableReview) {
      writeFileSync('ai-review-result.json', JSON.stringify({
        verdict: 'COMMENT',
        blocking: [],
        suggestions: [],
        summary: 'Both AI reviews failed. Manual review recommended.',
      }, null, 2))
      process.exit(0)
    }

    const combinedVerdict = combineVerdicts(fastReview, capableReview)

    const result: DualReviewResult = {
      fast: fastReview,
      capable: capableReview,
      combinedVerdict,
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
    console.log(`COMBINED: ${combinedVerdict}`)

    writeFileSync('ai-review-result.json', JSON.stringify(result, null, 2))
    comment = generateDualComment(result)
    finalVerdict = combinedVerdict
  }

  writeFileSync('ai-review-comment.md', comment)
  console.log('\n📄 Results: ai-review-result.json, ai-review-comment.md')

  if (finalVerdict === 'REQUEST_CHANGES') {
    console.log('❌ Review requests changes')
    process.exit(1)
  } else {
    console.log('✅ Review complete')
    process.exit(0)
  }
}

main().catch((error) => {
  console.error('Review failed:', error.message)
  process.exit(1)
})
