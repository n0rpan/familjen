/**
 * AI-Powered PR Auto-Labeling
 *
 * Analyzes PR content and automatically suggests/applies labels.
 * Runs early in CI to provide immediate context.
 *
 * Usage: npx tsx scripts/ai-pr-labeler.ts
 */

import { execFileSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { AI_MODELS, callOpenRouter, withRetry } from './ai-config'
import {
  initPRMetrics,
  recordAPICall,
  setSuggestedLabels,
  setAppliedLabels,
  savePRMetrics,
  calculateCost,
} from './ai-metrics'

// ============================================
// CONFIGURATION
// ============================================

const BASE_REF = process.env.GITHUB_BASE_REF || 'main'
const PR_TITLE = process.env.GITHUB_PR_TITLE || ''
const PR_BODY = process.env.GITHUB_PR_BODY || ''
const PR_NUMBER = parseInt(process.env.GITHUB_PR_NUMBER || '0', 10)

// Available labels (must exist in GitHub repo)
const AVAILABLE_LABELS = {
  // Type labels
  'enhancement': { description: 'New feature or improvement', color: 'a2eeef' },
  'bug': { description: 'Something isn\'t working', color: 'd73a4a' },
  'breaking-change': { description: 'Introduces breaking changes', color: 'e99695' },
  'documentation': { description: 'Improvements or additions to docs', color: '0075ca' },
  'refactor': { description: 'Code restructuring without behavior change', color: 'cfd3d7' },
  'performance': { description: 'Performance improvements', color: 'f9d0c4' },
  'security': { description: 'Security-related changes', color: 'd73a4a' },
  'dependencies': { description: 'Dependency updates', color: '0366d6' },
  'ci': { description: 'CI/CD changes', color: 'fbca04' },
  'tests': { description: 'Test additions or improvements', color: 'bfd4f2' },

  // Size labels
  'size/xs': { description: '< 10 lines changed', color: 'c2e0c6' },
  'size/s': { description: '10-50 lines changed', color: 'e2f0d9' },
  'size/m': { description: '50-200 lines changed', color: 'fff5b1' },
  'size/l': { description: '200-500 lines changed', color: 'fef3c7' },
  'size/xl': { description: '> 500 lines changed', color: 'f8d7da' },

  // Area labels
  'area/api': { description: 'API routes changes', color: 'c5def5' },
  'area/ui': { description: 'UI/frontend changes', color: 'd4c5f9' },
  'area/database': { description: 'Database/migration changes', color: 'f9c513' },
  'area/integrations': { description: 'External integrations', color: 'fef2c0' },
  'area/auth': { description: 'Authentication changes', color: 'fbca04' },
  'area/i18n': { description: 'Internationalization changes', color: 'bfdadc' },

  // Priority labels
  'priority/high': { description: 'High priority', color: 'd93f0b' },
  'priority/low': { description: 'Low priority', color: 'c2e0c6' },

  // AI labels
  'ai-reviewed': { description: 'Reviewed by AI', color: '7057ff' },
  'ai-approved': { description: 'AI recommends merge', color: '0e8a16' },
  'ai-needs-review': { description: 'AI flagged concerns', color: 'fbca04' },
}

interface LabelSuggestion {
  label: string
  confidence: number // 0-100
  reason: string
}

interface LabelingResult {
  suggested: LabelSuggestion[]
  applied: string[]
  reasoning: string
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('🏷️  AI PR Auto-Labeler')
  console.log('='.repeat(50))
  console.log(`PR #${PR_NUMBER}: ${PR_TITLE}`)
  console.log('')

  // Initialize metrics
  initPRMetrics(PR_NUMBER, PR_TITLE)

  try {
    // Get PR diff stats
    const diffStats = getDiffStats()
    console.log(`📊 Changes: +${diffStats.additions} -${diffStats.deletions} (${diffStats.filesChanged} files)`)

    // Get changed files
    const changedFiles = getChangedFiles()
    console.log(`📁 Files: ${changedFiles.slice(0, 5).join(', ')}${changedFiles.length > 5 ? ` (+${changedFiles.length - 5} more)` : ''}`)

    // Analyze with AI
    console.log('\n🧠 Analyzing PR content...')
    const result = await analyzePR(diffStats, changedFiles)

    // Output results
    console.log('\n📋 Suggested Labels:')
    for (const suggestion of result.suggested) {
      const confidence = suggestion.confidence >= 80 ? '🟢' : suggestion.confidence >= 60 ? '🟡' : '🔴'
      console.log(`   ${confidence} ${suggestion.label} (${suggestion.confidence}%): ${suggestion.reason}`)
    }

    // Save results
    setSuggestedLabels(result.suggested.map(s => s.label))
    setAppliedLabels(result.applied)

    // Write output for CI
    const outputPath = 'ci-state/pr-labels.json'
    writeFileSync(outputPath, JSON.stringify(result, null, 2))
    console.log(`\n✅ Saved: ${outputPath}`)

    // Save metrics
    savePRMetrics()

    // Set GitHub Actions outputs
    if (process.env.GITHUB_OUTPUT) {
      const labels = result.suggested.filter(s => s.confidence >= 70).map(s => s.label)
      writeFileSync(
        process.env.GITHUB_OUTPUT,
        `labels=${labels.join(',')}\n`,
        { flag: 'a' }
      )
    }

  } catch (error) {
    console.error('❌ Labeling failed:', error)
    process.exit(1)
  }
}

// ============================================
// HELPERS
// ============================================

interface DiffStats {
  additions: number
  deletions: number
  filesChanged: number
}

function getDiffStats(): DiffStats {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--stat', `origin/${BASE_REF}...HEAD`],
      { encoding: 'utf-8' }
    )

    const lastLine = output.trim().split('\n').pop() || ''
    const filesMatch = lastLine.match(/(\d+)\s+files?\s+changed/)
    const addMatch = lastLine.match(/(\d+)\s+insertions?/)
    const delMatch = lastLine.match(/(\d+)\s+deletions?/)

    return {
      filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      additions: addMatch ? parseInt(addMatch[1], 10) : 0,
      deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
    }
  } catch {
    return { additions: 0, deletions: 0, filesChanged: 0 }
  }
}

function getChangedFiles(): string[] {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', `origin/${BASE_REF}...HEAD`],
      { encoding: 'utf-8' }
    )
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function getSizeLabel(stats: DiffStats): string {
  const total = stats.additions + stats.deletions
  if (total < 10) return 'size/xs'
  if (total < 50) return 'size/s'
  if (total < 200) return 'size/m'
  if (total < 500) return 'size/l'
  return 'size/xl'
}

function getAreaLabels(files: string[]): string[] {
  const areas = new Set<string>()

  for (const file of files) {
    if (file.startsWith('src/app/api/')) areas.add('area/api')
    if (file.startsWith('src/components/') || file.includes('.tsx')) areas.add('area/ui')
    if (file.startsWith('supabase/migrations/')) areas.add('area/database')
    if (file.includes('integrations/')) areas.add('area/integrations')
    if (file.includes('auth') || file.includes('login')) areas.add('area/auth')
    if (file.includes('i18n') || file.includes('translations/')) areas.add('area/i18n')
  }

  return Array.from(areas)
}

async function analyzePR(stats: DiffStats, files: string[]): Promise<LabelingResult> {
  const model = AI_MODELS.fast
  const startTime = Date.now()

  // Deterministic labels (no AI needed)
  const deterministicLabels: LabelSuggestion[] = []

  // Size label
  const sizeLabel = getSizeLabel(stats)
  deterministicLabels.push({
    label: sizeLabel,
    confidence: 100,
    reason: `${stats.additions + stats.deletions} lines changed`,
  })

  // Area labels
  const areaLabels = getAreaLabels(files)
  for (const area of areaLabels) {
    deterministicLabels.push({
      label: area,
      confidence: 95,
      reason: 'Based on changed file paths',
    })
  }

  // Check for dependency changes
  if (files.some(f => f === 'package.json' || f === 'package-lock.json')) {
    deterministicLabels.push({
      label: 'dependencies',
      confidence: 100,
      reason: 'package.json or package-lock.json modified',
    })
  }

  // Check for CI changes
  if (files.some(f => f.startsWith('.github/'))) {
    deterministicLabels.push({
      label: 'ci',
      confidence: 100,
      reason: 'GitHub workflow files modified',
    })
  }

  // Check for test changes
  if (files.some(f => f.includes('test') || f.includes('spec'))) {
    deterministicLabels.push({
      label: 'tests',
      confidence: 90,
      reason: 'Test files modified',
    })
  }

  // Check for migration changes
  if (files.some(f => f.includes('migrations/'))) {
    deterministicLabels.push({
      label: 'area/database',
      confidence: 100,
      reason: 'Database migrations modified',
    })
  }

  // AI analysis for type labels (enhancement, bug, breaking-change, etc.)
  const prompt = `You are analyzing a pull request to suggest appropriate labels.

## PR Information
- Title: ${PR_TITLE}
- Description: ${PR_BODY ? PR_BODY.slice(0, 1000) : '(no description)'}
- Files changed: ${files.slice(0, 20).join(', ')}${files.length > 20 ? ` (+${files.length - 20} more)` : ''}
- Lines: +${stats.additions} -${stats.deletions}

## Available Type Labels
- enhancement: New feature or improvement
- bug: Bug fix
- breaking-change: Introduces breaking changes
- documentation: Documentation updates
- refactor: Code restructuring without behavior change
- performance: Performance improvements
- security: Security-related changes

## Your Task
Based on the PR title, description, and changed files, suggest which TYPE labels apply.
Also assess if this seems high or low priority based on scope/impact.

## Response Format
Return a JSON object:
{
  "labels": [
    { "label": "enhancement", "confidence": 85, "reason": "Adds new feature X" }
  ],
  "is_breaking": false,
  "priority": "normal",
  "reasoning": "Brief explanation of your analysis"
}

Only return the JSON object.`

  try {
    const response = await withRetry(
      () => callOpenRouter(model, [{ role: 'user', content: prompt }], {
        temperature: 0,
        maxTokens: 1000,
      }),
      'PR labeling'
    )

    const durationMs = Date.now() - startTime

    // Estimate token usage (rough approximation since OpenRouter doesn't always return usage)
    const promptTokens = Math.ceil(prompt.length / 4)
    const completionTokens = Math.ceil(response.length / 4)
    const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }

    recordAPICall({
      model,
      operation: 'pr-labeling',
      tokens: usage,
      cost_usd: calculateCost(model, usage),
      duration_ms: durationMs,
      success: true,
    })

    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {
        suggested: deterministicLabels,
        applied: [],
        reasoning: 'AI analysis failed to return structured output',
      }
    }

    const aiResult = JSON.parse(jsonMatch[0]) as {
      labels: LabelSuggestion[]
      is_breaking: boolean
      priority: 'high' | 'normal' | 'low'
      reasoning: string
    }

    // Combine AI labels with deterministic labels
    const allLabels = [...deterministicLabels, ...aiResult.labels]

    // Add breaking change label if detected
    if (aiResult.is_breaking) {
      allLabels.push({
        label: 'breaking-change',
        confidence: 90,
        reason: 'AI detected breaking changes',
      })
    }

    // Add priority label if not normal
    if (aiResult.priority === 'high') {
      allLabels.push({
        label: 'priority/high',
        confidence: 75,
        reason: 'High impact change detected by AI',
      })
    } else if (aiResult.priority === 'low') {
      allLabels.push({
        label: 'priority/low',
        confidence: 75,
        reason: 'Low impact change detected by AI',
      })
    }

    // Deduplicate labels
    const uniqueLabels = allLabels.reduce((acc, label) => {
      const existing = acc.find(l => l.label === label.label)
      if (!existing || existing.confidence < label.confidence) {
        return [...acc.filter(l => l.label !== label.label), label]
      }
      return acc
    }, [] as LabelSuggestion[])

    // Sort by confidence
    uniqueLabels.sort((a, b) => b.confidence - a.confidence)

    return {
      suggested: uniqueLabels,
      applied: [], // Will be filled if we have GitHub token to apply labels
      reasoning: aiResult.reasoning,
    }

  } catch (error) {
    console.error('AI labeling failed:', error)
    return {
      suggested: deterministicLabels,
      applied: [],
      reasoning: `AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

// Run
main()
