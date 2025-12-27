# AI CI/CD Improvement Plan

## Philosophy

> "We don't test to make tests pass. We test to be confident busy parents won't have headaches."

Individual AI reviewers should **inform**, not **block**. Only the final verdict—a capable model with full context and tools—should make the blocking decision.

---

## New Environment Variables

Add these to GitHub Actions Secrets:

| Variable | Purpose | Recommended Value |
|----------|---------|-------------------|
| `OPENROUTER_VERDICT_MODEL` | Final verdict "super AI" | `anthropic/claude-opus-4` |

**Existing variables (no changes):**
- `OPENROUTER_API_KEY` - API access
- `OPENROUTER_FAST_MODEL` - Quick reviews (Gemini Flash)
- `OPENROUTER_CAPABLE_MODEL` - Code review (Claude Sonnet)
- `OPENROUTER_VISION_MODEL` - Visual validation (Gemini Flash)
- `OPENROUTER_TEST_MODEL` - API integration tests

---

## Architecture Overview

```
PR to main
    │
    ├─► lint, typecheck, unit-tests (unchanged)
    │
    ├─► build → Deploy to Vercel Preview
    │
    │   ┌────────────────────────────────────────────────────────────┐
    │   │           AI REVIEWERS (parallel, non-blocking)            │
    │   │                                                            │
    │   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
    │   │  │ Code Review  │  │  Migration   │  │   Visual     │     │
    │   │  │ (Sonnet)     │  │   Review     │  │  Validation  │     │
    │   │  │              │  │ (Flash)      │  │  (Flash)     │     │
    │   │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
    │   │         │                 │                 │             │
    │   │  ┌──────────────┐                                         │
    │   │  │  API Tests   │  ← Moved from main-only to PR           │
    │   │  │  (real calls)│                                         │
    │   │  └──────┬───────┘                                         │
    │   │         │                 │                 │             │
    │   │         ▼                 ▼                 ▼             │
    │   │                                                           │
    │   │  Each outputs JSON artifact + posts PR comment            │
    │   │  Each ALWAYS exits 0 (success) if it ran and posted       │
    │   │  Only fails if it couldn't run or couldn't post           │
    │   │                                                           │
    │   └────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   FINAL VERDICT (Opus 4.5)                          │
│                                                                     │
│  Collects:                                                          │
│  ├── .ai-reviews/code-review.json                                   │
│  ├── .ai-reviews/migration-review.json                              │
│  ├── .ai-reviews/visual-validation.json                             │
│  ├── .ai-reviews/api-tests.json                                     │
│  └── PR metadata (title, description, files)                        │
│                                                                     │
│  Tools Available (can call as needed):                              │
│  ├── read_file(path)           → Read any file in repo             │
│  ├── read_diff()               → Get full PR diff                  │
│  ├── search_code(query, glob)  → Search for patterns               │
│  ├── get_commits()             → List commits in this PR           │
│  ├── get_file_history(path)    → Recent changes to a file          │
│  ├── get_related_prs(files)    → Previous PRs touching same files  │
│  ├── get_pr_comments()         → Existing discussion               │
│  └── get_test_output()         → Full test logs if tests failed    │
│                                                                     │
│  Decision Criteria:                                                 │
│  ├── BLOCK: Security issues, data integrity, crashes, broken auth  │
│  ├── WARN:  Code quality concerns, accessibility issues            │
│  └── PASS:  Everything else (suggestions are just suggestions)     │
│                                                                     │
│  Posts comprehensive summary comment                                │
│  THIS is the only job that can fail the CI                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Phase 1: Standardize Reviewer Output Format

#### 1.1 Create shared types and artifact directory

Create `scripts/ai-review-types.ts`:

```typescript
// Standardized output format for all reviewers
export interface ReviewerOutput {
  reviewer: string              // 'code-review' | 'migration-review' | 'visual-validation' | 'api-tests'
  model: string                 // Model used (for transparency)
  timestamp: string             // ISO timestamp
  duration_ms: number           // How long the review took
  status: 'completed' | 'failed' | 'skipped'

  // Reviewer's opinion (informational, not blocking)
  verdict: string               // APPROVE/WARN/FAIL etc
  confidence: number            // 0-100, how confident is the reviewer

  // Categorized findings
  findings: Finding[]

  // Human-readable summary
  summary: string
}

export interface Finding {
  severity: 'critical' | 'warning' | 'info'
  category: string              // 'security' | 'data-integrity' | 'code-quality' | 'ui' | 'test-failure'
  message: string
  file?: string
  line?: number

  // For test failures
  testName?: string
  error?: string
}
```

#### 1.2 Modify existing reviewers

**Changes to each reviewer:**

1. Output to `.ai-reviews/<reviewer>.json` instead of root
2. Always `process.exit(0)` if review completed (even if verdict is negative)
3. Only `process.exit(1)` if the reviewer script itself failed (API error, couldn't post comment)
4. Include structured metadata (model, timestamp, duration)

**Example pattern for all reviewers:**

```typescript
async function main() {
  const startTime = Date.now()

  try {
    // ... do the review ...

    const output: ReviewerOutput = {
      reviewer: 'code-review',
      model: AI_MODELS.capable,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'completed',
      verdict: review.verdict,
      confidence: 85,
      findings: review.blocking.map(b => ({
        severity: 'critical',
        category: 'code-quality',
        message: b.issue,
        file: b.file,
        line: b.line,
      })),
      summary: review.summary,
    }

    // Save artifact for final verdict
    await fs.mkdir('.ai-reviews', { recursive: true })
    await fs.writeFile('.ai-reviews/code-review.json', JSON.stringify(output, null, 2))

    // Post comment (for human visibility)
    await fs.writeFile('ai-review-comment.md', generateComment(output))

    // SUCCESS - we completed our job (reporting findings)
    console.log('✅ Code review completed')
    process.exit(0)

  } catch (error) {
    // FAILURE - we couldn't do our job
    console.error('❌ Code review failed:', error)

    const output: ReviewerOutput = {
      reviewer: 'code-review',
      status: 'failed',
      // ... error details ...
    }
    await fs.writeFile('.ai-reviews/code-review.json', JSON.stringify(output, null, 2))

    process.exit(1)  // Only fail if WE failed
  }
}
```

### Phase 2: Move API Tests to PR Workflow

#### 2.1 Create API test output adapter

Create `scripts/api-test-reporter.ts`:

```typescript
// Wraps vitest output into ReviewerOutput format
// Called after npm run test:api

import { readFileSync, writeFileSync, mkdirSync } from 'fs'

interface VitestResult {
  success: boolean
  results: Array<{
    name: string
    status: 'passed' | 'failed' | 'skipped'
    duration: number
    error?: string
  }>
}

function main() {
  const vitestOutput = JSON.parse(readFileSync('test-results.json', 'utf-8')) as VitestResult

  const output: ReviewerOutput = {
    reviewer: 'api-tests',
    model: 'vitest + real API calls',
    timestamp: new Date().toISOString(),
    status: 'completed',
    verdict: vitestOutput.success ? 'PASS' : 'FAIL',
    confidence: 100,  // Tests are deterministic
    findings: vitestOutput.results
      .filter(r => r.status === 'failed')
      .map(r => ({
        severity: 'critical' as const,
        category: 'test-failure',
        message: r.error || 'Test failed',
        testName: r.name,
      })),
    summary: `${vitestOutput.results.filter(r => r.status === 'passed').length}/${vitestOutput.results.length} tests passed`,
  }

  mkdirSync('.ai-reviews', { recursive: true })
  writeFileSync('.ai-reviews/api-tests.json', JSON.stringify(output, null, 2))

  // Always exit 0 - the final verdict will decide if failures are blocking
  process.exit(0)
}
```

#### 2.2 Update CI workflow for API tests on PR

```yaml
api-tests:
  name: API Integration Tests
  runs-on: ubuntu-latest
  timeout-minutes: 15
  needs: [build]
  # NOW runs on PRs too, not just main
  if: github.event_name == 'pull_request'
  continue-on-error: true  # Don't block - final verdict decides

  steps:
    # ... setup ...

    - name: Run API tests
      run: npm run test:api -- --reporter=json --outputFile=test-results.json
      continue-on-error: true  # Don't fail on test failures

    - name: Generate review artifact
      run: npx tsx scripts/api-test-reporter.ts

    - name: Upload artifact
      uses: actions/upload-artifact@v4
      with:
        name: api-tests-review
        path: .ai-reviews/api-tests.json
```

### Phase 3: Create Final Verdict Script

#### 3.1 Core script with tool use

Create `scripts/ai-final-verdict.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * AI Final Verdict - The "Super AI" Decision Maker
 *
 * Aggregates all reviewer outputs and makes the final PASS/FAIL decision.
 * Has access to tools for fetching additional context when needed.
 *
 * This is the ONLY script that can fail the CI pipeline.
 */

import Anthropic from '@anthropic-ai/sdk'
import { execSync } from 'child_process'
import { readFileSync, readdirSync, existsSync } from 'fs'

// Tool definitions for Claude
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the repository to understand context better',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to file relative to repo root' }
      },
      required: ['path']
    }
  },
  {
    name: 'read_diff',
    description: 'Get the full diff for this PR',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'search_code',
    description: 'Search for code patterns in the repository',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Regex pattern to search for' },
        glob: { type: 'string', description: 'File glob pattern (e.g., "*.ts")' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_commits',
    description: 'Get list of commits in this PR with their messages',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_file_history',
    description: 'Get recent commit history for a specific file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to file' },
        limit: { type: 'number', description: 'Number of commits to show (default 5)' }
      },
      required: ['path']
    }
  },
  {
    name: 'get_related_prs',
    description: 'Find previous PRs that touched the same files',
    input_schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of file paths'
        }
      },
      required: ['files']
    }
  },
  {
    name: 'get_pr_comments',
    description: 'Get existing comments on this PR (human discussion)',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_test_output',
    description: 'Get full test output logs (useful if tests failed)',
    input_schema: {
      type: 'object',
      properties: {
        test_type: {
          type: 'string',
          enum: ['unit', 'api', 'e2e'],
          description: 'Which test suite output to retrieve'
        }
      },
      required: ['test_type']
    }
  }
]

// Tool implementations
function executeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': {
      const path = input.path as string
      if (!existsSync(path)) return `Error: File not found: ${path}`
      try {
        return readFileSync(path, 'utf-8')
      } catch (e) {
        return `Error reading file: ${e}`
      }
    }

    case 'read_diff': {
      const baseBranch = process.env.GITHUB_BASE_REF || 'main'
      try {
        return execSync(`git diff origin/${baseBranch}...HEAD`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
      } catch {
        return execSync('git diff HEAD~1', { encoding: 'utf-8' })
      }
    }

    case 'search_code': {
      const query = input.query as string
      const glob = input.glob as string | undefined
      try {
        const globArg = glob ? `--glob '${glob}'` : ''
        return execSync(`rg '${query}' ${globArg} --max-count 20`, { encoding: 'utf-8' })
      } catch {
        return 'No matches found'
      }
    }

    case 'get_commits': {
      const baseBranch = process.env.GITHUB_BASE_REF || 'main'
      try {
        return execSync(`git log origin/${baseBranch}..HEAD --oneline --no-decorate`, { encoding: 'utf-8' })
      } catch {
        return execSync('git log -10 --oneline --no-decorate', { encoding: 'utf-8' })
      }
    }

    case 'get_file_history': {
      const path = input.path as string
      const limit = (input.limit as number) || 5
      try {
        return execSync(`git log -${limit} --oneline -- '${path}'`, { encoding: 'utf-8' })
      } catch {
        return `No history found for ${path}`
      }
    }

    case 'get_related_prs': {
      const files = input.files as string[]
      // Use GitHub CLI to find related PRs
      try {
        const results: string[] = []
        for (const file of files.slice(0, 3)) {  // Limit to avoid rate limits
          const prs = execSync(`gh pr list --state merged --search "${file}" --limit 3 --json number,title`, { encoding: 'utf-8' })
          results.push(`${file}:\n${prs}`)
        }
        return results.join('\n\n')
      } catch {
        return 'Could not fetch related PRs (gh CLI may not be authenticated)'
      }
    }

    case 'get_pr_comments': {
      const prNumber = process.env.GITHUB_PR_NUMBER
      if (!prNumber) return 'PR number not available'
      try {
        return execSync(`gh pr view ${prNumber} --comments --json comments`, { encoding: 'utf-8' })
      } catch {
        return 'Could not fetch PR comments'
      }
    }

    case 'get_test_output': {
      const testType = input.test_type as string
      const paths: Record<string, string> = {
        unit: 'coverage/test-output.txt',
        api: 'test-results.json',
        e2e: 'playwright-report/results.json'
      }
      const path = paths[testType]
      if (!path || !existsSync(path)) return `No ${testType} test output found`
      return readFileSync(path, 'utf-8')
    }

    default:
      return `Unknown tool: ${name}`
  }
}

async function main() {
  console.log('🎯 Final Verdict - Aggregating all reviews...\n')

  // Load all reviewer outputs
  const reviewDir = '.ai-reviews'
  if (!existsSync(reviewDir)) {
    console.error('❌ No review artifacts found')
    process.exit(1)
  }

  const reviews: Record<string, ReviewerOutput> = {}
  for (const file of readdirSync(reviewDir)) {
    if (file.endsWith('.json')) {
      const name = file.replace('.json', '')
      reviews[name] = JSON.parse(readFileSync(`${reviewDir}/${file}`, 'utf-8'))
      console.log(`📄 Loaded: ${name} (${reviews[name].verdict})`)
    }
  }

  // Get PR metadata
  const prTitle = process.env.GITHUB_PR_TITLE || 'Unknown PR'
  const prBody = process.env.GITHUB_PR_BODY || ''
  const changedFiles = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf-8' })

  // Build the prompt
  const systemPrompt = `You are the final decision maker for a PR to Familjen, a Norwegian family planning app.

Your job is to review what other AI reviewers found and make the final PASS/FAIL decision.

## Decision Criteria

**MUST BLOCK (exit 1):**
- Security vulnerabilities (auth bypass, injection, secrets exposed)
- Data integrity issues (missing error handling on critical ops, no RLS)
- Obvious runtime crashes (null pointer, missing imports)
- Authentication/authorization broken
- API integration tests failing on core functionality

**SHOULD PASS (exit 0):**
- Code style suggestions
- Minor refactoring opportunities
- Non-blocking warnings from reviewers
- API tests failing on optional features (image generation, etc.)
- Visual score > 60 with no critical UI issues

## Important Context

- Familjen is used by busy Norwegian parents
- Wrong data is worse than sync not working
- Every merge to main is a production release
- Individual reviewers can be overly cautious - use your judgment

## Available Tools

You can call tools to get more context if needed. For example:
- If code review mentions an auth issue, you might want to read_file to see the full context
- If tests failed, you might want to get_test_output to understand why
- If you're unsure about a pattern, you might want to search_code to see how it's done elsewhere

Use tools when the reviewer findings alone aren't enough to make a confident decision.`

  const userPrompt = `## PR Information
Title: ${prTitle}
Files Changed:
${changedFiles}

Description:
${prBody}

## Reviewer Findings

${Object.entries(reviews).map(([name, review]) => `
### ${name}
- **Verdict:** ${review.verdict}
- **Confidence:** ${review.confidence}%
- **Summary:** ${review.summary}

**Findings:**
${review.findings.map(f => `- [${f.severity}] ${f.category}: ${f.message}${f.file ? ` (${f.file}:${f.line || '?'})` : ''}`).join('\n') || 'None'}
`).join('\n')}

---

Based on all the above, make your final decision. Use tools if you need more context.

Respond with your reasoning, then conclude with either:
- "FINAL VERDICT: PASS" - PR can be merged
- "FINAL VERDICT: BLOCK" - PR has issues that must be fixed`

  // Initialize Anthropic client
  const client = new Anthropic({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  const model = process.env.OPENROUTER_VERDICT_MODEL || 'anthropic/claude-opus-4'
  console.log(`\n🧠 Using model: ${model}\n`)

  // Run conversation with tool use
  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userPrompt }
  ]

  let response = await client.messages.create({
    model,
    max_tokens: 8000,
    system: systemPrompt,
    tools: TOOLS,
    messages,
  })

  // Tool use loop
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const toolUse of toolUseBlocks) {
      console.log(`🔧 Tool: ${toolUse.name}(${JSON.stringify(toolUse.input)})`)
      const result = executeTool(toolUse.name, toolUse.input as Record<string, unknown>)
      console.log(`   → ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      })
    }

    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ]

    response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    })
  }

  // Extract final response
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  )
  const finalResponse = textBlocks.map(b => b.text).join('\n')

  console.log('\n' + '='.repeat(60))
  console.log('FINAL VERDICT ANALYSIS:')
  console.log('='.repeat(60))
  console.log(finalResponse)
  console.log('='.repeat(60))

  // Parse verdict
  const shouldBlock = finalResponse.includes('FINAL VERDICT: BLOCK')
  const shouldPass = finalResponse.includes('FINAL VERDICT: PASS')

  if (!shouldBlock && !shouldPass) {
    console.error('❌ Could not determine verdict from response')
    process.exit(1)
  }

  // Generate and save PR comment
  const comment = generateFinalComment(reviews, finalResponse, shouldBlock)
  writeFileSync('final-verdict-comment.md', comment)

  if (shouldBlock) {
    console.log('\n❌ BLOCKED - Issues must be addressed')
    process.exit(1)
  } else {
    console.log('\n✅ PASSED - Ready to merge')
    process.exit(0)
  }
}

function generateFinalComment(
  reviews: Record<string, ReviewerOutput>,
  analysis: string,
  blocked: boolean
): string {
  const emoji = blocked ? '❌' : '✅'
  const status = blocked ? 'BLOCKED' : 'APPROVED'

  let comment = `## 🎯 Final AI Verdict: ${emoji} ${status}\n\n`

  // Summary table of all reviewers
  comment += `### Reviewer Summary\n\n`
  comment += `| Reviewer | Verdict | Confidence | Key Findings |\n`
  comment += `|----------|---------|------------|---------------|\n`

  for (const [name, review] of Object.entries(reviews)) {
    const criticalCount = review.findings.filter(f => f.severity === 'critical').length
    const warningCount = review.findings.filter(f => f.severity === 'warning').length
    const findings = criticalCount > 0
      ? `🔴 ${criticalCount} critical`
      : warningCount > 0
        ? `🟡 ${warningCount} warnings`
        : '🟢 Clean'
    comment += `| ${name} | ${review.verdict} | ${review.confidence}% | ${findings} |\n`
  }

  comment += `\n### Analysis\n\n`

  // Extract just the reasoning, not the final verdict line
  const reasoningEnd = analysis.indexOf('FINAL VERDICT:')
  const reasoning = reasoningEnd > 0 ? analysis.slice(0, reasoningEnd).trim() : analysis
  comment += reasoning

  comment += `\n\n---\n`
  comment += `*Final verdict by AI using ${process.env.OPENROUTER_VERDICT_MODEL || 'anthropic/claude-opus-4'}*`

  return comment
}

main().catch(error => {
  console.error('Final verdict failed:', error)
  process.exit(1)
})
```

### Phase 4: Update GitHub Actions Workflow

#### 4.1 New workflow structure

```yaml
name: AI-Powered CI

on:
  push:
    branches: [main, develop]
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ============================================
  # STAGE 1: Fast checks (unchanged)
  # ============================================
  lint:
    # ... unchanged ...

  typecheck:
    # ... unchanged ...

  # ============================================
  # STAGE 2: Unit tests (unchanged)
  # ============================================
  unit-tests:
    # ... unchanged ...

  # ============================================
  # STAGE 3: Build (unchanged)
  # ============================================
  build:
    # ... unchanged ...

  # ============================================
  # STAGE 4: AI Reviewers (parallel, non-blocking)
  # ============================================

  migration-review:
    name: AI Migration Review
    runs-on: ubuntu-latest
    needs: [lint]
    if: github.event_name == 'pull_request'
    # Non-blocking - final verdict decides
    continue-on-error: true
    steps:
      # ... same setup ...
      - name: Run AI migration review
        run: npx tsx scripts/migration-ai-review.ts
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          OPENROUTER_FAST_MODEL: ${{ secrets.OPENROUTER_FAST_MODEL }}

      - name: Upload review artifact
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: migration-review
          path: .ai-reviews/migration-review.json

  ai-code-review:
    name: AI Code Review
    runs-on: ubuntu-latest
    needs: [unit-tests, build]
    if: github.event_name == 'pull_request'
    continue-on-error: true  # Non-blocking
    steps:
      # ... same setup ...
      - name: Run AI code review
        run: npx tsx scripts/ai-code-review.ts --base origin/${{ github.base_ref }}
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          OPENROUTER_FAST_MODEL: ${{ secrets.OPENROUTER_FAST_MODEL }}
          OPENROUTER_CAPABLE_MODEL: ${{ secrets.OPENROUTER_CAPABLE_MODEL }}

      - name: Upload review artifact
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: code-review
          path: .ai-reviews/code-review.json

      # Still post comment for human visibility
      - name: Post review comment
        if: always()
        uses: actions/github-script@v7
        # ... same as before ...

  visual-validation:
    name: AI Visual Validation
    runs-on: ubuntu-latest
    needs: [build]
    if: github.event_name == 'pull_request'
    continue-on-error: true  # Non-blocking
    steps:
      # ... same as before, outputs to .ai-reviews/visual-validation.json ...

  api-tests:
    name: API Integration Tests
    runs-on: ubuntu-latest
    needs: [build]
    # NOW runs on PRs, not just main
    if: github.event_name == 'pull_request'
    continue-on-error: true  # Non-blocking
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci

      - name: Wait for Vercel preview
        run: sleep 60

      - name: Get Vercel Preview URL
        id: vercel
        uses: zentered/vercel-preview-url@v1.1.9
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
        with:
          vercel_project_id: ${{ secrets.VERCEL_PROJECT_ID }}

      - name: Run API tests against preview
        run: npm run test:api -- --reporter=json --outputFile=test-results.json
        continue-on-error: true
        env:
          API_BASE_URL: https://${{ steps.vercel.outputs.preview_url }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          OPENROUTER_TEST_MODEL: ${{ secrets.OPENROUTER_TEST_MODEL }}

      - name: Generate review artifact
        run: npx tsx scripts/api-test-reporter.ts

      - name: Upload review artifact
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: api-tests
          path: .ai-reviews/api-tests.json

  # ============================================
  # STAGE 5: Final Verdict (THE blocker)
  # ============================================
  final-verdict:
    name: 🎯 Final AI Verdict
    runs-on: ubuntu-latest
    needs: [migration-review, ai-code-review, visual-validation, api-tests]
    if: github.event_name == 'pull_request'
    # This job CAN fail and block the PR

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      # Download all review artifacts
      - name: Download migration review
        uses: actions/download-artifact@v4
        continue-on-error: true
        with:
          name: migration-review
          path: .ai-reviews/

      - name: Download code review
        uses: actions/download-artifact@v4
        continue-on-error: true
        with:
          name: code-review
          path: .ai-reviews/

      - name: Download visual validation
        uses: actions/download-artifact@v4
        continue-on-error: true
        with:
          name: visual-validation
          path: .ai-reviews/

      - name: Download API tests
        uses: actions/download-artifact@v4
        continue-on-error: true
        with:
          name: api-tests
          path: .ai-reviews/

      - name: List collected reviews
        run: ls -la .ai-reviews/ || echo "No reviews collected"

      - name: Run final verdict
        run: npx tsx scripts/ai-final-verdict.ts
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          OPENROUTER_VERDICT_MODEL: ${{ secrets.OPENROUTER_VERDICT_MODEL }}
          GITHUB_BASE_REF: ${{ github.base_ref }}
          GITHUB_PR_NUMBER: ${{ github.event.pull_request.number }}
          GITHUB_PR_TITLE: ${{ github.event.pull_request.title }}
          GITHUB_PR_BODY: ${{ github.event.pull_request.body }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Post final verdict comment
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs')
            if (!fs.existsSync('final-verdict-comment.md')) {
              console.log('No final verdict comment to post')
              return
            }

            const comment = fs.readFileSync('final-verdict-comment.md', 'utf8')

            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            })

            const botComment = comments.find(c =>
              c.user.type === 'Bot' && c.body.includes('Final AI Verdict')
            )

            if (botComment) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: botComment.id,
                body: comment
              })
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body: comment
              })
            }

  # ============================================
  # E2E Tests (unchanged, still runs)
  # ============================================
  e2e-preview:
    # ... unchanged ...
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `scripts/ai-review-types.ts` | Create | Shared types for reviewer outputs |
| `scripts/ai-code-review.ts` | Modify | Output JSON to `.ai-reviews/`, always exit 0 |
| `scripts/migration-ai-review.ts` | Modify | Output JSON to `.ai-reviews/`, always exit 0 |
| `scripts/ai-visual-validation.ts` | Modify | Output JSON to `.ai-reviews/`, always exit 0 |
| `scripts/api-test-reporter.ts` | Create | Wrap vitest output in ReviewerOutput format |
| `scripts/ai-final-verdict.ts` | Create | Final verdict with tools |
| `scripts/ai-config.ts` | Modify | Add verdict model config |
| `.github/workflows/ci.yml` | Modify | New job structure with final-verdict |

---

## Cost Estimate

| Component | Per PR | Notes |
|-----------|--------|-------|
| Code Review (2x models) | ~$0.05 | Same as before |
| Migration Review | ~$0.01 | Same as before |
| Visual Validation | ~$0.02 | Same as before |
| API Tests | ~$0.03 | Real API calls |
| **Final Verdict (Opus 4.5)** | ~$0.10-0.20 | New - capable model + tools |
| **Total** | ~$0.20-0.30 | Per PR |

At 100 PRs/month: ~$20-30/month for comprehensive AI review.

---

## Testing the New System

1. Create a test PR with a known security issue
2. Verify individual reviewers flag it but don't block
3. Verify final verdict blocks with clear reasoning

2. Create a test PR with only style suggestions
3. Verify individual reviewers comment but don't block
4. Verify final verdict passes

3. Create a test PR where API tests fail on image generation
4. Verify final verdict passes (optional feature failure)

---

## Rollback Plan

If the new system causes issues:

1. Set `continue-on-error: false` on `ai-code-review` job (restores old blocking behavior)
2. Set `if: false` on `final-verdict` job (disables it completely)
3. Revert scripts to previous versions
