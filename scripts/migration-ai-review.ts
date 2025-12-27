#!/usr/bin/env npx tsx
/**
 * AI-Powered Migration Review
 *
 * Reviews new database migrations for:
 * - Naming conventions (snake_case, plural tables)
 * - RLS security (policies, SECURITY DEFINER)
 * - Data integrity (foreign keys, constraints)
 * - Rollback safety
 * - Familjen-specific patterns
 *
 * Usage:
 *   npx tsx scripts/migration-ai-review.ts
 *   npx tsx scripts/migration-ai-review.ts --all  # Review all migrations
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { AI_MODELS, callOpenRouterStructured, SCHEMAS, type MigrationReviewResult } from './ai-config'

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

async function main() {
  const args = process.argv.slice(2)
  const reviewAll = args.includes('--all')

  console.log('🔍 AI Migration Review')
  console.log(`Mode: ${reviewAll ? 'All migrations' : 'New migrations only'}`)

  const migrations = getMigrations()
  if (migrations.length === 0) {
    console.log('No migrations found.')
    process.exit(0)
  }

  const toReview = reviewAll ? migrations : getNewMigrations(migrations)
  if (toReview.length === 0) {
    console.log('✅ No new migrations to review.')
    process.exit(0)
  }

  console.log(`Found ${toReview.length} migration(s) to review`)

  const results: Array<{ name: string; review: MigrationReviewResult }> = []
  let hasFailure = false
  let hasWarning = false

  for (const migration of toReview) {
    const previousMigrations = migrations.filter((m) => m.timestamp < migration.timestamp)
    const review = await reviewMigration(migration, previousMigrations)
    results.push({ name: migration.name, review })
    formatReviewOutput(migration.name, review)

    if (review.verdict === 'FAIL') hasFailure = true
    if (review.verdict === 'WARN') hasWarning = true
  }

  // Write results to file for GitHub Actions
  writeFileSync('migration-review.json', JSON.stringify(results, null, 2))
  console.log('\n📄 Results written to migration-review.json')

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Reviewed: ${results.length} migration(s)`)
  console.log(`Passed: ${results.filter((r) => r.review.verdict === 'PASS').length}`)
  console.log(`Warnings: ${results.filter((r) => r.review.verdict === 'WARN').length}`)
  console.log(`Failed: ${results.filter((r) => r.review.verdict === 'FAIL').length}`)

  if (hasFailure) {
    console.log('\n❌ Review failed - critical issues found')
    process.exit(1)
  } else if (hasWarning) {
    console.log('\n⚠️ Review passed with warnings')
    process.exit(0)
  } else {
    console.log('\n✅ All migrations passed review')
    process.exit(0)
  }
}

main().catch((error) => {
  console.error('Migration review failed:', error.message)
  process.exit(1)
})
