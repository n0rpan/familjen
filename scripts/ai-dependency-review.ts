/**
 * AI-Powered Dependency Review
 *
 * Reviews new and updated dependencies for security, license,
 * and maintenance concerns using AI analysis.
 *
 * Usage: npx tsx scripts/ai-dependency-review.ts --base origin/main
 */

import { execFileSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { AI_MODELS, callOpenRouter, withRetry } from './ai-config'
import {
  ReviewerOutput,
  Finding,
  saveReviewerOutput,
  ensureReviewsDir,
} from './ai-review-types'

// ============================================
// CONFIGURATION
// ============================================

const BASE_REF = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'origin/main'

// Known risky patterns
const RISKY_PACKAGES = [
  'eval',
  'unsafe',
  'crypto-', // Except crypto-js which is common
  'shell',
  'exec',
]

const KNOWN_DEPRECATED = [
  'request', // Use fetch or axios
  'moment', // Use date-fns or dayjs
  'lodash', // Often better to use native methods
]

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('📦 AI Dependency Review')
  console.log('='.repeat(50))
  console.log(`Base: ${BASE_REF}`)
  console.log('')

  const startTime = Date.now()
  ensureReviewsDir()

  try {
    // Check if package.json changed
    const changedFiles = getChangedFiles()
    const packageJsonChanged = changedFiles.some(f =>
      f === 'package.json' || f === 'package-lock.json'
    )

    if (!packageJsonChanged) {
      console.log('📝 No dependency changes detected')
      const output: ReviewerOutput = {
        reviewer: 'dependency-review' as any,
        model: 'none',
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        status: 'skipped',
        verdict: 'PASS',
        confidence: 100,
        findings: [],
        summary: 'No dependency changes in this PR.',
      }
      saveReviewerOutput(output)
      return
    }

    // Get dependency changes
    console.log('🔍 Analyzing dependency changes...')
    const changes = getDependencyChanges()
    console.log(`   New: ${changes.added.length}`)
    console.log(`   Removed: ${changes.removed.length}`)
    console.log(`   Updated: ${changes.updated.length}`)

    if (changes.added.length === 0 && changes.updated.length === 0) {
      console.log('📝 Only dependency removals - no review needed')
      const output: ReviewerOutput = {
        reviewer: 'dependency-review' as any,
        model: 'none',
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        status: 'completed',
        verdict: 'PASS',
        confidence: 100,
        findings: [],
        summary: `Removed ${changes.removed.length} dependencies.`,
      }
      saveReviewerOutput(output)
      return
    }

    const findings: Finding[] = []

    // Check for risky packages
    console.log('🔍 Checking for risky patterns...')
    for (const dep of [...changes.added, ...changes.updated.map(u => u.name)]) {
      for (const risky of RISKY_PACKAGES) {
        if (dep.includes(risky) && dep !== 'crypto-js') {
          findings.push({
            severity: 'warning',
            category: 'security',
            message: `Package "${dep}" contains risky pattern "${risky}". Review carefully.`,
          })
        }
      }

      for (const deprecated of KNOWN_DEPRECATED) {
        if (dep === deprecated) {
          findings.push({
            severity: 'info',
            category: 'code-quality',
            message: `Package "${dep}" is commonly considered deprecated. Consider modern alternatives.`,
          })
        }
      }
    }

    // Run AI analysis
    console.log('🧠 Running AI dependency analysis...')
    const aiFindings = await runAIAnalysis(changes)
    findings.push(...aiFindings)

    // Determine verdict
    const criticalCount = findings.filter(f => f.severity === 'critical').length
    const warningCount = findings.filter(f => f.severity === 'warning').length
    const verdict = criticalCount > 0 ? 'FAIL' : warningCount > 0 ? 'WARN' : 'PASS'

    const output: ReviewerOutput = {
      reviewer: 'dependency-review' as any,
      model: AI_MODELS.fast,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'completed',
      verdict,
      confidence: 85,
      findings,
      summary: generateSummary(changes, findings),
      raw: changes,
    }

    saveReviewerOutput(output)

    console.log(`\n${verdict === 'PASS' ? '✅' : verdict === 'WARN' ? '⚠️' : '❌'} Verdict: ${verdict}`)

  } catch (error) {
    console.error('❌ Dependency review failed:', error)
    const output: ReviewerOutput = {
      reviewer: 'dependency-review' as any,
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'failed',
      verdict: 'ERROR',
      confidence: 0,
      findings: [{
        severity: 'critical',
        category: 'security',
        message: `Dependency review failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      summary: 'Dependency review encountered an error.',
    }
    saveReviewerOutput(output)
  }
}

// ============================================
// HELPERS
// ============================================

interface DependencyChanges {
  added: string[]
  removed: string[]
  updated: { name: string; from: string; to: string }[]
}

function getChangedFiles(): string[] {
  try {
    const output = execFileSync('git', ['diff', '--name-only', `${BASE_REF}...HEAD`], {
      encoding: 'utf-8',
    })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    const output = execFileSync('git', ['diff', '--name-only', 'HEAD~1'], {
      encoding: 'utf-8',
    })
    return output.trim().split('\n').filter(Boolean)
  }
}

function getDependencyChanges(): DependencyChanges {
  // Get current package.json
  const currentPkg = JSON.parse(readFileSync('package.json', 'utf-8'))
  const currentDeps = {
    ...currentPkg.dependencies,
    ...currentPkg.devDependencies,
  }

  // Get previous package.json
  let previousDeps: Record<string, string> = {}
  try {
    const prevContent = execFileSync('git', ['show', `${BASE_REF}:package.json`], {
      encoding: 'utf-8',
    })
    const prevPkg = JSON.parse(prevContent)
    previousDeps = {
      ...prevPkg.dependencies,
      ...prevPkg.devDependencies,
    }
  } catch {
    // No previous package.json, all deps are new
  }

  const added: string[] = []
  const removed: string[] = []
  const updated: { name: string; from: string; to: string }[] = []

  // Find added and updated
  for (const [name, version] of Object.entries(currentDeps)) {
    if (!(name in previousDeps)) {
      added.push(name)
    } else if (previousDeps[name] !== version) {
      updated.push({
        name,
        from: previousDeps[name],
        to: version as string,
      })
    }
  }

  // Find removed
  for (const name of Object.keys(previousDeps)) {
    if (!(name in currentDeps)) {
      removed.push(name)
    }
  }

  return { added, removed, updated }
}

async function runAIAnalysis(changes: DependencyChanges): Promise<Finding[]> {
  const model = AI_MODELS.fast

  // Read package.json for context
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))

  const prompt = `You are a security and dependency expert reviewing npm package changes.

## Project Context
- Name: ${pkg.name || 'familjen'}
- Description: Norwegian family planning app
- Framework: Next.js with Supabase

## New Dependencies (${changes.added.length})
${changes.added.length > 0 ? changes.added.map(d => `- ${d}`).join('\n') : 'None'}

## Updated Dependencies (${changes.updated.length})
${changes.updated.length > 0 ? changes.updated.map(d => `- ${d.name}: ${d.from} → ${d.to}`).join('\n') : 'None'}

## Removed Dependencies (${changes.removed.length})
${changes.removed.length > 0 ? changes.removed.map(d => `- ${d}`).join('\n') : 'None'}

## Your Task
Review the dependency changes for:
1. **Security risks**: Known vulnerabilities, suspicious packages, typosquatting
2. **License concerns**: Incompatible licenses (GPL in MIT project)
3. **Maintenance**: Abandoned packages, no recent updates
4. **Bundle impact**: Heavy packages that could bloat the bundle
5. **Alternatives**: Better maintained or lighter alternatives

## Response Format
Return a JSON array of findings. Focus on actionable concerns:
- severity: "critical" | "warning" | "info"
- category: "security" | "code-quality" | "performance"
- message: Clear, actionable feedback

Examples of what to flag:
- New packages with known vulnerabilities
- Major version updates that may have breaking changes
- Heavy packages (moment.js, lodash full)
- Packages with restrictive licenses

Return [] if no concerns. Only return the JSON array.`

  try {
    const response = await withRetry(
      () => callOpenRouter(model, [{ role: 'user', content: prompt }], {
        temperature: 0,
        maxTokens: 2000,
      }),
      'AI dependency analysis'
    )

    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      severity: string
      category: string
      message: string
    }>

    return parsed.map(f => ({
      severity: f.severity as 'critical' | 'warning' | 'info',
      category: f.category as 'security' | 'code-quality' | 'performance',
      message: f.message,
    }))

  } catch (error) {
    console.error('AI analysis failed:', error)
    return []
  }
}

function generateSummary(changes: DependencyChanges, findings: Finding[]): string {
  const critical = findings.filter(f => f.severity === 'critical').length
  const warning = findings.filter(f => f.severity === 'warning').length

  let summary = `+${changes.added.length} added, -${changes.removed.length} removed, ~${changes.updated.length} updated`

  if (critical > 0) {
    summary = `🚨 ${summary} - ${critical} critical concern(s)`
  } else if (warning > 0) {
    summary = `⚠️ ${summary} - ${warning} warning(s)`
  } else if (changes.added.length > 0) {
    summary = `✅ ${summary} - no security concerns`
  } else {
    summary = `✅ ${summary}`
  }

  return summary
}

// Run
main()
