#!/usr/bin/env npx tsx
/**
 * AI-Powered Migration Review
 *
 * IMPORTANT: This script is NON-BLOCKING.
 * - It reports findings but does NOT fail the CI
 * - Only the final verdict script can block PRs
 * - Exit 0 = review completed (even if issues found)
 * - Exit 1 = script itself failed (API error, couldn't run)
 *
 * Reviews new database migrations for:
 * - Naming conventions (snake_case, plural tables)
 * - RLS security (policies, SECURITY DEFINER)
 * - Data integrity (foreign keys, constraints)
 * - Rollback safety
 * - Familjen-specific patterns
 *
 * Also generates rollback SQL for each migration.
 *
 * Usage:
 *   npx tsx scripts/migration-ai-review.ts
 *   npx tsx scripts/migration-ai-review.ts --all  # Review all migrations
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { AI_MODELS, callOpenRouterStructured, SCHEMAS, type MigrationReviewResult } from './ai-config'
import {
  type ReviewerOutput,
  type Finding,
  type RollbackMigration,
  saveReviewerOutput,
  saveRollbackMigration,
  verdictEmoji,
} from './ai-review-types'

const MIGRATIONS_DIR = 'supabase/migrations'

interface MigrationFile {
  name: string
  content: string
  timestamp: string
}

function getMigrations(): MigrationFile[] {
  if (!existsSync(MIGRATIONS_DIR)) {
    return []
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  return files.map((name) => ({
    name,
    content: readFileSync(join(MIGRATIONS_DIR, name), 'utf-8'),
    timestamp: name.split('_')[0],
  }))
}

function getNewMigrations(migrations: MigrationFile[]): MigrationFile[] {
  // Check if we're in a PR context by comparing with base branch
  try {
    // Get list of changed files compared to origin/main
    const changedFiles = execSync('git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~1', {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)

    const changedMigrations = changedFiles
      .filter((f) => f.startsWith('supabase/migrations/') && f.endsWith('.sql'))
      .map((f) => f.replace('supabase/migrations/', ''))

    if (changedMigrations.length === 0) {
      return []
    }

    return migrations.filter((m) => changedMigrations.includes(m.name))
  } catch {
    // If git comparison fails, assume the latest migration is new
    return migrations.length > 0 ? [migrations[migrations.length - 1]] : []
  }
}

function buildReviewPrompt(newMigration: MigrationFile, previousMigrations: MigrationFile[]): string {
  // Include last 5 migrations for context (truncated)
  const contextMigrations = previousMigrations.slice(-5)
  const contextSection = contextMigrations
    .map((m) => `### ${m.name}\n\`\`\`sql\n${m.content.slice(0, 1000)}${m.content.length > 1000 ? '\n-- [truncated]' : ''}\n\`\`\``)
    .join('\n\n')

  return `You are a PostgreSQL and Supabase expert reviewing database migrations for Familjen, a Norwegian family planning app.

## Existing Migrations (for context - last 5)
${contextSection || 'No previous migrations.'}

## NEW Migration to Review
### ${newMigration.name}
\`\`\`sql
${newMigration.content}
\`\`\`

## Review Checklist

### Naming Conventions
- Tables: snake_case, plural (e.g., household_members, child_tasks)
- Columns: snake_case (e.g., created_at, household_id)
- Functions: snake_case with verb prefix (e.g., get_user_household_id, create_household_with_admin)
- Indexes: idx_{table}_{columns}
- Constraints: {table}_{type}_{columns} (e.g., households_pkey, meals_household_id_fkey)

### Security (CRITICAL for RLS)
- [ ] New tables have RLS enabled: \`ALTER TABLE x ENABLE ROW LEVEL SECURITY\`
- [ ] Policies reference get_user_household_id() for household scoping
- [ ] SECURITY DEFINER functions have explicit search_path = ''
- [ ] No SQL injection vectors in dynamic queries

### Data Integrity
- [ ] Foreign keys have appropriate ON DELETE (CASCADE vs SET NULL vs RESTRICT)
- [ ] NOT NULL constraints where data is required
- [ ] DEFAULT values for timestamps (NOW(), gen_random_uuid())
- [ ] Indexes on foreign keys and frequently queried columns

### Rollback Safety
- [ ] Changes are reversible (no DROP without backup plan)
- [ ] Data migrations preserve existing data
- [ ] Uses IF EXISTS / IF NOT EXISTS where appropriate

### Familjen-Specific Patterns
- [ ] Uses household_id for multi-tenant isolation
- [ ] Timestamps use TIMESTAMPTZ (not TIMESTAMP)
- [ ] UUIDs for primary keys (gen_random_uuid())
- [ ] Follows existing patterns from prior migrations

Analyze the migration and provide your assessment.`
}

/**
 * Generate rollback SQL for a migration
 */
async function generateRollbackSql(migration: MigrationFile): Promise<RollbackMigration> {
  const rollbackPrompt = `You are a PostgreSQL expert. Generate a rollback SQL script that reverses this migration.

## Migration to Reverse
### ${migration.name}
\`\`\`sql
${migration.content}
\`\`\`

## Rules
1. Generate SQL that completely reverses the migration
2. DROP tables/columns that were created
3. Recreate tables/columns that were dropped (if possible)
4. Reverse any RLS policy changes
5. Reverse any function changes
6. Use IF EXISTS to make rollback idempotent
7. If data loss would occur, add a comment warning about it

Respond with ONLY the SQL rollback script, no explanations. Start with a comment header.`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODELS.fast,
        messages: [{ role: 'user', content: rollbackPrompt }],
        temperature: 0,
      }),
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> }
    const rollbackSql = data.choices[0]?.message?.content || '-- Rollback generation failed'

    // Parse warnings from comments in the SQL
    const warnings: string[] = []
    const warningMatches = rollbackSql.match(/-- WARNING:.*$/gm) || []
    for (const match of warningMatches) {
      warnings.push(match.replace('-- WARNING:', '').trim())
    }

    // Check if reversible (no data loss warnings)
    const isReversible = !rollbackSql.toLowerCase().includes('data loss') && !rollbackSql.toLowerCase().includes('cannot be reversed')

    return {
      originalFile: migration.name,
      rollbackSql,
      isReversible,
      warnings,
      generatedAt: new Date().toISOString(),
      generatedBy: AI_MODELS.fast,
    }
  } catch (error) {
    return {
      originalFile: migration.name,
      rollbackSql: `-- Rollback generation failed: ${error instanceof Error ? error.message : 'Unknown error'}\n-- Manual rollback required`,
      isReversible: false,
      warnings: ['Automatic rollback generation failed - manual SQL required'],
      generatedAt: new Date().toISOString(),
      generatedBy: AI_MODELS.fast,
    }
  }
}

async function reviewMigration(migration: MigrationFile, previousMigrations: MigrationFile[]): Promise<MigrationReviewResult> {
  const prompt = buildReviewPrompt(migration, previousMigrations)

  console.log(`\n📝 Reviewing: ${migration.name}`)
  console.log(`   Using model: ${AI_MODELS.fast}`)

  try {
    const result = await callOpenRouterStructured<MigrationReviewResult>(
      AI_MODELS.fast,
      [{ role: 'user', content: prompt }],
      SCHEMAS.migrationReview,
      'migration_review',
      { temperature: 0 }
    )
    return result
  } catch (error) {
    console.error('Failed to get AI response:', error instanceof Error ? error.message : 'Unknown error')
    return {
      verdict: 'WARN',
      issues: [{ severity: 'warning', message: 'Failed to get AI review response' }],
      suggestions: [],
      summary: 'AI review could not be completed. Manual review recommended.',
    }
  }
}

function formatReviewOutput(migration: string, review: MigrationReviewResult): void {
  const verdictEmoji = {
    PASS: '✅',
    FAIL: '❌',
    WARN: '⚠️',
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Migration: ${migration}`)
  console.log(`Verdict: ${verdictEmoji[review.verdict]} ${review.verdict}`)
  console.log(`${'='.repeat(60)}`)
  console.log(`\nSummary: ${review.summary}`)

  if (review.issues.length > 0) {
    console.log('\nIssues:')
    for (const issue of review.issues) {
      const icon = issue.severity === 'critical' ? '🚫' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'
      const lineInfo = issue.line ? ` (line ${issue.line})` : ''
      console.log(`  ${icon} [${issue.severity.toUpperCase()}]${lineInfo}: ${issue.message}`)
    }
  }

  if (review.suggestions.length > 0) {
    console.log('\nSuggestions:')
    for (const suggestion of review.suggestions) {
      console.log(`  💡 ${suggestion}`)
    }
  }
}

/**
 * Convert MigrationReviewResult issues to Finding[] format
 */
function convertToFindings(review: MigrationReviewResult, migrationFile: string): Finding[] {
  const findings: Finding[] = []

  for (const issue of review.issues) {
    findings.push({
      severity: issue.severity === 'critical' ? 'critical' : issue.severity === 'warning' ? 'warning' : 'info',
      category: 'migration',
      message: issue.message,
      file: `supabase/migrations/${migrationFile}`,
      line: issue.line ?? undefined,
    })
  }

  return findings
}

/**
 * Map migration verdict to reviewer verdict
 */
function mapVerdict(verdict: 'PASS' | 'FAIL' | 'WARN'): 'PASS' | 'WARN' | 'FAIL' {
  switch (verdict) {
    case 'PASS': return 'PASS'
    case 'FAIL': return 'FAIL'
    case 'WARN': return 'WARN'
  }
}

async function main() {
  const startTime = Date.now()
  const args = process.argv.slice(2)
  const reviewAll = args.includes('--all')

  console.log('🔍 AI Migration Review (Non-Blocking)')
  console.log(`Mode: ${reviewAll ? 'All migrations' : 'New migrations only'}`)

  // Check for API key
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set')
    const errorOutput: ReviewerOutput = {
      reviewer: 'migration-review',
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
      summary: 'Migration review failed: API key not configured.',
    }
    saveReviewerOutput(errorOutput)
    process.exit(1) // Script failed to run
  }

  const migrations = getMigrations()
  if (migrations.length === 0) {
    console.log('No migrations found.')
    const skippedOutput: ReviewerOutput = {
      reviewer: 'migration-review',
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'No migrations to review.',
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0)
  }

  const toReview = reviewAll ? migrations : getNewMigrations(migrations)
  if (toReview.length === 0) {
    console.log('✅ No new migrations to review.')
    const skippedOutput: ReviewerOutput = {
      reviewer: 'migration-review',
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'skipped',
      verdict: 'PASS',
      confidence: 100,
      findings: [],
      summary: 'No new migrations to review.',
    }
    saveReviewerOutput(skippedOutput)
    process.exit(0)
  }

  console.log(`Found ${toReview.length} migration(s) to review`)

  const results: Array<{ name: string; review: MigrationReviewResult }> = []
  const allFindings: Finding[] = []
  let worstVerdict: 'PASS' | 'WARN' | 'FAIL' = 'PASS'

  for (const migration of toReview) {
    const previousMigrations = migrations.filter((m) => m.timestamp < migration.timestamp)

    // Review the migration
    const review = await reviewMigration(migration, previousMigrations)
    results.push({ name: migration.name, review })
    formatReviewOutput(migration.name, review)

    // Convert to findings
    allFindings.push(...convertToFindings(review, migration.name))

    // Track worst verdict
    if (review.verdict === 'FAIL') worstVerdict = 'FAIL'
    else if (review.verdict === 'WARN' && worstVerdict !== 'FAIL') worstVerdict = 'WARN'

    // Generate rollback SQL
    console.log(`   Generating rollback SQL...`)
    const rollback = await generateRollbackSql(migration)
    saveRollbackMigration(rollback)
    if (!rollback.isReversible) {
      console.log(`   ⚠️ Migration may not be fully reversible`)
      allFindings.push({
        severity: 'warning',
        category: 'migration',
        message: `Migration may not be fully reversible: ${rollback.warnings.join(', ') || 'potential data loss'}`,
        file: `supabase/migrations/${migration.name}`,
      })
    }
  }

  // Write old format for backwards compatibility
  writeFileSync('migration-review.json', JSON.stringify(results, null, 2))

  // Save in new standardized format
  const output: ReviewerOutput = {
    reviewer: 'migration-review',
    model: AI_MODELS.fast,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    status: 'completed',
    verdict: mapVerdict(worstVerdict),
    confidence: worstVerdict === 'PASS' ? 90 : worstVerdict === 'WARN' ? 75 : 85,
    findings: allFindings,
    summary: allFindings.length === 0
      ? `Reviewed ${results.length} migration(s) - all passed.`
      : `Reviewed ${results.length} migration(s) - found ${allFindings.filter(f => f.severity === 'critical').length} critical issues, ${allFindings.filter(f => f.severity === 'warning').length} warnings.`,
    raw: results,
  }
  saveReviewerOutput(output)

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Reviewed: ${results.length} migration(s)`)
  console.log(`Passed: ${results.filter((r) => r.review.verdict === 'PASS').length}`)
  console.log(`Warnings: ${results.filter((r) => r.review.verdict === 'WARN').length}`)
  console.log(`Failed: ${results.filter((r) => r.review.verdict === 'FAIL').length}`)
  console.log(`\n📄 Results: ai-reviews/migration-review.json`)
  console.log(`📄 Rollbacks: ai-reviews/rollback-migrations/`)

  // Always exit 0 - review completed, final verdict decides blocking
  console.log(`\n${verdictEmoji(mapVerdict(worstVerdict))} Review complete (${mapVerdict(worstVerdict)})`)
  process.exit(0)
}

main().catch((error) => {
  const startTime = Date.now()
  console.error('Migration review failed:', error.message)

  // Save error output
  const errorOutput: ReviewerOutput = {
    reviewer: 'migration-review',
    model: AI_MODELS.fast,
    timestamp: new Date().toISOString(),
    duration_ms: 0,
    status: 'failed',
    verdict: 'ERROR',
    confidence: 0,
    findings: [{
      severity: 'critical',
      category: 'runtime-error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }],
    summary: 'Migration review failed due to an error.',
  }
  saveReviewerOutput(errorOutput)

  process.exit(1) // Script itself failed
})
