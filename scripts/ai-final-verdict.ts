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

import { execSync, execFileSync } from 'child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync, statSync } from 'fs'
import { join } from 'path'
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
import {
  recordLLMUsage,
  logAuditEntry,
  recordSelectorFeedback,
  formatCost,
  calculateCost,
  generateCostSummaryMarkdown,
  getSelectorAccuracyStats,
  checkCostLimit,
  type SelectorFeedback,
} from './lib/llm-utils'

// ============================================
// Configuration
// ============================================

const VERDICT_MODEL = process.env.OPENROUTER_VERDICT_MODEL
const API_KEY = process.env.OPENROUTER_API_KEY

// Timeout for API calls (3.5 minutes - accounts for tool execution + processing overhead)
// Must be longer than the longest TOOL_TIMEOUT to allow result processing
const API_TIMEOUT_MS = 210_000

// Timeout per tool (prevent any single tool from blocking)
const TOOL_TIMEOUTS: Record<string, number> = {
  run_visual_validation: 120_000,  // 2 min - captures screenshots
  run_e2e_tests: 180_000,          // 3 min - runs playwright
  run_migration_review: 60_000,    // 1 min
  run_api_tests: 120_000,          // 2 min
  run_dead_code_analysis: 30_000,  // 30s
  run_bundle_size_check: 30_000,   // 30s
  run_i18n_completeness_check: 15_000, // 15s
  run_accessibility_audit: 30_000, // 30s
  read_file: 5_000,                // 5s
  read_diff: 10_000,               // 10s
  search_code: 15_000,             // 15s
  _default: 30_000,                // 30s default
}

// ============================================
// Git Utilities
// ============================================

/**
 * Ensure we have full git history for proper diff from main.
 * This is critical for the final verdict to see all PR changes.
 */
function ensureFullGitHistory(): void {
  const baseBranch = process.env.GITHUB_BASE_REF || 'main'
  console.log(`Ensuring full git history for diff against ${baseBranch}...`)

  try {
    // First, try to unshallow if we have a shallow clone
    try {
      execSync(`git fetch --unshallow origin ${baseBranch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      console.log('   ✓ Unshallowed git history')
    } catch {
      // Already unshallowed or not shallow, do regular fetch
      execSync(`git fetch origin ${baseBranch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      console.log('   ✓ Fetched origin/' + baseBranch)
    }
  } catch (error) {
    console.warn(`   ⚠️ Could not fetch ${baseBranch}: ${error instanceof Error ? error.message : 'Unknown'}`)
    console.warn('   Some git operations may use fallback (HEAD~1)')
  }
}

/**
 * Recursively find TypeScript files in a directory (Node.js-based, no shell).
 * Returns up to maxFiles to prevent excessive processing.
 */
function findTsFiles(dir: string, maxFiles = 50): string[] {
  const files: string[] = []

  function walk(currentDir: string): void {
    if (files.length >= maxFiles) return
    if (!existsSync(currentDir)) return

    try {
      const stat = statSync(currentDir)
      if (!stat.isDirectory()) {
        if (currentDir.endsWith('.ts') || currentDir.endsWith('.tsx')) {
          files.push(currentDir)
        }
        return
      }

      const entries = readdirSync(currentDir)
      for (const entry of entries) {
        if (files.length >= maxFiles) break
        if (entry.startsWith('.') || entry === 'node_modules') continue
        walk(join(currentDir, entry))
      }
    } catch {
      // Ignore permission errors
    }
  }

  walk(dir)
  return files
}

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
    description: 'Search for code patterns in the repository using ripgrep',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory or file path to search in (e.g., "scripts/", "src/lib/utils.ts")' },
        glob: { type: 'string', description: 'File type filter (e.g., "*.ts", "*.tsx")' }
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

  // ============================================
  // Supervisor Tools - Override Smart Selector
  // ============================================
  {
    name: 'get_test_selection',
    description: 'Get the smart test selector\'s decisions and reasoning. Use this to understand what tests were skipped and why.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_pre_verdict_check',
    description: 'Get results from the pre-verdict check (fast LLM pass). Includes quick check results, selector review, and recommendations. Use this FIRST before running additional tests.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'run_visual_validation',
    description: 'Run visual validation tests that were skipped. Use when you suspect UI issues not covered by the selector. Returns screenshots and validation results.',
    input_schema: {
      type: 'object',
      properties: {
        pages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific pages to test: "home", "week", "settings", "wishlist", or "all"'
        }
      },
      required: []
    }
  },
  {
    name: 'run_e2e_tests',
    description: 'Run E2E tests that were skipped. Use when you suspect user journey issues. Returns test results.',
    input_schema: {
      type: 'object',
      properties: {
        specs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific test files to run, or omit for all'
        }
      },
      required: []
    }
  },
  {
    name: 'run_migration_review',
    description: 'Run AI migration review that was skipped. Use when you see SQL changes that weren\'t reviewed.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'run_api_tests',
    description: 'Run API integration tests that were skipped. Use when you suspect API issues.',
    input_schema: {
      type: 'object',
      properties: {
        tests: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific test patterns to run'
        }
      },
      required: []
    }
  },
  {
    name: 'explain_skip_decision',
    description: 'Get detailed explanation of why a specific test was skipped by the selector',
    input_schema: {
      type: 'object',
      properties: {
        test: {
          type: 'string',
          enum: ['visual-validation', 'e2e-tests', 'migration-review', 'api-tests', 'code-review'],
          description: 'Test type to explain'
        }
      },
      required: ['test']
    }
  },

  // ============================================
  // Extended Check Tools - Run recommended checks
  // ============================================
  {
    name: 'get_extended_checks',
    description: 'Get the extended checks recommended by the smart selector (dead code analysis, mobile UX validation, etc.). Use this to see what additional checks were suggested based on PR context.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'run_dead_code_analysis',
    description: 'Find unused exports, functions, and types in changed files. Useful after refactoring PRs.',
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files or directories to analyze (defaults to changed files)'
        }
      },
      required: []
    }
  },
  {
    name: 'run_bundle_size_check',
    description: 'Check if PR increases bundle size significantly. Run when adding new dependencies.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'run_i18n_completeness_check',
    description: 'Verify all new UI strings have translations in all supported languages (nb, sv, en).',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'run_accessibility_audit',
    description: 'Run accessibility checks on changed components. Verifies ARIA labels, color contrast, keyboard navigation.',
    input_schema: {
      type: 'object',
      properties: {
        components: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific components to audit'
        }
      },
      required: []
    }
  },
  {
    name: 'list_available_tools',
    description: 'List all available tools with their descriptions. Use this to understand what capabilities you have.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'suggest_capability',
    description: 'Suggest a capability or tool that would help with the review. This feedback helps improve future versions.',
    input_schema: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: 'What capability or tool you wish you had' },
        reason: { type: 'string', description: 'Why this would help with the current review' },
        example: { type: 'string', description: 'Example of how you would use it' }
      },
      required: ['capability', 'reason']
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

  const timeout = TOOL_TIMEOUTS[name] || TOOL_TIMEOUTS._default
  const startTime = Date.now()

  try {
    const result = executeToolWithTimeout(name, input, timeout)
    const duration = Date.now() - startTime

    // Log slow tools
    if (duration > 10_000) {
      console.log(`   ⏱️ Tool ${name} took ${Math.round(duration / 1000)}s`)
    }

    // Cache the result
    toolResultCache.set(cacheKey, result)
    return result
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      console.log(`   ⏱️ Tool ${name} timed out after ${timeout / 1000}s`)
      return `Error: Tool ${name} timed out after ${timeout / 1000} seconds. Try a simpler query.`
    }
    throw error
  }
}

/**
 * Execute a tool with timeout protection
 */
function executeToolWithTimeout(name: string, input: Record<string, unknown>, timeoutMs: number): string {
  // For sync tools, we can't easily add timeout, but we set exec timeouts
  // The main protection is the exec timeouts in the tool implementations
  return executeToolUncached(name, input)
}

function executeToolUncached(name: string, input: Record<string, unknown>): string {
  const baseBranch = process.env.GITHUB_BASE_REF || 'main'
  const previewUrl = process.env.VERCEL_PREVIEW_URL
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  // Build curl header for Vercel protection bypass
  const bypassHeader = bypassSecret ? `-H 'x-vercel-protection-bypass: ${bypassSecret}'` : ''

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
      const searchPath = input.path as string | undefined
      const glob = input.glob as string | undefined
      try {
        // Build ripgrep command with proper arguments
        // Using execFileSync to avoid shell escaping issues with regex patterns
        const args: string[] = ['-n', '--max-count', '20']
        if (glob) args.push('--glob', glob)
        args.push('--', query)
        if (searchPath) args.push(searchPath)
        else args.push('.')  // Search current directory if no path specified

        const result = execFileSync('rg', args, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],  // Capture stderr too
          maxBuffer: 1024 * 1024,  // 1MB buffer
        }).trim()

        return result || 'No matches found'
      } catch (e) {
        // ripgrep returns exit code 1 when no matches found
        if (e && typeof e === 'object' && 'stdout' in e) {
          const stdout = (e as { stdout?: Buffer | string }).stdout
          if (stdout) return String(stdout).trim() || 'No matches found'
        }
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
          bypassHeader, // Include Vercel protection bypass
          ...(body ? ['-d', JSON.stringify(body), '-H', 'Content-Type: application/json'] : []),
          `${previewUrl}${path}`
        ].filter(Boolean).join(' ')

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
        // Use bypass header to get past Vercel protection, then check app-level auth
        const result = execSync(
          `curl -s -w '\\n%{http_code}' ${bypassHeader} -X GET '${previewUrl}${path}'`,
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
          // Include bypass header to get past Vercel protection
          const result = execSync(
            `curl -s -w '\\n%{http_code}' ${bypassHeader} -X GET '${previewUrl}${path}'`,
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

          // Match both regular and scoped package imports (e.g. lodash, @scope/pkg)
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

    // ============================================
    // Supervisor Tools - Override Smart Selector
    // ============================================

    case 'get_test_selection': {
      const selectionPath = 'ci-state/test-selection.json'
      if (!existsSync(selectionPath)) {
        return 'No test selection found. The smart selector may not have run yet.'
      }
      try {
        const selection = JSON.parse(readFileSync(selectionPath, 'utf-8'))
        const skipped = selection.decisions?.filter((d: { enabled: boolean }) => !d.enabled) || []
        const running = selection.decisions?.filter((d: { enabled: boolean }) => d.enabled) || []
        const extendedChecks = selection.extendedChecks || []

        let result = `## Smart Test Selector Results

**Model:** ${selection.model}
**Timestamp:** ${selection.timestamp}

### Tests Running (${running.length})
${running.map((d: { testType: string; reason: string }) => `- ${d.testType}: ${d.reason}`).join('\n') || 'None'}

### Tests Skipped (${skipped.length})
${skipped.map((d: { testType: string; reason: string; overridable: boolean }) => `- ${d.testType}: ${d.reason} ${d.overridable ? '(overridable)' : ''}`).join('\n') || 'None'}

### Extended Checks Recommended (${extendedChecks.length})
${extendedChecks.map((c: { type: string; reason: string; priority: string }) => `- [${c.priority}] ${c.type}: ${c.reason}`).join('\n') || 'None'}

### Reasoning
${selection.reasoning}

### Files Changed (${selection.changedFiles?.length || 0})
${(selection.changedFiles || []).slice(0, 20).join('\n')}${(selection.changedFiles?.length || 0) > 20 ? '\n... and more' : ''}`

        return result
      } catch (e) {
        return `Error reading test selection: ${e}`
      }
    }

    case 'get_pre_verdict_check': {
      const preVerdictPath = 'ci-state/pre-verdict-check.json'
      if (!existsSync(preVerdictPath)) {
        return 'No pre-verdict check results found. The pre-verdict check may not have run.'
      }
      try {
        const preVerdict = JSON.parse(readFileSync(preVerdictPath, 'utf-8'))

        const quickChecks = preVerdict.quickChecks || []
        const passed = quickChecks.filter((c: { status: string }) => c.status === 'pass').length
        const failed = quickChecks.filter((c: { status: string }) => c.status === 'fail').length
        const warned = quickChecks.filter((c: { status: string }) => c.status === 'warn').length

        let result = `## Pre-Verdict Check Results (Fast LLM Pass)

**Recommendation:** ${preVerdict.recommendation?.toUpperCase() || 'UNKNOWN'}
**Reasoning:** ${preVerdict.reasoning || 'No reasoning provided'}

### Quick Checks (${quickChecks.length})
✅ ${passed} passed | ❌ ${failed} failed | ⚠️ ${warned} warnings

${quickChecks.filter((c: { status: string }) => c.status !== 'pass').map((c: { check: string; status: string; message: string; details?: string }) =>
  `- [${c.status.toUpperCase()}] ${c.check}: ${c.message}${c.details ? `\n  Details: ${c.details}` : ''}`
).join('\n') || 'All checks passed'}

### Selector Review
**Verified:** ${preVerdict.selectorReview?.verified ? 'Yes' : 'No'}
${preVerdict.selectorReview?.concerns?.length > 0 ? `**Concerns:**\n${preVerdict.selectorReview.concerns.map((c: string) => `- ${c}`).join('\n')}` : ''}
${preVerdict.selectorReview?.suggestions?.length > 0 ? `**Suggestions:**\n${preVerdict.selectorReview.suggestions.map((s: string) => `- ${s}`).join('\n')}` : ''}

### Additional Context
${Object.entries(preVerdict.additionalContext || {}).map(([key, value]) => `- **${key}:** ${value}`).join('\n') || 'No additional context'}`

        return result
      } catch (e) {
        return `Error reading pre-verdict check: ${e}`
      }
    }

    case 'run_visual_validation': {
      if (!previewUrl) return 'Error: VERCEL_PREVIEW_URL not set - cannot run visual validation'

      const pages = (input.pages as string[] | undefined) || ['home', 'week']
      console.log(`   🎨 Running visual validation for: ${pages.join(', ')}`)

      try {
        // Run playwright to capture screenshots
        const pageArg = pages.includes('all') ? '' : `--grep "${pages.join('|')}"`
        execSync(
          `PLAYWRIGHT_BASE_URL=${previewUrl} npx playwright test tests/e2e/capture-screenshots.spec.ts --project=chromium ${pageArg}`,
          { encoding: 'utf-8', timeout: 120000, stdio: 'pipe' }
        )

        // Run visual validation script
        const result = execSync(
          'npx tsx scripts/ai-visual-validation.ts 2>&1',
          { encoding: 'utf-8', timeout: 180000 }
        )

        // Check for results file
        const reportPath = 'visual-validation-report.json'
        if (existsSync(reportPath)) {
          const report = JSON.parse(readFileSync(reportPath, 'utf-8'))
          return `## Visual Validation Results

**Verdict:** ${report.verdict}
**Pages Tested:** ${pages.join(', ')}

**Summary:** ${report.summary || 'No summary'}

**Issues Found:**
${report.issues?.slice(0, 5).map((i: string) => `- ${i}`).join('\n') || 'None'}

${result.slice(-500)}`
        }

        return `Visual validation ran but no report generated.\n\nOutput:\n${result.slice(-1000)}`
      } catch (e) {
        const error = e as { stdout?: string; stderr?: string; message?: string }
        return `Visual validation failed: ${error.message || 'Unknown error'}\n\nOutput:\n${error.stdout?.slice(-500) || ''}\n${error.stderr?.slice(-500) || ''}`
      }
    }

    case 'run_e2e_tests': {
      if (!previewUrl) return 'Error: VERCEL_PREVIEW_URL not set - cannot run E2E tests'

      const specs = (input.specs as string[] | undefined) || []
      const specArg = specs.length > 0 ? specs.join(' ') : 'tests/e2e/design-system.spec.ts'
      console.log(`   🧪 Running E2E tests: ${specArg}`)

      try {
        const result = execSync(
          `PLAYWRIGHT_BASE_URL=${previewUrl} npx playwright test ${specArg} --project=chromium --reporter=list 2>&1`,
          { encoding: 'utf-8', timeout: 180000, stdio: 'pipe' }
        )

        // Count results
        const passed = (result.match(/✓/g) || []).length
        const failed = (result.match(/✘/g) || []).length

        return `## E2E Test Results

**Passed:** ${passed}
**Failed:** ${failed}
**Specs:** ${specArg}

${result.slice(-2000)}`
      } catch (e) {
        const error = e as { stdout?: string; stderr?: string; message?: string }
        const output = error.stdout || error.stderr || ''

        // Extract failure summary
        const failures = output.match(/✘.*$/gm) || []

        return `## E2E Tests Failed

**Failures:**
${failures.slice(0, 10).join('\n') || 'See output below'}

**Output (last 1500 chars):**
${output.slice(-1500)}`
      }
    }

    case 'run_migration_review': {
      console.log('   🗄️ Running migration review...')

      try {
        const result = execSync(
          'npx tsx scripts/migration-ai-review.ts 2>&1',
          { encoding: 'utf-8', timeout: 120000 }
        )

        // Check for results
        const reviewPath = 'ai-reviews/migration-review.json'
        if (existsSync(reviewPath)) {
          const review = JSON.parse(readFileSync(reviewPath, 'utf-8'))
          return `## Migration Review Results

**Verdict:** ${review.verdict}
**Summary:** ${review.summary}

**Issues:**
${review.findings?.slice(0, 10).map((f: { severity: string; message: string }) => `- [${f.severity}] ${f.message}`).join('\n') || 'None'}

${result.slice(-500)}`
        }

        return `Migration review ran.\n\nOutput:\n${result.slice(-1000)}`
      } catch (e) {
        const error = e as { stdout?: string; message?: string }
        return `Migration review failed: ${error.message || 'Unknown error'}\n\n${error.stdout?.slice(-500) || ''}`
      }
    }

    case 'run_api_tests': {
      const tests = (input.tests as string[] | undefined) || []
      // Vitest uses file paths directly, not --grep (that's Jest/Mocha)
      const testArg = tests.length > 0 ? tests.join(' ') : ''
      console.log('   🔌 Running API tests...')

      try {
        const result = execSync(
          `npm run test:api -- ${testArg} --reporter=verbose 2>&1`,
          {
            encoding: 'utf-8',
            timeout: 180000,
            env: {
              ...process.env,
              OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
              OPENROUTER_TEST_MODEL: process.env.OPENROUTER_TEST_MODEL || process.env.OPENROUTER_FAST_MODEL,
            }
          }
        )

        return `## API Test Results

${result.slice(-2000)}`
      } catch (e) {
        const error = e as { stdout?: string; message?: string }
        return `API tests failed:\n\n${error.stdout?.slice(-1500) || error.message || 'Unknown error'}`
      }
    }

    case 'explain_skip_decision': {
      const test = input.test as string
      const selectionPath = 'ci-state/test-selection.json'

      if (!existsSync(selectionPath)) {
        return `No test selection data found. Cannot explain skip decision for ${test}.`
      }

      try {
        const selection = JSON.parse(readFileSync(selectionPath, 'utf-8'))
        const decision = selection.decisions?.find((d: { testType: string }) => d.testType === test)

        if (!decision) {
          return `No decision found for test type: ${test}`
        }

        // Get changed files relevant to this test type
        const changedFiles = selection.changedFiles || []
        const relevantPatterns: Record<string, string[]> = {
          'visual-validation': ['src/components/', 'src/app/', '.css', 'tailwind'],
          'e2e-tests': ['src/app/', 'src/components/', 'src/lib/'],
          'migration-review': ['supabase/migrations/'],
          'api-tests': ['src/app/api/', 'src/lib/integrations/'],
          'code-review': ['.ts', '.tsx'],
        }

        const patterns = relevantPatterns[test] || []
        const relevantFiles = changedFiles.filter((f: string) =>
          patterns.some(p => f.includes(p))
        )

        return `## Skip Decision Explanation: ${test}

**Decision:** ${decision.enabled ? 'RUN' : 'SKIP'}
**Reason:** ${decision.reason}
**Overridable:** ${decision.overridable ? 'Yes' : 'No'}

**Selector Model:** ${selection.model}
**Overall Reasoning:** ${selection.reasoning}

**Files Changed (${changedFiles.length} total):**
${changedFiles.slice(0, 30).join('\n')}

**Files Relevant to ${test} (${relevantFiles.length}):**
${relevantFiles.slice(0, 20).join('\n') || 'None found'}

**Categories:**
- Migrations: ${selection.categories?.migrations?.length || 0}
- Components: ${selection.categories?.components?.length || 0}
- API: ${selection.categories?.api?.length || 0}
- Lib: ${selection.categories?.lib?.length || 0}`
      } catch (e) {
        return `Error explaining skip decision: ${e}`
      }
    }

    // ============================================
    // Extended Check Tools
    // ============================================

    case 'get_extended_checks': {
      const selectionPath = 'ci-state/test-selection.json'
      if (!existsSync(selectionPath)) {
        return 'No test selection found. Extended checks are recommended by the smart selector.'
      }
      try {
        const selection = JSON.parse(readFileSync(selectionPath, 'utf-8'))
        const extendedChecks = selection.extendedChecks || []

        if (extendedChecks.length === 0) {
          return `## Extended Checks

No extended checks were recommended for this PR.

The smart selector analyzes PR context and recommends extended checks like:
- dead-code-analysis: For refactoring PRs
- mobile-ux-validation: For mobile component changes
- accessibility-audit: For UI changes
- performance-check: For data fetching changes
- security-audit: For auth/API changes
- bundle-size-check: For new dependencies
- i18n-completeness: For translation changes`
        }

        const highPriority = extendedChecks.filter((c: { priority: string }) => c.priority === 'high')
        const mediumPriority = extendedChecks.filter((c: { priority: string }) => c.priority === 'medium')
        const lowPriority = extendedChecks.filter((c: { priority: string }) => c.priority === 'low')

        return `## Extended Checks Recommended

**Total:** ${extendedChecks.length} checks recommended by smart selector

### 🔴 High Priority (${highPriority.length})
${highPriority.map((c: { type: string; reason: string; scope?: string[] }) => `- **${c.type}**: ${c.reason}${c.scope ? `\n  Scope: ${c.scope.join(', ')}` : ''}`).join('\n') || 'None'}

### 🟡 Medium Priority (${mediumPriority.length})
${mediumPriority.map((c: { type: string; reason: string; scope?: string[] }) => `- **${c.type}**: ${c.reason}${c.scope ? `\n  Scope: ${c.scope.join(', ')}` : ''}`).join('\n') || 'None'}

### 🟢 Low Priority (${lowPriority.length})
${lowPriority.map((c: { type: string; reason: string; scope?: string[] }) => `- **${c.type}**: ${c.reason}${c.scope ? `\n  Scope: ${c.scope.join(', ')}` : ''}`).join('\n') || 'None'}

**Use the run_* tools to execute these checks if you want to verify.**`
      } catch (e) {
        return `Error reading extended checks: ${e}`
      }
    }

    case 'run_dead_code_analysis': {
      const scope = (input.scope as string[] | undefined) || []
      console.log('   🗑️ Running dead code analysis...')

      try {
        // Get changed files if no scope specified
        let filesToCheck: string[] = []

        if (scope.length === 0) {
          // No scope - use changed files
          const changedFiles = execSync(
            `git diff --name-only origin/${baseBranch}...HEAD | grep -E '\\.(ts|tsx)$' || true`,
            { encoding: 'utf-8' }
          ).trim().split('\n').filter(Boolean)
          filesToCheck = changedFiles
        } else {
          // Expand directories to files using Node.js helper
          for (const path of scope) {
            if (!existsSync(path)) continue
            const stat = statSync(path)
            if (stat.isDirectory()) {
              // Use Node.js-based file finder (no shell)
              filesToCheck.push(...findTsFiles(path, 50))
            } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
              filesToCheck.push(path)
            }
          }
        }

        if (filesToCheck.length === 0) {
          return '✅ No TypeScript files to analyze'
        }

        const deadCode: string[] = []

        // Check for unused exports in changed files
        for (const file of filesToCheck.slice(0, 20)) {
          if (!existsSync(file)) continue
          // Extra safety: skip if somehow still a directory
          const fileStat = statSync(file)
          if (fileStat.isDirectory()) continue
          const content = readFileSync(file, 'utf-8')

          // Find exported items
          const exports = content.matchAll(/export\s+(?:const|function|class|type|interface)\s+(\w+)/g)
          for (const match of exports) {
            const exportName = match[1]
            // Search for usage in other files
            try {
              const usage = execSync(
                `rg '\\b${exportName}\\b' --type ts -l 2>/dev/null | grep -v '${file}' | head -1 || true`,
                { encoding: 'utf-8' }
              ).trim()
              if (!usage) {
                deadCode.push(`${file}: Exported '${exportName}' may be unused`)
              }
            } catch {
              // Ignore search errors
            }
          }
        }

        if (deadCode.length === 0) {
          return `✅ No obviously dead code found in ${filesToCheck.length} files analyzed`
        }

        return `## Dead Code Analysis

**Files analyzed:** ${filesToCheck.length}
**Potential dead code:** ${deadCode.length}

${deadCode.slice(0, 15).map(d => `- ${d}`).join('\n')}
${deadCode.length > 15 ? `\n_...and ${deadCode.length - 15} more_` : ''}

**Note:** These are potential issues - verify before removing.`
      } catch (e) {
        return `Error running dead code analysis: ${e}`
      }
    }

    case 'run_bundle_size_check': {
      console.log('   📦 Running bundle size check...')

      try {
        // Check if new dependencies were added
        const diff = execSync(`git diff origin/${baseBranch}...HEAD -- package.json`, { encoding: 'utf-8' })

        const addedDeps: string[] = []
        const lines = diff.split('\n')
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            const depMatch = line.match(/"([^"]+)":\s*"[^"]+"/g)
            if (depMatch) {
              addedDeps.push(...depMatch.map(m => m.split(':')[0].replace(/"/g, '')))
            }
          }
        }

        // Filter to actual dependency additions (not version updates)
        const newDeps = addedDeps.filter(d =>
          !diff.includes(`-    "${d}"`) && // Not replacing existing
          d !== 'version' && d !== 'name' // Not metadata
        )

        if (newDeps.length === 0) {
          return '✅ No new dependencies added - bundle size unchanged'
        }

        // Try to get size estimates from npm
        const sizes: string[] = []
        for (const dep of newDeps.slice(0, 5)) {
          try {
            // Use bundlephobia API simulation (just check if it's a big package)
            const bigPackages = ['moment', 'lodash', 'antd', 'material-ui', 'firebase', 'aws-sdk']
            if (bigPackages.some(bp => dep.toLowerCase().includes(bp))) {
              sizes.push(`⚠️ ${dep}: Known large package - consider alternatives`)
            } else {
              sizes.push(`📦 ${dep}: Added to dependencies`)
            }
          } catch {
            sizes.push(`📦 ${dep}: Size unknown`)
          }
        }

        return `## Bundle Size Check

**New dependencies:** ${newDeps.length}

${sizes.join('\n')}
${newDeps.length > 5 ? `\n_...and ${newDeps.length - 5} more_` : ''}

**Recommendation:** Run \`npm run build\` and compare .next/static sizes before/after.`
      } catch (e) {
        return `Error checking bundle size: ${e}`
      }
    }

    case 'run_i18n_completeness_check': {
      console.log('   🌐 Running i18n completeness check...')

      try {
        // Load translation files
        const languages = ['nb', 'sv', 'en']
        const translations: Record<string, Set<string>> = {}

        for (const lang of languages) {
          const filePath = `src/lib/i18n/translations/${lang}.ts`
          if (!existsSync(filePath)) {
            return `❌ Translation file missing: ${filePath}`
          }
          const content = readFileSync(filePath, 'utf-8')

          // Extract keys (simplified - looks for key patterns)
          const keys = new Set<string>()
          const keyMatches = content.matchAll(/(\w+):\s*['"`]/g)
          for (const match of keyMatches) {
            keys.add(match[1])
          }
          translations[lang] = keys
        }

        // Find keys missing in any language
        const allKeys = new Set([...translations.nb, ...translations.sv, ...translations.en])
        const missingByLang: Record<string, string[]> = { nb: [], sv: [], en: [] }

        for (const key of allKeys) {
          for (const lang of languages) {
            if (!translations[lang].has(key)) {
              missingByLang[lang].push(key)
            }
          }
        }

        const totalMissing = missingByLang.nb.length + missingByLang.sv.length + missingByLang.en.length

        if (totalMissing === 0) {
          return `✅ All ${allKeys.size} translation keys present in all languages (nb, sv, en)`
        }

        return `## i18n Completeness Check

**Total keys:** ${allKeys.size}

### Missing translations:
- **Norwegian (nb):** ${missingByLang.nb.length > 0 ? missingByLang.nb.slice(0, 5).join(', ') : '✅ Complete'}
- **Swedish (sv):** ${missingByLang.sv.length > 0 ? missingByLang.sv.slice(0, 5).join(', ') : '✅ Complete'}
- **English (en):** ${missingByLang.en.length > 0 ? missingByLang.en.slice(0, 5).join(', ') : '✅ Complete'}

${totalMissing > 0 ? `⚠️ ${totalMissing} missing translation(s) found` : ''}`
      } catch (e) {
        return `Error checking i18n: ${e}`
      }
    }

    case 'run_accessibility_audit': {
      const components = (input.components as string[] | undefined) || []
      console.log('   ♿ Running accessibility audit...')

      try {
        // Get changed component files
        let filesToCheck: string[] = components
        if (filesToCheck.length === 0) {
          const changedFiles = execSync(
            `git diff --name-only origin/${baseBranch}...HEAD | grep -E 'src/components/.*\\.tsx$' || true`,
            { encoding: 'utf-8' }
          ).trim().split('\n').filter(Boolean)
          filesToCheck = changedFiles
        }

        if (filesToCheck.length === 0) {
          return '✅ No component files to audit'
        }

        const issues: string[] = []

        for (const file of filesToCheck.slice(0, 15)) {
          if (!existsSync(file)) continue
          const content = readFileSync(file, 'utf-8')

          // Check for common a11y issues
          // 1. Images without alt
          if (content.includes('<img') && !content.includes('alt=')) {
            issues.push(`${file}: Image without alt attribute`)
          }

          // 2. Click handlers without keyboard support
          if (content.includes('onClick') && !content.includes('onKeyDown') && !content.includes('onKeyPress')) {
            if (content.includes('<div') || content.includes('<span')) {
              issues.push(`${file}: Click handler on non-interactive element without keyboard support`)
            }
          }

          // 3. Missing button type
          if (content.includes('<button') && !content.includes('type=')) {
            issues.push(`${file}: Button without explicit type attribute`)
          }

          // 4. Form inputs without labels
          if ((content.includes('<input') || content.includes('<select')) && !content.includes('aria-label') && !content.includes('htmlFor')) {
            issues.push(`${file}: Form input may be missing accessible label`)
          }
        }

        if (issues.length === 0) {
          return `✅ No obvious accessibility issues in ${filesToCheck.length} components`
        }

        return `## Accessibility Audit

**Components checked:** ${filesToCheck.length}
**Issues found:** ${issues.length}

${issues.slice(0, 10).map(i => `- ${i}`).join('\n')}
${issues.length > 10 ? `\n_...and ${issues.length - 10} more_` : ''}

**Recommendation:** Review these for WCAG compliance.`
      } catch (e) {
        return `Error running accessibility audit: ${e}`
      }
    }

    case 'list_available_tools': {
      const toolList = TOOLS.map(t => `- **${t.name}**: ${t.description}`).join('\n')
      return `## Available Tools (${TOOLS.length} total)

${toolList}

**Tip:** Use these tools to investigate issues. If you need a capability not listed, use \`suggest_capability\` to log feedback.`
    }

    case 'suggest_capability': {
      const capability = input.capability as string
      const reason = input.reason as string
      const example = input.example as string | undefined

      // Log to a file for future improvement
      const suggestion = {
        timestamp: new Date().toISOString(),
        capability,
        reason,
        example: example || null,
        prNumber: process.env.GITHUB_PR_NUMBER || 'unknown'
      }

      const suggestionsFile = 'ci-state/capability-suggestions.json'
      let suggestions: typeof suggestion[] = []
      if (existsSync(suggestionsFile)) {
        try {
          suggestions = JSON.parse(readFileSync(suggestionsFile, 'utf-8'))
        } catch {
          suggestions = []
        }
      }
      suggestions.push(suggestion)
      writeFileSync(suggestionsFile, JSON.stringify(suggestions, null, 2))

      console.log(`   💡 Capability suggestion logged: ${capability}`)
      return `✅ Feedback recorded. Suggested capability: "${capability}"\nReason: ${reason}${example ? `\nExample: ${example}` : ''}`
    }

    default:
      return `Unknown tool: ${name}`
  }
}

// ============================================
// Message Types (OpenAI-compatible format for OpenRouter)
// ============================================

interface Message {
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string  // For tool result messages
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
  // Build messages array in OpenAI format
  const apiMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const m of messages) {
    if (m.role === 'tool') {
      // Tool result message
      apiMessages.push({
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: m.content,
      })
    } else if (m.role === 'assistant' && m.tool_calls) {
      // Assistant message with tool calls
      apiMessages.push({
        role: 'assistant',
        content: m.content,
        tool_calls: m.tool_calls,
      })
    } else {
      // Regular user or assistant message
      apiMessages.push({
        role: m.role,
        content: m.content,
      })
    }
  }

  const fetchPromise = fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/n0rpan/familjen',
      'X-Title': 'Familjen CI/CD - Final Verdict',
    },
    body: JSON.stringify({
      model: VERDICT_MODEL,
      messages: apiMessages,
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

  // Check for required env vars FIRST - before writing any comments
  if (!API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set')
    writeErrorComment('OPENROUTER_API_KEY not set')
    process.exit(1)
  }
  if (!VERDICT_MODEL) {
    console.error('❌ OPENROUTER_VERDICT_MODEL not set')
    writeErrorComment('OPENROUTER_VERDICT_MODEL not set - no fallback, configure in GitHub secrets')
    process.exit(1)
  }

  // CRITICAL: Write a processing comment to prevent stale comments if script crashes
  // This is written AFTER API key check so we don't leave "Processing..." on config errors
  writeProcessingComment()

  // Ensure we have full git history for proper diffs
  ensureFullGitHistory()

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

## YOUR ROLE: The "Wise Supervisor" AI

You are the second-tier intelligence in a two-tier CI system:
1. **Fast Selector** (already ran): A fast AI that decided which tests to run/skip based on file changes
2. **You (Wise Supervisor)**: Review ALL findings AND the selector's decisions, run additional tests if needed

The PR comment will reflect YOUR decision - so make it count.

## CRITICAL: Review Smart Selector Decisions

A fast AI has already decided which tests to run. Use **get_test_selection** to see:
- Which tests were run vs skipped
- The reasoning behind skip decisions
- Files that were changed

**You can OVERRIDE the selector and run skipped tests if you disagree!**

Example workflow:
1. Call get_test_selection to see what was skipped
2. If a test was skipped but you think it should have run, use run_* tools
3. If you run additional tests and they fail, BLOCK
4. If you run additional tests and they pass, factor that into your decision

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
- You ran additional tests (overriding selector) and they FAILED
- **ANY unverified blocking issue** - when in doubt, BLOCK

**PASS (CI will succeed, PR can merge) when:**
- All blocking issues were VERIFIED as false positives (document your verification!)
- All blocking issues are in files NOT changed by this PR (pre-existing)
- Only minor suggestions/warnings remain
- You used tools to verify and found no real problems
- You ran additional tests (overriding selector) and they PASSED

## IMPORTANT: Pre-existing vs New Issues

Look at the "Files Changed" list. If an issue is reported in a file NOT in that list:
- It's PRE-EXISTING (existed before this PR)
- It should NOT block this PR
- Note it as pre-existing in your analysis

## Available Tools

You have ${TOOLS.length} tools available. Call **list_available_tools** if you need a reminder.

### Context Gathering
| Tool | Purpose |
|------|---------|
| read_file | Read a file to verify issues exist. **ALWAYS use before dismissing an issue.** |
| read_diff | Get the full PR diff |
| search_code | Search code with regex patterns (e.g., \`search_code({ query: "useState" })\`) |
| get_commits | List commits in this PR |
| get_full_documentation | Get full CLAUDE.md or README.md (use when truncated) |
| get_file_section | Get specific section of a large file by header |

### Code Verification
| Tool | Purpose |
|------|---------|
| check_typescript | Run TypeScript type checking on changed files |
| verify_imports | Check for hallucinated package imports |
| check_env_usage | Find new env vars and verify they're documented |
| check_migration_patterns | Find dangerous SQL patterns (DROP without IF EXISTS, etc.) |
| verify_rls_coverage | Check new tables have RLS policies |

### Live Testing (requires VERCEL_PREVIEW_URL)
| Tool | Purpose |
|------|---------|
| test_endpoint | Make HTTP request to preview deployment |
| verify_auth_required | Test that protected endpoint returns 401/403 |
| smoke_test_critical_paths | Quick health checks on critical paths |

### Supervisor Override Tools
| Tool | Purpose |
|------|---------|
| get_test_selection | See what the fast selector decided and why |
| get_pre_verdict_check | Get pre-verdict check results (quick checks, selector review) |
| explain_skip_decision | Detailed explanation for why a test was skipped |
| run_visual_validation | Run visual tests that were skipped |
| run_e2e_tests | Run E2E tests that were skipped |
| run_migration_review | Run migration review that was skipped |
| run_api_tests | Run API tests that were skipped |

### Extended Checks (run based on recommendations)
| Tool | Purpose |
|------|---------|
| get_extended_checks | See what checks the selector recommended |
| run_dead_code_analysis | Find unused exports in changed files |
| run_bundle_size_check | Check bundle impact of new dependencies |
| run_i18n_completeness_check | Verify translation keys exist in all languages |
| run_accessibility_audit | Check ARIA labels, keyboard nav, color contrast |

### Meta Tools
| Tool | Purpose |
|------|---------|
| list_available_tools | List all tools with descriptions |
| suggest_capability | Suggest a tool/capability you wish you had |

## Workflow

1. **First**: Call **get_pre_verdict_check** to see what quick checks already ran
2. **Then**: Review findings from reviewers above
3. **Investigate**: Use read_file/search_code to verify issues are real
4. **Override if needed**: Use run_* tools to run tests the selector skipped
5. **Decide**: PASS or BLOCK with clear reasoning

## Conservative Principle

When in doubt, RUN THE TEST. If uncertain about a skip decision:
1. Use explain_skip_decision to understand why
2. If still uncertain, use run_* to run the test
3. Include the result in your decision

## Response Format

1. **PR Summary**: What does this PR do?
2. **Selector Review**: Did you agree with the fast selector's decisions? Did you run any additional tests?
3. **Verification**: For each blocking issue, what did you find when you investigated?
4. **Decision**: Clear reasoning for PASS or BLOCK
5. **Final Line**: Your verdict (exactly as shown below)

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
  const maxIterations = 30 // Allow thorough verification while avoiding infinite loops

  while (iterations < maxIterations) {
    iterations++

    // Cost limit check - prevent runaway costs from infinite tool loops
    const costCheck = checkCostLimit()
    if (!costCheck.allowed) {
      console.error(`\n❌ ${costCheck.message}`)
      response = `FINAL VERDICT: BLOCK\n\nReason: CI cost limit exceeded ($${costCheck.currentCost.toFixed(2)}). ` +
        'This is a safety mechanism to prevent runaway costs. ' +
        'Please check the tool loop for potential issues.'
      break
    }
    if (costCheck.warning) {
      console.warn(`⚠️ ${costCheck.message}`)
    }

    const result = await callOpenRouter(systemPrompt, messages)

    if (result.toolCalls.length === 0) {
      // No more tool calls - we have the final response
      response = result.response
      break
    }

    // Safety check: if approaching limit, add nudge to conclude
    if (iterations >= maxIterations - 3) {
      console.warn(`⚠️ Approaching iteration limit (${iterations}/${maxIterations})`)
      // Add a system message to encourage conclusion
      if (iterations === maxIterations - 2) {
        messages.push({
          role: 'user',
          content: 'You are running low on iterations. Please make your final PASS or BLOCK decision based on the information you have gathered so far. If you cannot find specific information, make a reasonable judgment based on available evidence.',
        })
      }
    }

    // Execute tool calls
    console.log(`\n🔧 Tool calls (iteration ${iterations}):`)

    // Build tool results for OpenAI format
    const toolResultMessages: Message[] = []

    for (const toolCall of result.toolCalls) {
      // Track tool usage for verification
      toolsUsed.add(toolCall.name)

      console.log(`   ${toolCall.name}(${JSON.stringify(toolCall.input).slice(0, 50)}...)`)
      const toolResult = executeTool(toolCall.name, toolCall.input)
      console.log(`   → ${toolResult.slice(0, 60)}${toolResult.length > 60 ? '...' : ''}`)

      // Add tool result message in OpenAI format
      toolResultMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      })
    }

    // Add assistant message with tool calls (OpenAI format)
    messages.push({
      role: 'assistant',
      content: result.response || null,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.input),
        },
      })),
    })

    // Add all tool result messages
    messages.push(...toolResultMessages)
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

  // Record selector feedback for accuracy tracking
  const testSelectionPath = 'ci-state/test-selection.json'
  if (existsSync(testSelectionPath)) {
    try {
      const testSelection = JSON.parse(readFileSync(testSelectionPath, 'utf-8'))
      const selectorDecisions = testSelection.decisions || []

      // Check if supervisor ran any skipped tests
      const skippedTests = selectorDecisions.filter((d: { enabled: boolean }) => !d.enabled)
      const additionalTestsRun: string[] = []
      const additionalTestResults: Array<{ test: string; passed: boolean }> = []

      // Check toolsUsed to see if supervisor ran skipped tests
      for (const skipped of skippedTests) {
        const toolName = `run_${skipped.testType.replace(/-/g, '_')}`
        if (toolsUsed.has(toolName)) {
          additionalTestsRun.push(skipped.testType)
          // If we blocked because of this test, it failed
          const testFailed = blocked && response.toLowerCase().includes(skipped.testType)
          additionalTestResults.push({ test: skipped.testType, passed: !testFailed })
        }
      }

      // Determine if selector was accurate
      const selectorAccurate = additionalTestResults.every(r => r.passed)

      const feedback: SelectorFeedback = {
        timestamp: new Date().toISOString(),
        prNumber: parseInt(process.env.GITHUB_PR_NUMBER || '0') || undefined,
        commitSha: process.env.GITHUB_SHA || 'unknown',
        selectorModel: testSelection.model,
        selectorDecisions: selectorDecisions.map((d: { testType: string; enabled: boolean; reason: string }) => ({
          testType: d.testType,
          enabled: d.enabled,
          reason: d.reason,
        })),
        supervisorOverride: aiOverride || null,
        additionalTestsRun,
        additionalTestResults,
        selectorAccurate,
        lesson: !selectorAccurate
          ? `Selector skipped ${additionalTestsRun.join(', ')} but supervisor found issues`
          : undefined,
      }

      recordSelectorFeedback(feedback)

      // If selector was wrong, generate a suggested GitHub issue
      if (!selectorAccurate && additionalTestsRun.length > 0) {
        generateSelectorLearningIssue(feedback, testSelection)
      }

      console.log(`\n📊 Selector Accuracy: ${selectorAccurate ? '✅ Correct' : '⚠️ Needed override'}`)
      if (additionalTestsRun.length > 0) {
        console.log(`   Additional tests run by supervisor: ${additionalTestsRun.join(', ')}`)
      }
    } catch (e) {
      console.log(`   ⚠️ Could not record selector feedback: ${e}`)
    }
  }

  // Log audit trail
  logAuditEntry({
    timestamp: new Date().toISOString(),
    type: 'verdict',
    prNumber: parseInt(process.env.GITHUB_PR_NUMBER || '0') || undefined,
    commitSha: process.env.GITHUB_SHA || 'unknown',
    model: VERDICT_MODEL,
    decision: verdictOutput.verdict,
    reasoning: response.slice(0, 500),
    metadata: {
      toolsUsed: [...toolsUsed],
      aiOverride: aiOverride || null,
      reviewerCount: reviewerNames.length,
      failingReviewers,
    },
  })

  generateComment(verdictOutput, reviews, changedFiles.split('\n').filter(Boolean), prTitle)

  console.log(`\n⏱️ Duration: ${Math.round((Date.now() - startTime) / 1000)}s`)

  // Show cost summary
  const costMd = generateCostSummaryMarkdown()
  if (costMd) {
    console.log('\n' + costMd.replace(/\n/g, '\n   '))
  }

  if (blocked) {
    console.log('\n❌ BLOCKED - Issues must be addressed')
    process.exit(1)
  } else {
    console.log('\n✅ PASSED - Ready to merge')
    process.exit(0)
  }
}

/**
 * Generate a suggested GitHub issue when selector made wrong decisions
 */
function generateSelectorLearningIssue(
  feedback: SelectorFeedback,
  testSelection: { changedFiles?: string[]; categories?: Record<string, string[]> }
): void {
  const issueTemplate = `## 🤖 CI Selector Learning: Potential Improvement

The smart selector made a decision that the supervisor disagreed with. This issue captures the learning for potential prompt improvements.

### What Happened

| Aspect | Value |
|--------|-------|
| PR | #${feedback.prNumber || 'unknown'} |
| Selector Model | ${feedback.selectorModel} |
| Supervisor Override | ${feedback.supervisorOverride ? `${feedback.supervisorOverride.from} → ${feedback.supervisorOverride.to}` : 'None'} |

### Selector Decisions
${feedback.selectorDecisions.map(d => `- **${d.testType}**: ${d.enabled ? '✅ RUN' : '⏭️ SKIP'} — ${d.reason}`).join('\n')}

### Supervisor Actions
- **Additional tests run:** ${feedback.additionalTestsRun.join(', ') || 'None'}
- **Results:** ${feedback.additionalTestResults.map(r => `${r.test}: ${r.passed ? '✅' : '❌'}`).join(', ') || 'N/A'}

### Changed Files (${testSelection.changedFiles?.length || 0})
\`\`\`
${(testSelection.changedFiles || []).slice(0, 20).join('\n')}
${(testSelection.changedFiles?.length || 0) > 20 ? '... and more' : ''}
\`\`\`

### Suggested Improvement

${feedback.lesson || 'Review the selector prompt to handle this case better.'}

**Possible actions:**
- [ ] Update selector prompt to recognize this pattern
- [ ] Add this file pattern to core files that always run full suite
- [ ] Adjust the test type heuristics

---
*Auto-generated by CI selector feedback loop*
`

  // Save as a file that can be used to create an issue
  writeFileSync('ci-state/selector-learning-issue.md', issueTemplate)
  console.log('   📝 Selector learning issue template saved: ci-state/selector-learning-issue.md')
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

  // Build reviewer counts
  const passCount = verdict.reviewerSummary.filter(r => r.verdict === 'PASS').length
  const warnCount = verdict.reviewerSummary.filter(r => r.verdict === 'WARN').length
  const failCount = verdict.reviewerSummary.filter(r => r.verdict === 'FAIL').length
  const totalCount = verdict.reviewerSummary.length

  // Start with a VERY CLEAR verdict statement
  let comment = `![CI Status](${badgeUrl})

## ${emoji} Final AI Verdict: ${status}

**PR:** ${prTitle}
**Files Changed:** ${changedFiles.length} | **Reviewers:** ${totalCount} (${passCount}✅ ${warnCount}⚠️ ${failCount}❌)

`

  // BLOCKED - Show exactly what must be fixed
  if (isBlocked) {
    // TL;DR clearly shows WHY it's blocked and what happens next
    const failedNames = verdict.reviewerSummary.filter(r => r.verdict === 'FAIL').map(r => r.reviewer)
    comment += `> 🚫 **This PR cannot be merged.** CI has failed.
>
> **Reason:** ${failCount > 0 ? `${failCount} reviewer${failCount !== 1 ? 's' : ''} found blocking issues: **${failedNames.join(', ')}**` : 'Critical issues found during final review.'}
>
> **Next step:** Fix the issues below, then push a new commit to re-run CI.

### 📊 Detailed Reviewer Results

${verdict.reviewerSummary.map(r => {
  const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'WARN' ? '⚠️' : '❌'
  const review = reviews[r.reviewer]
  const reviewSummary = review?.summary || 'No summary available'
  const findings = review?.findings || []
  const criticalFindings = findings.filter(f => f.severity === 'critical')
  const warningFindings = findings.filter(f => f.severity === 'warning')

  let section = `<details ${r.verdict === 'FAIL' ? 'open' : ''}>
<summary>${icon} <strong>${r.reviewer}</strong>: ${r.verdict} — ${reviewSummary.slice(0, 80)}${reviewSummary.length > 80 ? '...' : ''}</summary>

`
  if (criticalFindings.length > 0) {
    section += `**🔴 Critical Issues (${criticalFindings.length}):**\n`
    for (const f of criticalFindings.slice(0, 5)) {
      const loc = f.line ? `${f.file || 'unknown'}:${f.line}` : (f.file || 'unknown')
      section += `- \`${loc}\`: ${f.message}\n`
    }
    if (criticalFindings.length > 5) section += `  _...and ${criticalFindings.length - 5} more critical issues_\n`
    section += '\n'
  }
  if (warningFindings.length > 0) {
    section += `**🟡 Warnings (${warningFindings.length}):**\n`
    for (const f of warningFindings.slice(0, 3)) {
      const loc = f.line ? `${f.file || 'unknown'}:${f.line}` : (f.file || 'unknown')
      section += `- \`${loc}\`: ${f.message}\n`
    }
    if (warningFindings.length > 3) section += `  _...and ${warningFindings.length - 3} more warnings_\n`
    section += '\n'
  }
  if (findings.length === 0) {
    section += `_No issues found by this reviewer._\n\n`
  }
  section += '</details>\n'
  return section
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

### 📊 Detailed Reviewer Results

${verdict.reviewerSummary.map(r => {
  const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'WARN' ? '⚠️' : '❌'
  const review = reviews[r.reviewer]
  const reviewSummary = review?.summary || 'No summary available'
  const findings = review?.findings || []
  const warningFindings = findings.filter(f => f.severity === 'warning')
  const infoFindings = findings.filter(f => f.severity === 'info')

  let section = `<details>
<summary>${icon} <strong>${r.reviewer}</strong>: ${r.verdict} — ${reviewSummary.slice(0, 80)}${reviewSummary.length > 80 ? '...' : ''}</summary>

`
  if (warningFindings.length > 0) {
    section += `**🟡 Suggestions (${warningFindings.length}):**\n`
    for (const f of warningFindings.slice(0, 3)) {
      const loc = f.line ? `${f.file || 'unknown'}:${f.line}` : (f.file || 'unknown')
      section += `- \`${loc}\`: ${f.message}\n`
    }
    if (warningFindings.length > 3) section += `  _...and ${warningFindings.length - 3} more suggestions_\n`
    section += '\n'
  }
  if (infoFindings.length > 0 && warningFindings.length === 0) {
    section += `**💡 Notes (${infoFindings.length}):**\n`
    for (const f of infoFindings.slice(0, 2)) {
      section += `- ${f.message}\n`
    }
    if (infoFindings.length > 2) section += `  _...and ${infoFindings.length - 2} more notes_\n`
    section += '\n'
  }
  if (findings.length === 0) {
    section += `✨ _Clean review - no issues found._\n\n`
  }
  section += '</details>\n'
  return section
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

  // Load and display extended checks from smart selector
  const testSelectionPath = 'ci-state/test-selection.json'
  if (existsSync(testSelectionPath)) {
    try {
      const testSelection = JSON.parse(readFileSync(testSelectionPath, 'utf-8'))
      const extendedChecks = testSelection.extendedChecks || []

      if (extendedChecks.length > 0) {
        const highPriority = extendedChecks.filter((c: { priority: string }) => c.priority === 'high')
        const otherPriority = extendedChecks.filter((c: { priority: string }) => c.priority !== 'high')

        comment += `### 🔍 Extended Checks Recommended

The smart selector analyzed this PR and recommended **${extendedChecks.length}** additional checks:

`
        if (highPriority.length > 0) {
          comment += `**🔴 High Priority:**\n`
          for (const check of highPriority) {
            comment += `- \`${check.type}\`: ${check.reason}\n`
          }
          comment += '\n'
        }
        if (otherPriority.length > 0) {
          comment += `<details>
<summary>Other recommendations (${otherPriority.length})</summary>

${otherPriority.map((c: { type: string; reason: string; priority: string }) => `- [${c.priority}] \`${c.type}\`: ${c.reason}`).join('\n')}

</details>

`
        }
      }
    } catch {
      // Ignore errors loading test selection
    }
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

  // Decision reasoning - show the AI's actual analysis with more detail
  comment += `
### 🧠 AI Analysis & Decision

`
  // Extract meaningful reasoning from AI response
  const reasoningEnd = verdict.reasoning.indexOf('FINAL VERDICT:')
  const fullReasoning = reasoningEnd > 0 ? verdict.reasoning.slice(0, reasoningEnd).trim() : verdict.reasoning

  if (!isBlocked) {
    // For PASS - show a summary plus key verifications
    const cleanReviewers = verdict.reviewerSummary.filter(r => r.criticalCount === 0 && r.warningCount === 0)
    const warnReviewers = verdict.reviewerSummary.filter(r => r.warningCount > 0 && r.criticalCount === 0)

    comment += `**Summary:** `
    if (prRelevant.length === 0) {
      comment += `No issues were found in the files changed by this PR. `
    } else {
      comment += `Found ${prRelevant.length} minor suggestion${prRelevant.length > 1 ? 's' : ''} in this PR (none blocking). `
    }

    if (cleanReviewers.length > 0) {
      comment += `${cleanReviewers.map(r => r.reviewer).join(', ')} gave clean reviews. `
    }
    if (warnReviewers.length > 0) {
      comment += `${warnReviewers.map(r => r.reviewer).join(', ')} had minor suggestions.`
    }
    comment += '\n\n'

    // Show key verifications performed
    const verificationStatuses = Object.entries(verdict.verifications)
      .filter(([_, status]) => status !== 'skipped')
      .map(([name, status]) => `${status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : '❌'} ${name}`)
    if (verificationStatuses.length > 0) {
      comment += `**Verifications:** ${verificationStatuses.join(' | ')}\n\n`
    }

    // Include relevant parts of AI reasoning if it's substantial
    if (fullReasoning.length > 200) {
      comment += `<details>
<summary>📖 Full AI reasoning</summary>

${fullReasoning.slice(0, 1500)}${fullReasoning.length > 1500 ? '\n\n_...truncated_' : ''}

</details>
`
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
    // For BLOCK - show more detailed AI reasoning
    // Get the most relevant paragraphs that explain the issues
    const paragraphs = fullReasoning.split('\n\n').filter(p => p.trim() && p.length > 30)

    // Look for verification/investigation sections
    const investigationParagraphs = paragraphs.filter(p =>
      p.toLowerCase().includes('read') ||
      p.toLowerCase().includes('verified') ||
      p.toLowerCase().includes('found') ||
      p.toLowerCase().includes('issue')
    )

    if (investigationParagraphs.length > 0) {
      comment += `**AI Investigation:**\n\n`
      for (const p of investigationParagraphs.slice(0, 3)) {
        comment += `> ${p.slice(0, 400)}${p.length > 400 ? '...' : ''}\n>\n`
      }
      comment += '\n'
    }

    // Show the final decision paragraph
    const lastParagraph = paragraphs[paragraphs.length - 1] || 'Critical issues must be addressed before merge.'
    comment += `**Conclusion:** ${lastParagraph.slice(0, 500)}${lastParagraph.length > 500 ? '...' : ''}\n`

    // Show full reasoning in collapsible
    if (fullReasoning.length > 500) {
      comment += `
<details>
<summary>📖 Full AI analysis</summary>

${fullReasoning.slice(0, 2000)}${fullReasoning.length > 2000 ? '\n\n_...truncated_' : ''}

</details>
`
    }
  }

  // Note about pre-existing issues (if any) - brief mention, details in separate comment
  if (preExisting.length > 0) {
    comment += `

---

📋 **Note:** Found ${preExisting.length} issue${preExisting.length > 1 ? 's' : ''} in files NOT changed by this PR. These are pre-existing and won't block this PR. See the follow-up comment for details.`
  }

  // Collapsed section for AI agents - make it self-contained with full context
  const structuredData = {
    verdict: verdict.verdict,
    ciStatus: isBlocked ? 'FAILED' : 'PASSED',
    confidence: verdict.confidence,
    summary: isBlocked
      ? `PR BLOCKED: ${prCritical.length} critical issues must be fixed`
      : verdict.aiOverride
        ? `PR APPROVED: ${failCount} reviewer failures verified as non-blocking (${verdict.aiOverride.reason})`
        : `PR APPROVED: ${prRelevant.length} minor findings (none blocking)`,

    // Files changed in this PR - use to verify if issues are in this PR or pre-existing
    filesChanged: changedFiles.slice(0, 50), // Limit to 50 files

    prChanges: {
      filesChangedCount: changedFiles.length,
      findings: prRelevant.length,
      critical: prCritical.length,
      warnings: prWarnings.length,
      info: prInfo.length,
    },

    preExisting: {
      count: preExisting.length,
      note: preExisting.length > 0 ? 'Issues in unchanged files - not blocking' : null,
      files: preExisting.slice(0, 10).map(f => f.file),
    },

    // Detailed reviewer info with actual findings
    reviewers: Object.entries(reviews).map(([name, review]) => ({
      name,
      verdict: review.verdict,
      confidence: review.confidence,
      summary: review.summary,
      criticalCount: review.findings.filter(f => f.severity === 'critical').length,
      warningCount: review.findings.filter(f => f.severity === 'warning').length,
      // Include top findings for each reviewer
      topFindings: review.findings
        .filter(f => f.severity === 'critical' || f.severity === 'warning')
        .slice(0, 5)
        .map(f => ({
          severity: f.severity,
          category: f.category,
          file: f.file,
          line: f.line,
          message: f.message,
        })),
    })),

    verifications: Object.fromEntries(
      Object.entries(verdict.verifications).map(([k, v]) => [
        k,
        v === 'fail' && preExisting.length > 0 ? `${v} (pre-existing)` : v
      ])
    ),

    // AI's investigation summary - what tools were used, what was verified
    aiAnalysis: {
      reasoning: fullReasoning.slice(0, 1000),
      toolsUsed: verdict.raw?.toolsUsed || [],
    },

    // All critical issues that must be fixed (full detail)
    mustFix: prCritical.map(f => ({
      severity: f.severity,
      category: f.category,
      file: f.file,
      line: f.line,
      issue: f.issue,
      whyItMatters: f.whyItMatters,
      howToFix: f.fix?.explanation,
      isInPrFiles: changedFiles.some(cf => f.file?.includes(cf) || cf.includes(f.file || '')),
    })),

    // All warnings (suggestions)
    suggestions: prWarnings.map(f => ({
      severity: f.severity,
      category: f.category,
      file: f.file,
      line: f.line,
      issue: f.issue,
      isInPrFiles: changedFiles.some(cf => f.file?.includes(cf) || cf.includes(f.file || '')),
    })),

    // AI override info if applicable
    aiOverride: verdict.aiOverride || null,
  }

  comment += `

<details>
<summary>📎 For AI agents: structured data</summary>

\`\`\`json
${JSON.stringify(structuredData, null, 2)}
\`\`\`

</details>`

  // Check if a selector learning issue was generated
  const learningIssuePath = 'ci-state/selector-learning-issue.md'
  if (existsSync(learningIssuePath)) {
    comment += `

---

### 📝 CI Selector Learning Opportunity

The AI supervisor found that the smart test selector made a suboptimal decision for this PR. A learning issue template has been generated.

<details>
<summary>📋 View learning issue template</summary>

${readFileSync(learningIssuePath, 'utf-8')}

</details>

> **Maintainers:** Consider creating a GitHub issue from this template to improve the selector's decision-making for similar PRs in the future.`
  }

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
