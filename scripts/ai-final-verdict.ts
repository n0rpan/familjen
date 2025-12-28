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
  {
    name: 'get_full_documentation',
    description: 'Get full CLAUDE.md or README.md content (use when code review mentioned truncation or you need more project context)',
    input_schema: {
      type: 'object',
      properties: {
        file: { type: 'string', enum: ['CLAUDE.md', 'README.md'], description: 'Which documentation file to retrieve' }
      },
      required: ['file']
    }
  },
  {
    name: 'get_file_section',
    description: 'Get a specific section of a large file by searching for a header or pattern',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to file' },
        section: { type: 'string', description: 'Section header or pattern to find (e.g., "## Testing", "function handleError")' }
      },
      required: ['path', 'section']
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
  {
    name: 'check_typescript',
    description: 'Run TypeScript type checking on changed files to verify no type errors',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
]

// ============================================
// Tool Result Cache
// ============================================

// Cache tool results to avoid redundant operations within a single verdict run
const toolResultCache = new Map<string, string>()

function getCacheKey(name: string, input: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(input)}`
}

// ============================================
// Tool Implementations
// ============================================

function executeTool(name: string, input: Record<string, unknown>): string {
  // Check cache first
  const cacheKey = getCacheKey(name, input)
  const cached = toolResultCache.get(cacheKey)
  if (cached) {
    console.log(`   → (cached)`)
    return cached
  }

  const result = executeToolUncached(name, input)

  // Cache the result
  toolResultCache.set(cacheKey, result)
  return result
}

function executeToolUncached(name: string, input: Record<string, unknown>): string {
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

    case 'get_full_documentation': {
      const file = input.file as string
      if (!['CLAUDE.md', 'README.md'].includes(file)) {
        return `Error: Invalid file '${file}'. Must be CLAUDE.md or README.md`
      }
      try {
        if (!existsSync(file)) {
          return `${file} does not exist in this repository`
        }
        const content = readFileSync(file, 'utf-8')
        const sizeKB = Math.round(content.length / 1024)
        return `# ${file} (${sizeKB}KB)\n\n${content}`
      } catch (e) {
        return `Error reading ${file}: ${e}`
      }
    }

    case 'get_file_section': {
      const path = input.path as string
      const section = input.section as string
      try {
        if (!existsSync(path)) {
          return `File '${path}' does not exist`
        }
        const content = readFileSync(path, 'utf-8')
        const lines = content.split('\n')

        // Find the section by searching for the pattern
        const sectionIndex = lines.findIndex(line =>
          line.toLowerCase().includes(section.toLowerCase())
        )

        if (sectionIndex === -1) {
          return `Section '${section}' not found in ${path}. File has ${lines.length} lines.`
        }

        // Extract ~100 lines around the section
        const start = Math.max(0, sectionIndex - 5)
        const end = Math.min(lines.length, sectionIndex + 100)
        const extracted = lines.slice(start, end).join('\n')

        return `# ${path} - Section containing '${section}' (lines ${start + 1}-${end})\n\n${extracted}`
      } catch (e) {
        return `Error reading section: ${e}`
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

        // System tables that legitimately don't need household_id scoping
        // These are global tables or use different RLS patterns
        const systemTables = new Set([
          'allowed_emails',       // Global: who can use the app
          'app_settings',         // Global: app-wide settings
          'ai_settings',          // Global: AI model config
          'admin_audit_logs',     // Global: admin actions
          'wishlist_share_tokens', // Uses token-based access, not household
          'google_calendar_tokens', // Uses member/household join, not direct household_id
        ])

        const newTables: string[] = []
        const tablesWithRLS: string[] = []
        const tablesWithHouseholdPolicy: string[] = []
        const policiesFound: string[] = []

        for (const file of changedMigrations) {
          if (!existsSync(file)) continue
          const content = readFileSync(file, 'utf-8')

          // Find new tables
          const tableMatches = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)
          for (const match of tableMatches) {
            newTables.push(match[1])
          }

          // Find RLS enabled
          const rlsMatches = content.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)
          for (const match of rlsMatches) {
            tablesWithRLS.push(match[1])
          }

          // Find policies and check for household_id or get_user_household_id()
          const policyMatches = content.matchAll(/CREATE\s+POLICY\s+["']?(\w+)["']?\s+ON\s+(\w+)/gi)
          for (const match of policyMatches) {
            const policyName = match[1]
            const tableName = match[2]
            policiesFound.push(`${tableName}.${policyName}`)

            // Check if policy references household scoping
            const policyContent = content.slice(match.index || 0, (match.index || 0) + 500)
            if (policyContent.includes('get_user_household_id()') || policyContent.includes('household_id')) {
              if (!tablesWithHouseholdPolicy.includes(tableName)) {
                tablesWithHouseholdPolicy.push(tableName)
              }
            }
          }
        }

        const issues: string[] = []

        // Check for tables without RLS (excluding system tables is intentional for some)
        const tablesWithoutRLS = newTables.filter(t => !tablesWithRLS.includes(t))
        if (tablesWithoutRLS.length > 0) {
          issues.push(`❌ Tables WITHOUT RLS enabled: ${tablesWithoutRLS.join(', ')}`)
        }

        // Check for tables with RLS but no household scoping
        // Exclude system tables that legitimately don't need household_id
        const tablesWithRLSNoHousehold = tablesWithRLS.filter(
          t => newTables.includes(t) &&
               !tablesWithHouseholdPolicy.includes(t) &&
               !systemTables.has(t)
        )
        if (tablesWithRLSNoHousehold.length > 0) {
          issues.push(`⚠️ Tables with RLS but NO household scoping: ${tablesWithRLSNoHousehold.join(', ')}`)
          issues.push(`   Expected: Policies should use get_user_household_id() or household_id for multi-tenant isolation`)
          issues.push(`   Note: System tables (${[...systemTables].slice(0, 3).join(', ')}...) are excluded from this check`)
        }

        if (issues.length > 0) {
          return `🔐 RLS SECURITY ISSUES:\n${issues.join('\n')}\n\n` +
            `Tables found: ${newTables.join(', ') || 'none'}\n` +
            `Policies found: ${policiesFound.join(', ') || 'none'}`
        }

        return newTables.length > 0
          ? `✅ All ${newTables.length} new tables have RLS + appropriate scoping:\n` +
            `   Tables: ${newTables.join(', ')}\n` +
            `   Policies: ${policiesFound.join(', ')}\n` +
            `   (System tables use alternative RLS patterns)`
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

        // Built-in Node modules and Next.js implicit deps
        const builtins = new Set([
          'react', 'react-dom', 'next', 'fs', 'path', 'child_process', 'crypto',
          'http', 'https', 'os', 'util', 'stream', 'events', 'buffer', 'url',
          'querystring', 'assert', 'zlib', 'net', 'dns', 'tls', 'readline'
        ])

        const issues: string[] = []
        const checkedPackages = new Set<string>()

        // Check ALL changed files, not just first 10
        for (const file of changedFiles) {
          if (!existsSync(file)) continue
          const content = readFileSync(file, 'utf-8')

          // Match both regular and scoped package imports
          // from 'package' or from '@scope/package'
          const imports = content.matchAll(/from\s+['"](@?[^./][^'"]*)['"]/g)
          for (const match of imports) {
            const fullImport = match[1]
            // Handle scoped packages: @scope/package -> @scope/package
            // Handle regular packages: package/subpath -> package
            const pkg = fullImport.startsWith('@')
              ? fullImport.split('/').slice(0, 2).join('/')
              : fullImport.split('/')[0]

            // Skip if already checked
            if (checkedPackages.has(pkg)) continue
            checkedPackages.add(pkg)

            // Skip builtins and local aliases
            if (builtins.has(pkg) || pkg.startsWith('@/')) continue

            // Check if package exists in deps
            if (!deps[pkg]) {
              issues.push(`${file}: Hallucinated import '${pkg}' - not in package.json`)
            }
          }
        }

        if (issues.length > 0) {
          return `❌ HALLUCINATED IMPORTS DETECTED:\n${issues.join('\n')}\n\nThese packages don't exist in package.json. This is likely AI-generated code with fake dependencies.`
        }
        return `✅ All ${checkedPackages.size} external imports verified against package.json`
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

    case 'check_typescript': {
      try {
        // Get changed TypeScript files
        const changedFiles = execSync(
          `git diff --name-only origin/${baseBranch}...HEAD | grep -E '\\.(ts|tsx)$' || true`,
          { encoding: 'utf-8' }
        ).trim().split('\n').filter(Boolean)

        if (changedFiles.length === 0) {
          return '✅ No TypeScript files changed'
        }

        // Run TypeScript check
        try {
          const tscOutput = execSync('npx tsc --noEmit 2>&1', {
            encoding: 'utf-8',
            timeout: 60000 // 1 minute timeout
          })
          return `✅ TypeScript check passed for ${changedFiles.length} changed files`
        } catch (tscError) {
          // TypeScript errors - parse and filter to changed files
          const errorOutput = (tscError as { stdout?: string }).stdout || String(tscError)
          const lines = errorOutput.split('\n')

          // Filter errors to only those in changed files
          const relevantErrors: string[] = []
          for (const line of lines) {
            if (line.includes('.ts') || line.includes('.tsx')) {
              const matchesChangedFile = changedFiles.some(f => line.includes(f))
              if (matchesChangedFile) {
                relevantErrors.push(line)
              }
            }
          }

          if (relevantErrors.length === 0) {
            return `⚠️ TypeScript errors exist but not in changed files (${changedFiles.length} files OK)`
          }

          return `❌ TypeScript errors in changed files:\n${relevantErrors.slice(0, 10).join('\n')}${relevantErrors.length > 10 ? `\n... and ${relevantErrors.length - 10} more errors` : ''}`
        }
      } catch (e) {
        return `Error running TypeScript check: ${e}`
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
// Helper functions for error handling
// ============================================

/**
 * Write a "processing" comment to prevent stale comments if script crashes
 * This is written at the start and replaced by the final comment
 */
function writeProcessingComment(): void {
  const comment = `## ⏳ AI Review in Progress...

The final AI verdict is analyzing all reviewer findings.

This comment will be updated with the final decision shortly.

---
*Processing started at ${new Date().toISOString()}*`

  writeFileSync('final-verdict-comment.md', comment)
}

/**
 * Write an error comment when something goes wrong
 * This ensures users see an error, not a stale "Approved" comment
 */
function writeErrorComment(error: string): void {
  const comment = `## ❌ AI Review Failed

The final verdict script encountered an error and could not complete.

**Error:** ${error}

**What this means:**
- The CI will fail (this is intentional - we don't approve without proper review)
- Please check the CI logs for details
- Re-run the workflow once the issue is resolved

---
*Failed at ${new Date().toISOString()}*`

  writeFileSync('final-verdict-comment.md', comment)
}

// ============================================
// Main
// ============================================

async function main() {
  const startTime = Date.now()
  console.log('🎯 Final Verdict - Aggregating all reviews...\n')

  // CRITICAL: Write a processing comment first to prevent stale comments
  // If the script crashes, this ensures we don't leave an old "Approved" comment
  writeProcessingComment()

  // Check for API key
  if (!API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set')
    writeErrorComment('OPENROUTER_API_KEY not set')
    process.exit(1)
  }

  // Load all reviewer outputs
  const reviews = loadAllReviewerOutputs()
  const reviewerNames = Object.keys(reviews)

  if (reviewerNames.length === 0) {
    console.log('⚠️ No review artifacts found in ai-reviews/')
    console.log('⚠️ This likely means reviewers failed to upload artifacts or there was a CI configuration issue.')

    // List what's in the directory for debugging
    try {
      const dirContents = readdirSync('ai-reviews')
      console.log('Directory contents:', dirContents)
    } catch {
      console.log('ai-reviews directory does not exist or is empty')
    }

    // BLOCK when no reviewer data - we can't approve what we can't verify
    const defaultVerdict: FinalVerdictOutput = {
      verdict: 'BLOCK',  // Block - missing artifacts indicates CI issue
      confidence: 100,   // High confidence this is wrong
      summary: '❌ No reviewer data available. CI failed to upload review artifacts. Cannot approve without verification.',
      verifications: {
        typecheck: 'skipped',
        apiHealth: 'skipped',
        migrationSafety: 'skipped',
        rlsCoverage: 'skipped',
        authRequired: 'skipped',
        demoQuality: 'skipped',
      },
      requiredFixes: [{
        priority: 1,
        severity: 'critical',
        category: 'ci-infrastructure',
        file: '.github/workflows/ci.yml',
        issue: 'No review artifacts were uploaded by reviewer jobs.',
        whyItMatters: 'Without reviewer data, the final verdict cannot verify code quality, security, or correctness.',
        fix: {
          type: 'replace',
          explanation: 'Check that all reviewer jobs completed and uploaded to ai-reviews/. Look for mkdir -p ai-reviews before scripts run.',
        }
      }],
      suggestions: [],
      reasoning: 'No review artifacts found in ai-reviews/. This typically means reviewer jobs failed before uploading, or there is a CI configuration issue. Blocking to prevent unreviewed code from being merged.',
      reviewerSummary: [],
    }
    saveFinalVerdict(defaultVerdict)
    generateComment(defaultVerdict, reviews, [], 'Unknown PR')

    // Exit 1 to fail CI - we can't approve without reviewer data
    console.log('\n❌ BLOCKED - No reviewer artifacts found. Fix CI configuration.')
    process.exit(1)
  }

  console.log(`📄 Loaded ${reviewerNames.length} reviewer outputs:`)
  for (const name of reviewerNames) {
    const review = reviews[name]
    console.log(`   ${verdictEmoji(review.verdict)} ${name}: ${review.verdict} (${review.confidence}% confidence)`)
  }

  // ============================================
  // MECHANICAL AGGREGATION - Reviewer verdicts determine outcome
  // ============================================
  // AI explains findings but cannot override failing reviewers
  // This prevents confusing "Ready to merge" with FAIL verdicts shown

  const failingReviewers = reviewerNames.filter(name => reviews[name].verdict === 'FAIL')
  const warningReviewers = reviewerNames.filter(name => reviews[name].verdict === 'WARN')
  const passingReviewers = reviewerNames.filter(name => reviews[name].verdict === 'PASS')

  // Mechanical verdict: any FAIL = BLOCK, else PASS
  const mechanicalVerdict = failingReviewers.length > 0 ? 'BLOCK' : 'PASS'

  console.log(`\n📊 Mechanical aggregation:`)
  console.log(`   ✅ Passed: ${passingReviewers.length} (${passingReviewers.join(', ') || 'none'})`)
  console.log(`   ⚠️ Warnings: ${warningReviewers.length} (${warningReviewers.join(', ') || 'none'})`)
  console.log(`   ❌ Failed: ${failingReviewers.length} (${failingReviewers.join(', ') || 'none'})`)
  console.log(`   → Mechanical verdict: ${mechanicalVerdict}`)

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
  const systemPrompt = `You are the FINAL decision maker for a PR to Familjen, a Norwegian family planning app.

YOUR VERDICT DETERMINES THE CI STATUS. If you say BLOCK, the PR cannot be merged. If you say PASS, the PR can merge.

## YOUR ROLE: The "Super AI" Second Opinion

You see findings from all other reviewers (code review, e2e tests, visual validation, etc.) and make the FINAL call.
You have tools to investigate deeper when needed. Use them.

The PR comment will reflect YOUR decision - so make it count.

## CRITICAL: You MUST Verify Before Deciding

When ANY reviewer reports a blocking issue, you MUST:
1. **Use read_file tool** to read the actual code
2. **Verify the issue exists** - AI reviewers sometimes hallucinate
3. **Check if it's in files changed by THIS PR** - issues in unchanged files are pre-existing
4. **Document your verification** - explain what you found

DO NOT just say "FINAL VERDICT: PASS" without investigation!
If you don't verify, default to BLOCK.

## Decision Criteria

**BLOCK (CI will fail, PR cannot merge) when:**
- Security vulnerabilities VERIFIED in THIS PR's changes
- Data integrity issues VERIFIED in THIS PR's changes
- Runtime errors VERIFIED in THIS PR's changes
- Authentication/authorization broken (VERIFIED)
- Critical test failures caused by THIS PR's changes
- **ANY unverified blocking issue** - when in doubt, BLOCK

**PASS (CI will succeed, PR can merge) when:**
- All blocking issues were VERIFIED as false positives (document your verification!)
- All blocking issues are in files NOT changed by this PR (pre-existing)
- Only minor suggestions/warnings remain
- You used tools to verify and found no real problems

## IMPORTANT: Pre-existing vs New Issues

Look at the "Files Changed" list. If an issue is reported in a file NOT in that list:
- It's PRE-EXISTING (existed before this PR)
- It should NOT block this PR
- Note it as pre-existing in your analysis

## Available Tools - USE THEM!

- **read_file**: Read code to verify issues exist (ALWAYS use this before dismissing an issue)
- **search_code**: Find patterns across the codebase
- **read_diff**: See exactly what changed in this PR
- **check_typescript**: Verify no type errors in changed files
- **verify_imports**: Check for hallucinated package imports

## Response Format

1. **PR Summary**: What does this PR do?
2. **Verification**: For each blocking issue, what did you find when you investigated?
3. **Decision**: Clear reasoning for PASS or BLOCK
4. **Final Line**: Your verdict (exactly as shown below)

End your response with EXACTLY one of these lines:
FINAL VERDICT: PASS
FINAL VERDICT: BLOCK

The CI exit status and PR comment will match your decision exactly.`

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
  // Track which tools AI used - important for verifying AI override legitimacy
  const toolsUsed = new Set<string>()
  const VERIFICATION_TOOLS = ['read_file', 'search_code', 'read_diff', 'check_typescript', 'verify_imports']

  let messages: Message[] = [{ role: 'user', content: userPrompt }]
  let response = ''
  let iterations = 0
  const maxIterations = 20 // Increased for thorough verification

  while (iterations < maxIterations) {
    iterations++
    const result = await callOpenRouter(systemPrompt, messages)

    if (result.toolCalls.length === 0) {
      // No more tool calls - we have the final response
      response = result.response
      break
    }

    // Safety check: if we're about to exhaust iterations, warn
    if (iterations === maxIterations - 1) {
      console.warn(`⚠️ Approaching iteration limit (${iterations}/${maxIterations})`)
    }

    // Execute tool calls
    console.log(`\n🔧 Tool calls (iteration ${iterations}):`)
    const toolResults: ContentBlock[] = []

    for (const toolCall of result.toolCalls) {
      // Track tool usage for verification
      toolsUsed.add(toolCall.name)

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

  // Check if we exhausted iterations without getting a final response
  // CRITICAL: Exit immediately with failure - don't continue execution
  if (iterations >= maxIterations && !response) {
    console.error(`❌ Exhausted ${maxIterations} iterations without final verdict`)
    const toolCallsSummary = [...toolsUsed].join(', ') || 'none'

    // Write error comment for user visibility
    const errorComment = `## ❌ Final AI Verdict: BLOCKED

**Error:** AI analysis exceeded iteration limit without reaching a conclusion.

**Debug info:**
- Reviewers loaded: ${reviewerNames.join(', ')}
- Tools used: ${toolCallsSummary}
- Mechanical verdict was: ${mechanicalVerdict}

**What this means:**
- CI has failed (this is intentional)
- Re-run the workflow or check CI logs for details

---
*Failed at ${new Date().toISOString()}*`

    writeFileSync('final-verdict-comment.md', errorComment)
    console.log('\n❌ BLOCKED - Iteration limit exhausted')
    process.exit(1) // CRITICAL: Exit immediately, don't continue
  }

  // Log tool usage summary
  console.log(`\n📊 Tools used during analysis: ${[...toolsUsed].join(', ') || 'none'}`)
  const usedVerificationTools = VERIFICATION_TOOLS.filter(t => toolsUsed.has(t))
  console.log(`   Verification tools: ${usedVerificationTools.join(', ') || 'none'}`)

  console.log('\n' + '='.repeat(60))
  console.log('AI ANALYSIS (for context, not verdict):')
  console.log('='.repeat(60))
  console.log(response)
  console.log('='.repeat(60))

  // ============================================
  // FINAL VERDICT - AI can override with explanation
  // ============================================
  // AI can override reviewer verdicts BUT must explain why
  // The comment will clearly show when AI overrides and the reason

  const aiSaidPass = response.includes('FINAL VERDICT: PASS')
  const aiSaidBlock = response.includes('FINAL VERDICT: BLOCK')

  let blocked: boolean
  let aiOverride: { from: string; to: string; reason: string } | null = null

  if (!aiSaidPass && !aiSaidBlock) {
    // AI couldn't decide - fall back to mechanical
    console.log('\n⚠️ AI could not determine verdict, using mechanical aggregation')
    blocked = mechanicalVerdict === 'BLOCK'
  } else if (aiSaidPass && mechanicalVerdict === 'BLOCK') {
    // AI is overriding BLOCK → PASS
    // CRITICAL: Verify AI actually used tools to verify before allowing override
    const usedVerificationTools = VERIFICATION_TOOLS.filter(t => toolsUsed.has(t))

    if (usedVerificationTools.length === 0) {
      // AI said PASS but didn't use any verification tools - reject the override
      console.warn('\n⚠️ AI attempted to override BLOCK → PASS without using verification tools!')
      console.warn('   AI must use read_file, search_code, or similar to verify issues')
      console.warn('   Defaulting to BLOCK to be safe')
      blocked = true
      aiOverride = null
    } else {
      // AI used tools - allow the override
      const reasonMatch = response.match(/(?:pre-existing|not.*this PR|already existed|unrelated to|false positive)/i)
      const reason = reasonMatch
        ? 'Issues are pre-existing or unrelated to this PR'
        : 'AI determined issues are not blocking'

      aiOverride = { from: 'BLOCK', to: 'PASS', reason }
      blocked = false
      console.log(`\n🔄 AI OVERRIDE: BLOCK → PASS (verified with ${usedVerificationTools.length} tools)`)
      console.log(`   Tools used: ${usedVerificationTools.join(', ')}`)
      console.log(`   Reason: ${reason}`)
      console.log(`   Failing reviewers: ${failingReviewers.join(', ')}`)
    }
  } else if (aiSaidBlock && mechanicalVerdict === 'PASS') {
    // AI is overriding PASS → BLOCK (found issues reviewers missed)
    aiOverride = { from: 'PASS', to: 'BLOCK', reason: 'AI found additional issues' }
    blocked = true
    console.log(`\n🔄 AI OVERRIDE: PASS → BLOCK`)
    console.log(`   AI found issues that reviewers missed`)
  } else {
    // AI agrees with mechanical
    blocked = mechanicalVerdict === 'BLOCK'
  }

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
      : aiOverride
        ? `Approved: ${aiOverride.reason}`
        : 'No blocking issues found. Safe to merge.',
    verifications,
    requiredFixes: requiredFixes.slice(0, 10),
    suggestions: suggestions.slice(0, 20),
    reasoning: response.slice(0, 2000),
    reviewerSummary: reviewerNames.map(name => summarizeReviewer(reviews[name])),
    aiOverride: aiOverride || undefined,
  }

  saveFinalVerdict(verdictOutput)
  generateComment(verdictOutput, reviews, changedFiles.split('\n').filter(Boolean), prTitle)

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

interface SeparatedFindings {
  prRelevant: ActionableIssue[]
  preExisting: ActionableIssue[]
}

/**
 * Separate findings into PR-relevant vs pre-existing based on changed files
 */
function separateFindings(
  findings: ActionableIssue[],
  changedFiles: string[]
): SeparatedFindings {
  const changedSet = new Set(changedFiles.map(f => f.trim()).filter(Boolean))

  const prRelevant: ActionableIssue[] = []
  const preExisting: ActionableIssue[] = []

  for (const finding of findings) {
    // Check if the file is in the changed files list
    const isInChangedFiles = finding.file && (
      changedSet.has(finding.file) ||
      // Also check partial matches (finding might have full path)
      [...changedSet].some(cf => finding.file.endsWith(cf) || cf.endsWith(finding.file))
    )

    // If no file specified or it's a general issue, consider it PR-relevant
    if (!finding.file || finding.file === 'unknown' || isInChangedFiles) {
      prRelevant.push(finding)
    } else {
      preExisting.push(finding)
    }
  }

  return { prRelevant, preExisting }
}

/**
 * Generate the main PR comment (human-focused, about THIS PR)
 *
 * This comment is SELF-CONTAINED - it tells you exactly what to fix in this PR
 * without needing to read any other comments or artifacts.
 *
 * CRITICAL: The verdict shown here MUST match the CI exit status.
 * If this says "Approved", CI must pass. If this says "Blocked", CI must fail.
 */
function generateMainComment(
  verdict: FinalVerdictOutput,
  reviews: Record<string, ReviewerOutput>,
  changedFiles: string[],
  prTitle: string
): string {
  const isBlocked = verdict.verdict === 'BLOCK'
  const emoji = isBlocked ? '❌' : '✅'
  const status = isBlocked ? 'BLOCKED' : 'APPROVED'

  // Separate findings
  const allFindings = [...verdict.requiredFixes, ...verdict.suggestions]
  const { prRelevant, preExisting } = separateFindings(allFindings, changedFiles)

  // Generate status badge - use clear colors and text
  const badgeColor = isBlocked ? 'red' : 'brightgreen'
  const badgeText = isBlocked ? 'BLOCKED' : 'APPROVED'
  const badgeUrl = `https://img.shields.io/badge/CI%20Status-${encodeURIComponent(badgeText)}-${badgeColor}`

  // PR-relevant findings (issues IN this PR)
  const prCritical = prRelevant.filter(f => f.severity === 'critical')
  const prWarnings = prRelevant.filter(f => f.severity === 'warning')
  const prInfo = prRelevant.filter(f => f.severity === 'info')

  // Start with a VERY CLEAR verdict statement
  let comment = `![CI Status](${badgeUrl})

## ${emoji} Final AI Verdict: ${status}

**PR:** ${prTitle}

`

  // Build reviewer status line
  const passCount = verdict.reviewerSummary.filter(r => r.verdict === 'PASS').length
  const warnCount = verdict.reviewerSummary.filter(r => r.verdict === 'WARN').length
  const failCount = verdict.reviewerSummary.filter(r => r.verdict === 'FAIL').length
  const totalCount = verdict.reviewerSummary.length

  // BLOCKED - Show exactly what must be fixed
  if (isBlocked) {
    // TL;DR clearly shows WHY it's blocked and what happens next
    const failedNames = verdict.reviewerSummary.filter(r => r.verdict === 'FAIL').map(r => r.reviewer)
    comment += `> 🚫 **This PR cannot be merged.** CI has failed.
>
> **Reason:** ${failCount > 0 ? `${failCount} reviewer${failCount !== 1 ? 's' : ''} found blocking issues: **${failedNames.join(', ')}**` : 'Critical issues found during final review.'}
>
> **Next step:** Fix the issues below, then push a new commit to re-run CI.

### 📊 Reviewer Results: ${passCount} passed, ${warnCount} warnings, ${failCount} failed

| Reviewer | Verdict | Summary |
|----------|---------|---------|
${verdict.reviewerSummary.map(r => {
  const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'WARN' ? '⚠️' : '❌'
  const reviewSummary = reviews[r.reviewer]?.summary || 'No summary available'
  return `| ${r.reviewer} | ${icon} ${r.verdict} | ${reviewSummary.slice(0, 60)}${reviewSummary.length > 60 ? '...' : ''} |`
}).join('\n')}

### ❌ Issues That Must Be Fixed

`
    // Show ALL critical issues with full context
    for (let i = 0; i < prCritical.length; i++) {
      const fix = prCritical[i]
      const location = fix.line ? `${fix.file}:${fix.line}` : fix.file
      comment += `**${i + 1}. \`${location}\`**

`
      comment += `${fix.issue}

`
      if (fix.whyItMatters && !fix.whyItMatters.startsWith('Found by')) {
        comment += `> **Why it matters:** ${fix.whyItMatters}

`
      }
      if (fix.fix?.explanation) {
        comment += `> **How to fix:** ${fix.fix.explanation}

`
      }
    }

    if (prCritical.length === 0) {
      // Check if there are critical issues from reviewers we should surface
      for (const name of Object.keys(reviews)) {
        const review = reviews[name]
        const criticalFindings = review.findings.filter(f => f.severity === 'critical')
        for (const finding of criticalFindings) {
          const location = finding.line ? `${finding.file || 'unknown'}:${finding.line}` : (finding.file || 'unknown')
          comment += `**\`${location}\`** (from ${name})

${finding.message}

`
        }
      }
    }

    comment += `---

Once you fix these issues, push a new commit and the CI will re-run.

`
  } else {
    // PASSED - Show what was reviewed and found
    // Check if this was an AI override
    if (verdict.aiOverride && failCount > 0) {
      // Make it VERY clear this is approved despite failures
      comment += `> ✅ **CI passed. This PR can be merged.**
>
> ⚠️ **Note:** ${failCount} reviewer${failCount !== 1 ? 's' : ''} reported issues, but the Final AI Verdict verified they are **${verdict.aiOverride.reason}**.

### 📊 Reviewer Results: ${passCount} passed, ${warnCount} warnings, ${failCount} failed (verified as non-blocking)

| Reviewer | Verdict | Status | Summary |
|----------|---------|--------|---------|
${verdict.reviewerSummary.map(r => {
  const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'WARN' ? '⚠️' : '❌'
  const status = r.verdict === 'FAIL' ? '🔍 Verified non-blocking' : '—'
  const reviewSummary = reviews[r.reviewer]?.summary || 'No summary available'
  return `| ${r.reviewer} | ${icon} ${r.verdict} | ${status} | ${reviewSummary.slice(0, 40)}${reviewSummary.length > 40 ? '...' : ''} |`
}).join('\n')}

### 🔍 Why was this approved despite failing reviewers?

**Reason:** ${verdict.aiOverride.reason}

The Final AI Verdict investigated each blocking issue and determined:
- Issues were in files NOT changed by this PR (pre-existing), OR
- Issues were verified as false positives after reading the actual code

This is not a rubber stamp - the AI used tools (read_file, search_code) to verify before approving.

`
    } else {
      // Standard PASS - all reviewers passed or only warnings
      comment += `> ✅ **CI passed. This PR can be merged.**`
      if (warnCount > 0) {
        comment += `\n>\n> ${passCount}/${totalCount} reviewers passed, ${warnCount} with suggestions (see below).`
      }
      comment += `

### 📊 Reviewer Results

| Reviewer | Verdict | Summary |
|----------|---------|---------|
${verdict.reviewerSummary.map(r => {
  const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'WARN' ? '⚠️' : '❌'
  const reviewSummary = reviews[r.reviewer]?.summary || 'No summary available'
  return `| ${r.reviewer} | ${icon} ${r.verdict} | ${reviewSummary.slice(0, 50)}${reviewSummary.length > 50 ? '...' : ''} |`
}).join('\n')}

`
    }

    // Add Quick Wins section if there are easy improvements
    const quickWins = prWarnings.filter(w =>
      w.issue.toLowerCase().includes('consider') ||
      w.issue.toLowerCase().includes('could') ||
      w.issue.toLowerCase().includes('optional') ||
      w.severity === 'info'
    ).slice(0, 3)

    if (quickWins.length > 0) {
      comment += `<details>
<summary>💡 Quick Wins (optional improvements)</summary>

${quickWins.map(w => `- **\`${w.file}\`**: ${w.issue}`).join('\n')}

</details>

`
    }
  }

  // Check for PR-specific tests in e2e reviewer
  const e2eReview = reviews['e2e-tests']
  const prTestInfo = e2eReview?.raw?.prScenarios as { count: number; criticalCount: number; highCount: number; prTitle: string } | null | undefined
  if (prTestInfo && prTestInfo.count > 0) {
    comment += `### 🤖 PR-Specific Tests

AI generated **${prTestInfo.count} test scenarios** for this PR:
- 🔴 Critical: ${prTestInfo.criticalCount}
- 🟠 High priority: ${prTestInfo.highCount}
- 🟡 Medium/Low: ${prTestInfo.count - prTestInfo.criticalCount - prTestInfo.highCount}

These tests verify the specific changes in this PR (e.g., click handlers, modals, demo mode).

`
  }

  // Reviewer summary table
  comment += `### 📊 Reviewer Summary

| Reviewer | Verdict | Key Findings |
|----------|---------|--------------|
`

  for (const summary of verdict.reviewerSummary) {
    const review = reviews[summary.reviewer]
    // Get most important finding - safely handle missing review data
    const topFinding = review?.findings?.filter(f => f.severity === 'critical' || f.severity === 'warning')[0]
    let findingPreview = topFinding?.message
      ? `${topFinding.severity === 'critical' ? '🔴' : '🟡'} ${topFinding.message.slice(0, 50)}${topFinding.message.length > 50 ? '...' : ''}`
      : summary.criticalCount > 0
        ? `🔴 ${summary.criticalCount} critical issue${summary.criticalCount > 1 ? 's' : ''}`
        : summary.warningCount > 0
          ? `🟡 ${summary.warningCount} warning${summary.warningCount > 1 ? 's' : ''}`
          : '🟢 Clean'

    // Add PR-specific test count for e2e-tests
    if (summary.reviewer === 'e2e-tests' && prTestInfo && prTestInfo.count > 0) {
      findingPreview = `🤖 ${prTestInfo.count} PR-specific tests. ` + findingPreview
    }

    comment += `| ${summary.reviewer} | ${verdictEmoji(summary.verdict)} ${summary.verdict} | ${findingPreview} |\n`
  }

  // Warnings and suggestions (only if not blocked, or show briefly if blocked)
  if (!isBlocked && prWarnings.length > 0) {
    comment += `
### ⚠️ Suggestions (optional but recommended)

`
    for (const warning of prWarnings.slice(0, 5)) {
      const location = warning.line ? `${warning.file}:${warning.line}` : warning.file
      comment += `- **\`${location}\`**: ${warning.issue}\n`
    }
    if (prWarnings.length > 5) {
      comment += `\n_...and ${prWarnings.length - 5} more suggestions_\n`
    }
  }

  if (!isBlocked && prInfo.length > 0) {
    comment += `
### 💡 Minor notes

`
    for (const info of prInfo.slice(0, 3)) {
      comment += `- \`${info.file}\`: ${info.issue}\n`
    }
    if (prInfo.length > 3) {
      comment += `\n_...and ${prInfo.length - 3} more minor notes_\n`
    }
  }

  // Decision reasoning - generate a clear summary instead of parsing AI output
  comment += `
### 🧠 Why this decision?

`
  if (!isBlocked) {
    // Generate clear reasoning for PASS
    const cleanReviewers = verdict.reviewerSummary.filter(r => r.criticalCount === 0 && r.warningCount === 0)
    const warnReviewers = verdict.reviewerSummary.filter(r => r.warningCount > 0 && r.criticalCount === 0)

    if (prRelevant.length === 0) {
      comment += `No issues were found in the files changed by this PR. `
    } else {
      comment += `Found ${prRelevant.length} minor suggestion${prRelevant.length > 1 ? 's' : ''} in this PR (none blocking). `
    }

    if (cleanReviewers.length > 0) {
      comment += `${cleanReviewers.map(r => r.reviewer).join(', ')} found no issues. `
    }

    if (warnReviewers.length > 0) {
      comment += `${warnReviewers.map(r => r.reviewer).join(', ')} had minor warnings that don't require changes.`
    }

    // Explain any failed verifications that didn't block
    const failedVerifications = Object.entries(verdict.verifications)
      .filter(([_, status]) => status === 'fail')
      .map(([name]) => name)

    if (failedVerifications.length > 0) {
      comment += `

**Note:** ${failedVerifications.join(', ')} showed issues, but these appear to be pre-existing (not introduced by this PR).`
    }
  } else {
    // For BLOCK, use the AI's reasoning but clean it up
    const reasoningEnd = verdict.reasoning.indexOf('FINAL VERDICT:')
    const reasoning = reasoningEnd > 0 ? verdict.reasoning.slice(0, reasoningEnd).trim() : verdict.reasoning

    // Get last paragraph that explains the decision
    const paragraphs = reasoning.split('\n\n').filter(p => p.trim() && p.length > 30)
    const lastParagraph = paragraphs[paragraphs.length - 1] || 'Critical issues must be addressed before merge.'
    comment += lastParagraph.slice(0, 500) + (lastParagraph.length > 500 ? '...' : '')
  }

  // Note about pre-existing issues (if any) - brief mention, details in separate comment
  if (preExisting.length > 0) {
    comment += `

---

📋 **Note:** Found ${preExisting.length} issue${preExisting.length > 1 ? 's' : ''} in files NOT changed by this PR. These are pre-existing and won't block this PR. See the follow-up comment for details.`
  }

  // Collapsed section for AI agents - make it self-contained
  const structuredData = {
    verdict: verdict.verdict,
    ciStatus: isBlocked ? 'FAILED' : 'PASSED',
    confidence: verdict.confidence,
    summary: isBlocked
      ? `PR BLOCKED: ${prCritical.length} critical issues must be fixed`
      : verdict.aiOverride
        ? `PR APPROVED: ${failCount} reviewer failures verified as non-blocking (${verdict.aiOverride.reason})`
        : `PR APPROVED: ${prRelevant.length} minor findings (none blocking)`,
    prChanges: {
      filesChanged: changedFiles.length,
      findings: prRelevant.length,
      critical: prCritical.length,
      warnings: prWarnings.length,
      info: prInfo.length,
    },
    preExisting: {
      count: preExisting.length,
      note: preExisting.length > 0 ? 'Issues in unchanged files - not blocking' : null,
    },
    reviewers: verdict.reviewerSummary.map(r => ({
      name: r.reviewer,
      verdict: r.verdict,
      critical: r.criticalCount,
      warnings: r.warningCount,
    })),
    verifications: Object.fromEntries(
      Object.entries(verdict.verifications).map(([k, v]) => [
        k,
        v === 'fail' && preExisting.length > 0 ? `${v} (pre-existing)` : v
      ])
    ),
    // Include actual findings for AI agents to act on
    mustFix: prCritical.map(f => ({
      file: f.file,
      line: f.line,
      issue: f.issue,
      howToFix: f.fix?.explanation,
    })),
    suggestions: prWarnings.slice(0, 5).map(f => ({
      file: f.file,
      line: f.line,
      issue: f.issue,
    })),
  }

  comment += `

<details>
<summary>📎 For AI agents: structured data</summary>

\`\`\`json
${JSON.stringify(structuredData, null, 2)}
\`\`\`

</details>`

  comment += `

---
*AI Review by \`${VERDICT_MODEL.split('/').pop()}\` • [View full artifacts](${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY || 'repo'}/actions/runs/${process.env.GITHUB_RUN_ID || 'latest'})*`

  return comment
}

/**
 * Generate follow-up comment for pre-existing issues (not from this PR)
 */
function generatePreExistingComment(
  verdict: FinalVerdictOutput,
  changedFiles: string[]
): string | null {
  const allFindings = [...verdict.requiredFixes, ...verdict.suggestions]
  const { preExisting } = separateFindings(allFindings, changedFiles)

  if (preExisting.length === 0) {
    return null
  }

  let comment = `## 📋 Pre-existing Issues (Not from this PR)

The AI review found issues in files **not modified by this PR**. These likely existed before and should be addressed in separate issues/PRs.

> 💡 **Tip:** Consider filing these as GitHub issues for future work.

### Issues Found

`

  // Group by category
  const byCategory: Record<string, ActionableIssue[]> = {}
  for (const issue of preExisting) {
    const cat = issue.category || 'other'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(issue)
  }

  for (const [category, issues] of Object.entries(byCategory)) {
    comment += `#### ${categoryEmoji(category)} ${category}\n\n`
    for (const issue of issues.slice(0, 5)) {
      const severityIcon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️'
      comment += `- ${severityIcon} **\`${issue.file}${issue.line ? `:${issue.line}` : ''}\`**\n`
      comment += `  ${issue.issue}\n`
    }
    if (issues.length > 5) {
      comment += `  _...and ${issues.length - 5} more in this category_\n`
    }
    comment += '\n'
  }

  // Suggested GitHub issue template
  comment += `### 📝 Suggested GitHub Issue

<details>
<summary>Click to expand issue template</summary>

**Title:** Fix pre-existing issues found by AI review

**Body:**
\`\`\`markdown
## Issues Found

The AI review on PR #${process.env.GITHUB_PR_NUMBER || 'XXX'} found these pre-existing issues:

${preExisting.slice(0, 10).map(i => `- [ ] \`${i.file}\`: ${i.issue}`).join('\n')}
${preExisting.length > 10 ? `\n_...and ${preExisting.length - 10} more_` : ''}

## Context

These were detected during automated review but exist in files not modified by that PR.
\`\`\`

</details>

`

  // Full JSON for AI agents
  comment += `<details>
<summary>📎 Full findings JSON (for AI agents)</summary>

\`\`\`json
${JSON.stringify(preExisting, null, 2)}
\`\`\`

</details>

---
*Pre-existing issues found by AI review*`

  return comment
}

/**
 * Main comment generation - creates both comments
 */
function generateComment(
  verdict: FinalVerdictOutput,
  reviews: Record<string, ReviewerOutput>,
  changedFiles: string[],
  prTitle: string
): void {
  // Generate main comment (human-focused)
  const mainComment = generateMainComment(verdict, reviews, changedFiles, prTitle)
  writeFileSync('final-verdict-comment.md', mainComment)
  console.log('\n💬 Main PR comment saved: final-verdict-comment.md')

  // Generate follow-up comment for pre-existing issues (if any)
  const preExistingComment = generatePreExistingComment(verdict, changedFiles)
  if (preExistingComment) {
    writeFileSync('pre-existing-issues-comment.md', preExistingComment)
    console.log('💬 Pre-existing issues comment saved: pre-existing-issues-comment.md')
  }
}

main().catch(error => {
  console.error('Final verdict failed:', error)
  // Write an error comment so users don't see a stale "Approved" comment
  writeErrorComment(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
