#!/usr/bin/env npx tsx
/**
 * AI-Powered Code Review
 *
 * Reviews PR changes for:
 * - Security issues (auth, RLS, injection)
 * - Data integrity (error handling, rollback)
 * - Norwegian app specifics (i18n, colors)
 * - AI agent detection (hallucinated imports, placeholders)
 * - Code quality (TypeScript, patterns)
 *
 * Usage:
 *   npx tsx scripts/ai-code-review.ts
 *   npx tsx scripts/ai-code-review.ts --base origin/main
 */

import { execSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { AI_MODELS, callOpenRouterStructured, SCHEMAS, type CodeReviewResult } from './ai-config'

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

function getDiff(baseBranch: string): string {
  try {
    return execSync(`git diff ${baseBranch}...HEAD`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch {
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
  const contexts: string[] = []

  // Load CLAUDE.md for project context
  if (existsSync('CLAUDE.md')) {
    const claudeMd = readFileSync('CLAUDE.md', 'utf-8')
    // Extract key sections
    const sections = ['## Tech Stack', '## Key Patterns', '## Security', '## Testing Philosophy']
    for (const section of sections) {
      const match = claudeMd.match(new RegExp(`${section}[\\s\\S]*?(?=\\n## |$)`))
      if (match) {
        contexts.push(match[0].slice(0, 1000))
      }
    }
  }

  return contexts.join('\n\n---\n\n')
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

function generateGitHubComment(review: CodeReviewResult): string {
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

  body += `\n---\n*Reviewed by AI using ${AI_MODELS.capable}*`

  return body
}

async function main() {
  console.log('🔍 AI Code Review')
  console.log(`Model: ${AI_MODELS.capable}`)

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

  console.log('\nSending to AI for review...')

  let review: CodeReviewResult
  try {
    review = await callOpenRouterStructured<CodeReviewResult>(
      AI_MODELS.capable,
      [{ role: 'user', content: prompt }],
      SCHEMAS.codeReview,
      'code_review',
      { temperature: 0, maxTokens: 4000 }
    )
  } catch (error) {
    console.error('Failed to get AI response:', error instanceof Error ? error.message : 'Unknown error')
    writeFileSync(
      'ai-review-result.json',
      JSON.stringify(
        {
          verdict: 'COMMENT',
          blocking: [],
          suggestions: [],
          summary: 'AI review could not be completed. Manual review recommended.',
        },
        null,
        2
      )
    )
    process.exit(0) // Don't fail the build on API errors
  }

  formatReviewOutput(review)

  // Write results for GitHub Actions
  writeFileSync('ai-review-result.json', JSON.stringify(review, null, 2))

  // Write GitHub comment format
  const comment = generateGitHubComment(review)
  writeFileSync('ai-review-comment.md', comment)

  console.log('\n📄 Results written to ai-review-result.json')
  console.log('📄 GitHub comment written to ai-review-comment.md')

  if (review.verdict === 'REQUEST_CHANGES') {
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
