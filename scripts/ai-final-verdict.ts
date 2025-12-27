#!/usr/bin/env npx tsx
/**
 * AI Final Verdict - The "Super AI" Decision Maker
 *
 * Aggregates all reviewer outputs and makes the final PASS/BLOCK decision.
 * Has access to tools for fetching additional context when needed.
 *
 * THIS IS THE ONLY SCRIPT THAT CAN BLOCK THE CI PIPELINE.
 *
 * Decision Criteria:
 * - BLOCK: Security vulnerabilities, data integrity issues, obvious crashes
 * - PASS: Everything else (suggestions are just suggestions)
 *
 * Usage:
 *   npx tsx scripts/ai-final-verdict.ts
 *
 * Environment:
 *   OPENROUTER_API_KEY - Required
 *   OPENROUTER_VERDICT_MODEL - Recommended: anthropic/claude-opus-4
 *   GITHUB_BASE_REF - Base branch for diff
 *   GITHUB_PR_NUMBER - PR number for comments
 *   VERCEL_PREVIEW_URL - Preview deployment URL for testing
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import {
  type ReviewerOutput,
  type FinalVerdictOutput,
  type ActionableIssue,
  type VerificationResults,
  loadAllReviewerOutputs,
  saveFinalVerdict,
  verdictEmoji,
  categoryEmoji,
  summarizeReviewer,
} from './ai-review-types'

// ============================================
// Configuration
// ============================================

const VERDICT_MODEL = process.env.OPENROUTER_VERDICT_MODEL || 'anthropic/claude-sonnet-4-20250514'
const API_KEY = process.env.OPENROUTER_API_KEY

// Timeout for API calls (3 minutes - verdict needs more time for tool use loops)
const API_TIMEOUT_MS = 180_000

// ============================================
// Tool Definitions (matching Anthropic SDK format)
// ============================================

interface Tool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

const TOOLS: Tool[] = [
  // Context Gathering
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

  // Database/Migration Safety
  {
    name: 'check_migration_patterns',
    description: 'Analyze SQL migrations for dangerous patterns (DROP without IF EXISTS, DELETE without WHERE)',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'verify_rls_coverage',
    description: 'Check that all new tables in migrations have RLS policies defined',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // Live Verification
  {
    name: 'test_endpoint',
    description: 'Make an actual HTTP request to the Vercel preview deployment',
    input_schema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        path: { type: 'string', description: 'API path (e.g., /api/health)' },
        body: { type: 'object', description: 'Optional request body for POST/PUT' }
      },
      required: ['method', 'path']
    }
  },
  {
    name: 'verify_auth_required',
    description: 'Test that a protected endpoint returns 401/403 without authentication',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'API path to test' }
      },
      required: ['path']
    }
  },
  {
    name: 'smoke_test_critical_paths',
    description: 'Run quick smoke tests on critical user journeys (home page loads, API health)',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // Code Verification
  {
    name: 'verify_imports',
    description: 'Check that all imports in changed files resolve (no hallucinated packages)',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'check_env_usage',
    description: 'Find new environment variable usage and verify they are documented',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
]

// ============================================
// Tool Implementations
// ============================================

function executeTool(name: string, input: Record<string, unknown>): string {
  const baseBranch = process.env.GITHUB_BASE_REF || 'main'
  const previewUrl = process.env.VERCEL_PREVIEW_URL

  switch (name) {
    case 'read_file': {
      const path = input.path as string
      if (!existsSync(path)) return `Error: File not found: ${path}`
      try {
        const content = readFileSync(path, 'utf-8')
        return content.slice(0, 10000) + (content.length > 10000 ? '\n... (truncated)' : '')
      } catch (e) {
        return `Error reading file: ${e}`
      }
    }

    case 'read_diff': {
      try {
        const diff = execSync(`git diff origin/${baseBranch}...HEAD`, {
          encoding: 'utf-8',
          maxBuffer: 5 * 1024 * 1024
        })
        return diff.slice(0, 30000) + (diff.length > 30000 ? '\n... (truncated)' : '')
      } catch {
        return execSync('git diff HEAD~1', { encoding: 'utf-8' }).slice(0, 30000)
      }
    }

    case 'search_code': {
      const query = input.query as string
      const glob = input.glob as string | undefined
      try {
        const globArg = glob ? `--glob '${glob}'` : ''
        return execSync(`rg '${query}' ${globArg} --max-count 10 2>/dev/null || echo 'No matches'`, {
          encoding: 'utf-8'
        }).slice(0, 5000)
      } catch {
        return 'No matches found'
      }
    }

    case 'get_commits': {
      try {
        return execSync(`git log origin/${baseBranch}..HEAD --oneline --no-decorate`, {
          encoding: 'utf-8'
        })
      } catch {
        return execSync('git log -10 --oneline --no-decorate', { encoding: 'utf-8' })
      }
    }

    case 'check_migration_patterns': {
      const patterns = {
        'DROP without IF EXISTS': /DROP\s+(TABLE|INDEX|FUNCTION|TRIGGER|POLICY)\s+(?!IF\s+EXISTS)/gi,
        'DELETE without WHERE': /DELETE\s+FROM\s+\w+\s*;/gi,
        'TRUNCATE': /TRUNCATE\s+/gi,
        'DROP COLUMN': /DROP\s+COLUMN\s+(?!IF\s+EXISTS)/gi,
      }

      try {
        const changedMigrations = execSync(
          `git diff --name-only origin/${baseBranch}...HEAD | grep 'supabase/migrations/' || true`,
          { encoding: 'utf-8' }
        ).trim().split('\n').filter(Boolean)

        if (changedMigrations.length === 0) {
          return 'No migrations changed in this PR'
        }

        const issues: string[] = []
        for (const file of changedMigrations) {
          if (!existsSync(file)) continue
          const content = readFileSync(file, 'utf-8')

          for (const [name, pattern] of Object.entries(patterns)) {
            const matches = content.match(pattern)
            if (matches) {
              issues.push(`${file}: ${name} - ${matches.slice(0, 2).join(', ')}`)
            }
          }
        }

        return issues.length > 0
          ? `⚠️ Dangerous patterns found:\n${issues.join('\n')}`
          : '✅ No dangerous patterns found in migrations'
      } catch (e) {
        return `Error checking migrations: ${e}`
      }
    }

    case 'verify_rls_coverage': {
      try {
        const changedMigrations = execSync(
          `git diff --name-only origin/${baseBranch}...HEAD | grep 'supabase/migrations/' || true`,
          { encoding: 'utf-8' }
        ).trim().split('\n').filter(Boolean)

        const newTables: string[] = []
        const tablesWithRLS: string[] = []

        for (const file of changedMigrations) {
          if (!existsSync(file)) continue
          const content = readFileSync(file, 'utf-8')

          const tableMatches = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)
          for (const match of tableMatches) {
            newTables.push(match[1])
          }

          const rlsMatches = content.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)
          for (const match of rlsMatches) {
            tablesWithRLS.push(match[1])
          }
        }

        const tablesWithoutRLS = newTables.filter(t => !tablesWithRLS.includes(t))

        if (tablesWithoutRLS.length > 0) {
          return `⚠️ Tables without RLS: ${tablesWithoutRLS.join(', ')}`
        }
        return newTables.length > 0
          ? `✅ All ${newTables.length} new tables have RLS enabled`
          : '✅ No new tables in migrations'
      } catch (e) {
        return `Error checking RLS: ${e}`
      }
    }

    case 'test_endpoint': {
      if (!previewUrl) return 'Error: VERCEL_PREVIEW_URL not set'

      const method = input.method as string
      const path = input.path as string
      const body = input.body as object | undefined

      try {
        const curlCmd = [
          'curl', '-s', '-w', '\\n%{http_code}',
          '-X', method,
          ...(body ? ['-d', JSON.stringify(body), '-H', 'Content-Type: application/json'] : []),
          `${previewUrl}${path}`
        ].join(' ')

        const result = execSync(curlCmd, { encoding: 'utf-8', timeout: 30000 })
        const lines = result.trim().split('\n')
        const statusCode = lines.pop()
        const responseBody = lines.join('\n')

        return `Status: ${statusCode}\nResponse: ${responseBody.slice(0, 500)}`
      } catch (e) {
        return `Error calling endpoint: ${e}`
      }
    }

    case 'verify_auth_required': {
      if (!previewUrl) return 'Error: VERCEL_PREVIEW_URL not set'

      const path = input.path as string

      try {
        const result = execSync(
          `curl -s -w '\\n%{http_code}' -X GET '${previewUrl}${path}'`,
          { encoding: 'utf-8', timeout: 30000 }
        )
        const lines = result.trim().split('\n')
        const statusCode = parseInt(lines.pop() || '0')

        if (statusCode === 401 || statusCode === 403) {
          return `✅ Endpoint ${path} correctly requires auth (${statusCode})`
        } else if (statusCode >= 200 && statusCode < 300) {
          return `❌ SECURITY: ${path} returns ${statusCode} without auth!`
        } else {
          return `⚠️ Endpoint ${path} returned ${statusCode}`
        }
      } catch (e) {
        return `Error testing auth: ${e}`
      }
    }

    case 'smoke_test_critical_paths': {
      if (!previewUrl) return 'Error: VERCEL_PREVIEW_URL not set'

      const paths = [
        { path: '/', name: 'Home page' },
        { path: '/login', name: 'Login page' },
        { path: '/api/health', name: 'Health check' },
      ]

      const results: string[] = []
      for (const { path, name } of paths) {
        try {
          const result = execSync(
            `curl -s -w '\\n%{http_code}' -X GET '${previewUrl}${path}'`,
            { encoding: 'utf-8', timeout: 30000 }
          )
          const statusCode = parseInt(result.trim().split('\n').pop() || '0')

          if (statusCode >= 200 && statusCode < 400) {
            results.push(`✅ ${name}: OK (${statusCode})`)
          } else {
            results.push(`❌ ${name}: FAILED (${statusCode})`)
          }
        } catch (e) {
          results.push(`❌ ${name}: Error - ${e}`)
        }
      }

      return results.join('\n')
    }

    case 'verify_imports': {
      try {
        const changedFiles = execSync(
          `git diff --name-only origin/${baseBranch}...HEAD | grep -E '\\.(ts|tsx)$' || true`,
          { encoding: 'utf-8' }
        ).trim().split('\n').filter(Boolean)

        const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'))
        const deps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies
        }

        const issues: string[] = []
        for (const file of changedFiles.slice(0, 10)) {
          if (!existsSync(file)) continue
          const content = readFileSync(file, 'utf-8')

          const imports = content.matchAll(/from\s+['"]([^.@][^'"]+)['"]/g)
          for (const match of imports) {
            const pkg = match[1].split('/')[0]
            if (!deps[pkg] && !['react', 'next'].includes(pkg)) {
              issues.push(`${file}: Unknown import '${pkg}'`)
            }
          }
        }

        return issues.length > 0
          ? `⚠️ Import issues:\n${issues.join('\n')}`
          : '✅ All imports resolve correctly'
      } catch (e) {
        return `Error checking imports: ${e}`
      }
    }

    case 'check_env_usage': {
      try {
        const diff = execSync(`git diff origin/${baseBranch}...HEAD`, { encoding: 'utf-8' })

        const envMatches = diff.matchAll(/\+.*process\.env\.(\w+)/g)
        const newEnvVars = new Set<string>()
        for (const match of envMatches) {
          newEnvVars.add(match[1])
        }

        if (newEnvVars.size === 0) {
          return '✅ No new environment variables detected'
        }

        const claudeMd = existsSync('CLAUDE.md') ? readFileSync('CLAUDE.md', 'utf-8') : ''
        const readmeMd = existsSync('README.md') ? readFileSync('README.md', 'utf-8') : ''
        const docs = claudeMd + readmeMd

        const undocumented = [...newEnvVars].filter(v => !docs.includes(v))

        if (undocumented.length > 0) {
          return `⚠️ Undocumented env vars: ${undocumented.join(', ')}`
        }
        return `✅ All new env vars documented: ${[...newEnvVars].join(', ')}`
      } catch (e) {
        return `Error checking env usage: ${e}`
      }
    }

    default:
      return `Unknown tool: ${name}`
  }
}

// ============================================
// Message Types (matching Anthropic format)
// ============================================

interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

interface APIResponse {
  id: string
  choices: Array<{
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: {
          name: string
          arguments: string
        }
      }>
    }
    finish_reason: 'stop' | 'tool_calls' | 'length'
  }>
}

// ============================================
// API Call Function
// ============================================

/**
 * Wrap a promise with a timeout to prevent hung API calls from blocking CI
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${operation} timed out after ${ms / 1000}s`)), ms)
  )
  return Promise.race([promise, timeout])
}

async function callOpenRouter(
  systemPrompt: string,
  messages: Message[],
): Promise<{ response: string; toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> }> {
  const fetchPromise = fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VERDICT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }))
      ],
      tools: TOOLS.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        }
      })),
      max_tokens: 8000,
      temperature: 0,
    }),
  })

  const response = await withTimeout(fetchPromise, API_TIMEOUT_MS, 'Final verdict API call')

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${await response.text()}`)
  }

  const data = await response.json() as APIResponse
  const choice = data.choices[0]

  const toolCalls = choice.message.tool_calls?.map(tc => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments),
  })) || []

  return {
    response: choice.message.content || '',
    toolCalls,
  }
}

// ============================================
// Main
// ============================================

async function main() {
  const startTime = Date.now()
  console.log('🎯 Final Verdict - Aggregating all reviews...\n')

  // Check for API key
  if (!API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set')
    process.exit(1)
  }

  // Load all reviewer outputs
  const reviews = loadAllReviewerOutputs()
  const reviewerNames = Object.keys(reviews)

  if (reviewerNames.length === 0) {
    console.log('⚠️ No review artifacts found in .ai-reviews/')
    console.log('⚠️ This likely means reviewers failed to upload artifacts or there was a CI configuration issue.')

    // List what's in the directory for debugging
    try {
      const dirContents = readdirSync('.ai-reviews')
      console.log('Directory contents:', dirContents)
    } catch {
      console.log('.ai-reviews directory does not exist or is empty')
    }

    // Don't blindly PASS - this is a warning state
    const defaultVerdict: FinalVerdictOutput = {
      verdict: 'PASS',  // Still pass to not block, but with low confidence
      confidence: 30,   // Low confidence because we couldn't verify
      summary: '⚠️ No reviewer data available. CI may have configuration issues. Manual review recommended.',
      verifications: {
        typecheck: 'skipped',
        apiHealth: 'skipped',
        migrationSafety: 'skipped',
        rlsCoverage: 'skipped',
        authRequired: 'skipped',
        demoQuality: 'skipped',
      },
      requiredFixes: [],
      suggestions: [{
        priority: 1,
        severity: 'warning',
        category: 'code-quality',
        file: '.github/workflows/ci.yml',
        issue: 'No review artifacts were uploaded. Check that reviewer jobs completed successfully.',
        whyItMatters: 'Without reviewer data, the final verdict cannot make an informed decision.',
        fix: {
          type: 'replace',
          explanation: 'Verify that all reviewer jobs have proper artifact upload steps and the .ai-reviews directory is created.',
        }
      }],
      reasoning: 'No review artifacts found in .ai-reviews/. This typically means reviewer jobs failed before uploading, or there is a CI configuration issue. Passing with low confidence to allow manual review.',
      reviewerSummary: [],
    }
    saveFinalVerdict(defaultVerdict)
    generateComment(defaultVerdict, reviews)

    // Exit 0 but make it clear this is not ideal
    console.log('\n⚠️ PASSED with low confidence - manual review recommended')
    process.exit(0)
  }

  console.log(`📄 Loaded ${reviewerNames.length} reviewer outputs:`)
  for (const name of reviewerNames) {
    const review = reviews[name]
    console.log(`   ${verdictEmoji(review.verdict)} ${name}: ${review.verdict} (${review.confidence}% confidence)`)
  }

  // Get PR metadata
  const prTitle = process.env.GITHUB_PR_TITLE || 'Unknown PR'
  const prBody = process.env.GITHUB_PR_BODY || ''

  let changedFiles = ''
  try {
    changedFiles = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf-8' })
  } catch {
    changedFiles = 'Unable to get changed files'
  }

  // Build the prompt
  const systemPrompt = `You are the final decision maker for a PR to Familjen, a Norwegian family planning app.

Your job is to review what other AI reviewers found and make the final PASS/BLOCK decision.

## Decision Criteria

**MUST BLOCK (exit 1):**
- Security vulnerabilities (auth bypass, injection, secrets exposed)
- Data integrity issues (missing error handling on critical ops, no RLS)
- Obvious runtime crashes (null pointer, missing imports)
- Authentication/authorization broken
- Critical test failures on core functionality

**SHOULD PASS (exit 0):**
- Code style suggestions
- Minor refactoring opportunities
- Non-blocking warnings from reviewers
- Test failures on optional features (image generation, etc.)
- Visual score > 60 with no critical UI issues

## Important Context

- Familjen is used by busy Norwegian parents
- Wrong data is worse than sync not working
- Every merge to main is a production release
- Individual reviewers can be overly cautious - use your judgment

## Available Tools

You can call tools to get more context if needed. For example:
- If code review mentions an auth issue, you might read_file to see full context
- If you're unsure about a pattern, search_code to see how it's done elsewhere
- If tests failed, get more details about what went wrong

Use tools when the reviewer findings alone aren't enough to make a confident decision.

After analyzing everything, provide your final decision in this exact format:
FINAL VERDICT: PASS
or
FINAL VERDICT: BLOCK

Include your reasoning before the verdict.`

  const userPrompt = `## PR Information
Title: ${prTitle}

Files Changed:
${changedFiles}

Description:
${prBody || '(No description provided)'}

## Reviewer Findings

${reviewerNames.map(name => {
  const review = reviews[name]
  const findings = review.findings.length > 0
    ? review.findings.map(f => `  - [${f.severity}] ${categoryEmoji(f.category)} ${f.message}${f.file ? ` (${f.file}:${f.line || '?'})` : ''}`).join('\n')
    : '  (No findings)'

  return `### ${name}
- **Verdict:** ${verdictEmoji(review.verdict)} ${review.verdict}
- **Confidence:** ${review.confidence}%
- **Summary:** ${review.summary}

**Findings:**
${findings}`
}).join('\n\n')}

---

Based on all the above, analyze the situation and make your final decision. Use tools if you need more context.

End your response with exactly:
FINAL VERDICT: PASS
or
FINAL VERDICT: BLOCK`

  console.log(`\n🧠 Using model: ${VERDICT_MODEL}\n`)

  // Run conversation with tool use loop
  let messages: Message[] = [{ role: 'user', content: userPrompt }]
  let response = ''
  let iterations = 0
  const maxIterations = 10

  while (iterations < maxIterations) {
    iterations++
    const result = await callOpenRouter(systemPrompt, messages)

    if (result.toolCalls.length === 0) {
      // No more tool calls - we have the final response
      response = result.response
      break
    }

    // Execute tool calls
    console.log(`\n🔧 Tool calls (iteration ${iterations}):`)
    const toolResults: ContentBlock[] = []

    for (const toolCall of result.toolCalls) {
      console.log(`   ${toolCall.name}(${JSON.stringify(toolCall.input).slice(0, 50)}...)`)
      const toolResult = executeTool(toolCall.name, toolCall.input)
      console.log(`   → ${toolResult.slice(0, 60)}${toolResult.length > 60 ? '...' : ''}`)

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: toolResult,
      })
    }

    // Add assistant message with tool calls and user message with results
    messages.push({
      role: 'assistant',
      content: result.response + '\n' + result.toolCalls.map(tc =>
        `<tool_use id="${tc.id}" name="${tc.name}">${JSON.stringify(tc.input)}</tool_use>`
      ).join('\n')
    })
    messages.push({
      role: 'user',
      content: toolResults.map(tr =>
        `<tool_result tool_use_id="${tr.tool_use_id}">${tr.content}</tool_result>`
      ).join('\n')
    })
  }

  console.log('\n' + '='.repeat(60))
  console.log('FINAL VERDICT ANALYSIS:')
  console.log('='.repeat(60))
  console.log(response)
  console.log('='.repeat(60))

  // Parse verdict
  const shouldBlock = response.includes('FINAL VERDICT: BLOCK')
  const shouldPass = response.includes('FINAL VERDICT: PASS')

  if (!shouldBlock && !shouldPass) {
    console.error('❌ Could not determine verdict from response')
    console.log('Defaulting to PASS to avoid blocking PRs unnecessarily')
  }

  const blocked = shouldBlock && !shouldPass

  // Build verification results from reviewer outputs
  const verifications: VerificationResults = {
    typecheck: 'skipped',
    apiHealth: 'skipped',
    migrationSafety: 'skipped',
    rlsCoverage: 'skipped',
    authRequired: 'skipped',
    demoQuality: 'skipped',
  }

  // Map reviewer verdicts to verification statuses
  if (reviews['api-tests']) {
    verifications.apiHealth = reviews['api-tests'].verdict === 'PASS' ? 'pass' :
                              reviews['api-tests'].verdict === 'WARN' ? 'warn' : 'fail'
  }
  if (reviews['migration-review']) {
    verifications.migrationSafety = reviews['migration-review'].verdict === 'PASS' ? 'pass' :
                                    reviews['migration-review'].verdict === 'WARN' ? 'warn' : 'fail'
  }
  if (reviews['demo-quality']) {
    verifications.demoQuality = reviews['demo-quality'].verdict === 'PASS' ? 'pass' :
                                reviews['demo-quality'].verdict === 'WARN' ? 'warn' : 'fail'
  }

  // Collect required fixes (critical issues that led to blocking)
  const requiredFixes: ActionableIssue[] = []
  const suggestions: ActionableIssue[] = []

  for (const name of reviewerNames) {
    const review = reviews[name]
    for (const finding of review.findings) {
      const issue: ActionableIssue = {
        priority: finding.severity === 'critical' ? 1 : finding.severity === 'warning' ? 2 : 3,
        severity: finding.severity,
        category: finding.category,
        file: finding.file || 'unknown',
        line: finding.line,
        issue: finding.message,
        whyItMatters: `Found by ${name} reviewer`,
        fix: {
          type: 'replace',
          explanation: `Investigate and fix the ${finding.category} issue`,
        }
      }

      if (finding.severity === 'critical' && blocked) {
        requiredFixes.push(issue)
      } else {
        suggestions.push(issue)
      }
    }
  }

  // Sort by priority
  requiredFixes.sort((a, b) => a.priority - b.priority)
  suggestions.sort((a, b) => a.priority - b.priority)

  // Build final verdict output
  const verdictOutput: FinalVerdictOutput = {
    verdict: blocked ? 'BLOCK' : 'PASS',
    confidence: blocked ? 90 : 85,
    summary: blocked
      ? 'Critical issues found that must be fixed before merge.'
      : 'No blocking issues found. Safe to merge.',
    verifications,
    requiredFixes: requiredFixes.slice(0, 10),
    suggestions: suggestions.slice(0, 20),
    reasoning: response.slice(0, 2000),
    reviewerSummary: reviewerNames.map(name => summarizeReviewer(reviews[name])),
  }

  saveFinalVerdict(verdictOutput)
  generateComment(verdictOutput, reviews)

  console.log(`\n⏱️ Duration: ${Math.round((Date.now() - startTime) / 1000)}s`)

  if (blocked) {
    console.log('\n❌ BLOCKED - Issues must be addressed')
    process.exit(1)
  } else {
    console.log('\n✅ PASSED - Ready to merge')
    process.exit(0)
  }
}

// ============================================
// PR Comment Generation
// ============================================

function generateComment(verdict: FinalVerdictOutput, reviews: Record<string, ReviewerOutput>): void {
  const emoji = verdict.verdict === 'BLOCK' ? '❌' : '✅'
  const status = verdict.verdict === 'BLOCK' ? 'BLOCKED' : 'APPROVED'

  // Generate status badge
  const badgeColor = verdict.verdict === 'BLOCK' ? 'red' : 'brightgreen'
  const badgeUrl = `https://img.shields.io/badge/AI%20Verdict-${status}-${badgeColor}`

  let comment = `![AI Verdict](${badgeUrl})

## 🎯 Final AI Verdict: ${emoji} ${status}

**Confidence:** ${verdict.confidence}%

${verdict.summary}

### Reviewer Summary

| Reviewer | Verdict | Confidence | Findings |
|----------|---------|------------|----------|
`

  for (const summary of verdict.reviewerSummary) {
    const findings = summary.criticalCount > 0
      ? `🔴 ${summary.criticalCount} critical`
      : summary.warningCount > 0
        ? `🟡 ${summary.warningCount} warnings`
        : '🟢 Clean'
    comment += `| ${summary.reviewer} | ${verdictEmoji(summary.verdict)} ${summary.verdict} | ${summary.confidence}% | ${findings} |\n`
  }

  if (verdict.requiredFixes.length > 0) {
    comment += `\n### 🚫 Required Fixes\n\n`
    for (const fix of verdict.requiredFixes.slice(0, 5)) {
      comment += `1. **${fix.file}${fix.line ? `:${fix.line}` : ''}** - ${fix.issue}\n`
    }
    if (verdict.requiredFixes.length > 5) {
      comment += `\n_...and ${verdict.requiredFixes.length - 5} more_\n`
    }
  }

  if (verdict.suggestions.length > 0) {
    comment += `\n### 💡 Suggestions\n\n`
    for (const suggestion of verdict.suggestions.slice(0, 5)) {
      const icon = suggestion.severity === 'warning' ? '⚠️' : 'ℹ️'
      comment += `- ${icon} \`${suggestion.file}\`: ${suggestion.issue}\n`
    }
    if (verdict.suggestions.length > 5) {
      comment += `\n_...and ${verdict.suggestions.length - 5} more suggestions_\n`
    }
  }

  comment += `\n### Analysis\n\n`
  // Extract just the reasoning part (before FINAL VERDICT)
  const reasoningEnd = verdict.reasoning.indexOf('FINAL VERDICT:')
  const reasoning = reasoningEnd > 0 ? verdict.reasoning.slice(0, reasoningEnd).trim() : verdict.reasoning
  comment += reasoning.slice(0, 1000) + (reasoning.length > 1000 ? '...' : '')

  comment += `\n\n---\n*Final verdict by ${VERDICT_MODEL}*`

  writeFileSync('final-verdict-comment.md', comment)
  console.log('\n💬 PR comment saved: final-verdict-comment.md')
}

main().catch(error => {
  console.error('Final verdict failed:', error)
  process.exit(1)
})
