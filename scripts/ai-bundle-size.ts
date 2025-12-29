/**
 * AI-Powered Bundle Size Analysis
 *
 * Tracks bundle sizes and uses AI to analyze changes,
 * identify bloat, and suggest optimizations.
 *
 * Usage: npx tsx scripts/ai-bundle-size.ts
 */

import { execFileSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
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

const BUNDLE_DIR = '.next'
const STATS_DIR = 'ci-state'
const STATS_FILE = 'bundle-stats.json'

// Size thresholds (in bytes)
const THRESHOLDS = {
  totalBudget: 500 * 1024,       // 500KB total JS budget
  chunkBudget: 100 * 1024,       // 100KB per chunk
  increaseWarning: 10 * 1024,    // 10KB increase triggers warning
  increaseCritical: 50 * 1024,   // 50KB increase triggers critical
}

interface BundleStats {
  timestamp: string
  totalSize: number
  gzipSize: number
  chunks: ChunkInfo[]
  packages: PackageSize[]
}

interface ChunkInfo {
  name: string
  size: number
  gzipSize: number
}

interface PackageSize {
  name: string
  size: number
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('📦 AI Bundle Size Analysis')
  console.log('='.repeat(50))
  console.log('')

  const startTime = Date.now()
  ensureReviewsDir()

  try {
    // Check if build exists
    if (!existsSync(BUNDLE_DIR)) {
      console.log('⏭️ No build found (.next directory missing)')
      console.log('   Run "npm run build" first or let Vercel handle the build.')
      const output: ReviewerOutput = {
        reviewer: 'bundle-size' as any,
        model: 'none',
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        status: 'skipped',
        verdict: 'PASS',
        confidence: 100,
        findings: [],
        summary: 'Bundle analysis skipped - no build found. Vercel will build and deploy.',
      }
      saveReviewerOutput(output)
      return
    }

    // Analyze current bundle
    console.log('🔍 Analyzing bundle...')
    const currentStats = analyzeBuild()
    console.log(`   Total JS: ${formatBytes(currentStats.totalSize)}`)
    console.log(`   Gzipped: ${formatBytes(currentStats.gzipSize)}`)
    console.log(`   Chunks: ${currentStats.chunks.length}`)

    // Load previous stats for comparison
    const previousStats = loadPreviousStats()
    const comparison = previousStats ? compareStats(previousStats, currentStats) : null

    if (comparison) {
      console.log(`\n📊 Compared to previous build:`)
      console.log(`   Size change: ${comparison.sizeChange >= 0 ? '+' : ''}${formatBytes(comparison.sizeChange)}`)
    }

    // Generate findings
    const findings: Finding[] = []

    // Check total budget
    if (currentStats.totalSize > THRESHOLDS.totalBudget) {
      findings.push({
        severity: 'warning',
        category: 'performance',
        message: `Total JS bundle (${formatBytes(currentStats.totalSize)}) exceeds budget of ${formatBytes(THRESHOLDS.totalBudget)}.`,
      })
    }

    // Check for large chunks
    const largeChunks = currentStats.chunks.filter(c => c.size > THRESHOLDS.chunkBudget)
    for (const chunk of largeChunks) {
      findings.push({
        severity: 'warning',
        category: 'performance',
        message: `Chunk "${chunk.name}" (${formatBytes(chunk.size)}) exceeds ${formatBytes(THRESHOLDS.chunkBudget)} budget.`,
      })
    }

    // Check size increase
    if (comparison) {
      if (comparison.sizeChange > THRESHOLDS.increaseCritical) {
        findings.push({
          severity: 'critical',
          category: 'performance',
          message: `Bundle size increased by ${formatBytes(comparison.sizeChange)} (>${formatBytes(THRESHOLDS.increaseCritical)}). This may impact performance.`,
        })
      } else if (comparison.sizeChange > THRESHOLDS.increaseWarning) {
        findings.push({
          severity: 'warning',
          category: 'performance',
          message: `Bundle size increased by ${formatBytes(comparison.sizeChange)}.`,
        })
      }

      // Report new large packages
      for (const pkg of comparison.newPackages) {
        if (pkg.size > 10 * 1024) {
          findings.push({
            severity: 'info',
            category: 'performance',
            message: `New dependency "${pkg.name}" adds ${formatBytes(pkg.size)} to bundle.`,
          })
        }
      }
    }

    // AI analysis for optimization suggestions
    if (currentStats.totalSize > THRESHOLDS.totalBudget * 0.8 || findings.length > 0) {
      console.log('\n🧠 Running AI optimization analysis...')
      const aiFindings = await runAIAnalysis(currentStats, comparison)
      findings.push(...aiFindings)
    }

    // Save current stats for future comparison
    saveCurrentStats(currentStats)

    // Determine verdict
    const criticalCount = findings.filter(f => f.severity === 'critical').length
    const warningCount = findings.filter(f => f.severity === 'warning').length
    const verdict = criticalCount > 0 ? 'FAIL' : warningCount > 0 ? 'WARN' : 'PASS'

    const output: ReviewerOutput = {
      reviewer: 'bundle-size' as any,
      model: findings.some(f => f.message.includes('Consider')) ? AI_MODELS.fast : 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'completed',
      verdict,
      confidence: 85,
      findings,
      summary: generateSummary(currentStats, comparison, findings),
      raw: { currentStats, comparison },
    }

    saveReviewerOutput(output)

    console.log(`\n${verdict === 'PASS' ? '✅' : verdict === 'WARN' ? '⚠️' : '❌'} Verdict: ${verdict}`)

  } catch (error) {
    console.error('❌ Bundle analysis failed:', error)
    const output: ReviewerOutput = {
      reviewer: 'bundle-size' as any,
      model: 'none',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'failed',
      verdict: 'ERROR',
      confidence: 0,
      findings: [{
        severity: 'critical',
        category: 'performance',
        message: `Bundle analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      summary: 'Bundle analysis encountered an error.',
    }
    saveReviewerOutput(output)
  }
}

// ============================================
// ANALYSIS HELPERS
// ============================================

function analyzeBuild(): BundleStats {
  const chunks: ChunkInfo[] = []
  let totalSize = 0
  let gzipSize = 0

  // Parse Next.js build manifest
  const buildManifestPath = join(BUNDLE_DIR, 'build-manifest.json')
  if (existsSync(buildManifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(buildManifestPath, 'utf-8'))
      // Collect all JS files from pages
      const jsFiles = new Set<string>()
      for (const page of Object.values(manifest.pages || {})) {
        for (const file of page as string[]) {
          if (file.endsWith('.js')) {
            jsFiles.add(file)
          }
        }
      }

      // Get sizes for each chunk
      for (const file of jsFiles) {
        const filePath = join(BUNDLE_DIR, 'static', file.replace('static/', ''))
        if (existsSync(filePath)) {
          const content = readFileSync(filePath)
          const size = content.length
          totalSize += size
          // Estimate gzip (roughly 30% of original)
          const estimatedGzip = Math.round(size * 0.3)
          gzipSize += estimatedGzip
          chunks.push({
            name: file.split('/').pop() || file,
            size,
            gzipSize: estimatedGzip,
          })
        }
      }
    } catch (e) {
      console.warn('Could not parse build manifest:', e)
    }
  }

  // Fallback: use du to get total size
  if (totalSize === 0) {
    try {
      const duOutput = execFileSync('du', ['-sk', join(BUNDLE_DIR, 'static', 'chunks')], {
        encoding: 'utf-8',
      })
      const match = duOutput.match(/^(\d+)/)
      if (match) {
        totalSize = parseInt(match[1], 10) * 1024
        gzipSize = Math.round(totalSize * 0.3)
      }
    } catch {
      // Ignore
    }
  }

  // Analyze package sizes from node_modules (if @next/bundle-analyzer data exists)
  const packages: PackageSize[] = []

  return {
    timestamp: new Date().toISOString(),
    totalSize,
    gzipSize,
    chunks: chunks.sort((a, b) => b.size - a.size).slice(0, 20),
    packages,
  }
}

function loadPreviousStats(): BundleStats | null {
  const statsPath = join(STATS_DIR, STATS_FILE)
  if (!existsSync(statsPath)) return null

  try {
    return JSON.parse(readFileSync(statsPath, 'utf-8'))
  } catch {
    return null
  }
}

function saveCurrentStats(stats: BundleStats): void {
  if (!existsSync(STATS_DIR)) {
    mkdirSync(STATS_DIR, { recursive: true })
  }
  writeFileSync(join(STATS_DIR, STATS_FILE), JSON.stringify(stats, null, 2))
  console.log(`📄 Saved: ${join(STATS_DIR, STATS_FILE)}`)
}

interface StatsComparison {
  sizeChange: number
  gzipChange: number
  newChunks: ChunkInfo[]
  removedChunks: ChunkInfo[]
  grownChunks: { name: string; change: number }[]
  newPackages: PackageSize[]
}

function compareStats(previous: BundleStats, current: BundleStats): StatsComparison {
  const prevChunkNames = new Set(previous.chunks.map(c => c.name))
  const currChunkNames = new Set(current.chunks.map(c => c.name))

  const newChunks = current.chunks.filter(c => !prevChunkNames.has(c.name))
  const removedChunks = previous.chunks.filter(c => !currChunkNames.has(c.name))

  const grownChunks: { name: string; change: number }[] = []
  for (const curr of current.chunks) {
    const prev = previous.chunks.find(p => p.name === curr.name)
    if (prev && curr.size > prev.size + 1024) { // >1KB growth
      grownChunks.push({ name: curr.name, change: curr.size - prev.size })
    }
  }

  const prevPkgNames = new Set(previous.packages.map(p => p.name))
  const newPackages = current.packages.filter(p => !prevPkgNames.has(p.name))

  return {
    sizeChange: current.totalSize - previous.totalSize,
    gzipChange: current.gzipSize - previous.gzipSize,
    newChunks,
    removedChunks,
    grownChunks,
    newPackages,
  }
}

// ============================================
// AI ANALYSIS
// ============================================

async function runAIAnalysis(
  stats: BundleStats,
  comparison: StatsComparison | null
): Promise<Finding[]> {
  const model = AI_MODELS.fast

  const prompt = `You are a frontend performance expert analyzing a Next.js bundle.

## Current Bundle Stats
- Total JS size: ${formatBytes(stats.totalSize)}
- Gzipped size: ${formatBytes(stats.gzipSize)}
- Number of chunks: ${stats.chunks.length}

## Largest Chunks
${stats.chunks.slice(0, 10).map(c => `- ${c.name}: ${formatBytes(c.size)}`).join('\n')}

${comparison ? `
## Changes from Previous Build
- Size change: ${comparison.sizeChange >= 0 ? '+' : ''}${formatBytes(comparison.sizeChange)}
- New chunks: ${comparison.newChunks.length}
- Removed chunks: ${comparison.removedChunks.length}
${comparison.grownChunks.length > 0 ? `- Grown chunks:\n${comparison.grownChunks.map(c => `  - ${c.name}: +${formatBytes(c.change)}`).join('\n')}` : ''}
` : ''}

## Your Task
Suggest optimizations to reduce bundle size. Consider:
1. Code splitting opportunities
2. Dynamic imports for heavy components
3. Tree shaking improvements
4. Dependency alternatives (smaller libraries)
5. Unused code removal

## Response Format
Return a JSON array of findings. Each finding should be actionable:
- severity: "warning" | "info"
- category: "performance"
- message: Specific, actionable optimization suggestion

Example:
[
  {
    "severity": "info",
    "category": "performance",
    "message": "Consider using dynamic import for heavy chart components to reduce initial bundle size."
  }
]

Return [] if no obvious optimizations are available. Only return the JSON array.`

  try {
    const response = await withRetry(
      () => callOpenRouter(model, [{ role: 'user', content: prompt }], {
        temperature: 0,
        maxTokens: 2000,
      }),
      'AI bundle analysis'
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
      category: 'performance' as const,
      message: f.message,
    }))

  } catch (error) {
    console.error('AI analysis failed:', error)
    return []
  }
}

// ============================================
// UTILITIES
// ============================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function generateSummary(
  stats: BundleStats,
  comparison: StatsComparison | null,
  findings: Finding[]
): string {
  const critical = findings.filter(f => f.severity === 'critical').length
  const warning = findings.filter(f => f.severity === 'warning').length

  let summary = `Bundle: ${formatBytes(stats.totalSize)} (${formatBytes(stats.gzipSize)} gzipped)`

  if (comparison) {
    const sign = comparison.sizeChange >= 0 ? '+' : ''
    summary += ` | Change: ${sign}${formatBytes(comparison.sizeChange)}`
  }

  if (critical > 0) {
    summary = `🚨 ${summary} - ${critical} critical issue(s) found`
  } else if (warning > 0) {
    summary = `⚠️ ${summary} - ${warning} optimization suggestion(s)`
  } else {
    summary = `✅ ${summary} - within budget`
  }

  return summary
}

// Run
main()
