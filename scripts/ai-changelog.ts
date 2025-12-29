/**
 * AI-Powered Changelog Generation
 *
 * Generates release notes from commits using AI to understand
 * the changes and create user-friendly descriptions.
 *
 * Usage: npx tsx scripts/ai-changelog.ts [--since tag] [--until tag]
 */

import { execFileSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { AI_MODELS, callOpenRouter, withRetry } from './ai-config'

// ============================================
// CONFIGURATION
// ============================================

const SINCE = process.argv.includes('--since')
  ? process.argv[process.argv.indexOf('--since') + 1]
  : getLastTag()

const UNTIL = process.argv.includes('--until')
  ? process.argv[process.argv.indexOf('--until') + 1]
  : 'HEAD'

const OUTPUT_FILE = 'CHANGELOG-GENERATED.md'

// Conventional commit categories
const CATEGORIES = {
  feat: { title: '✨ New Features', priority: 1 },
  fix: { title: '🐛 Bug Fixes', priority: 2 },
  perf: { title: '⚡ Performance Improvements', priority: 3 },
  refactor: { title: '♻️ Refactoring', priority: 4 },
  docs: { title: '📝 Documentation', priority: 5 },
  test: { title: '🧪 Tests', priority: 6 },
  chore: { title: '🔧 Maintenance', priority: 7 },
  ci: { title: '🤖 CI/CD', priority: 8 },
  style: { title: '💄 Styling', priority: 9 },
}

interface Commit {
  hash: string
  message: string
  author: string
  date: string
  body?: string
  category?: string
  scope?: string
  breaking?: boolean
}

interface ChangelogSection {
  category: string
  title: string
  changes: string[]
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('📝 AI Changelog Generation')
  console.log('='.repeat(50))
  console.log(`From: ${SINCE || 'beginning'}`)
  console.log(`To: ${UNTIL}`)
  console.log('')

  try {
    // Get commits
    console.log('🔍 Fetching commits...')
    const commits = getCommits()
    console.log(`   Found ${commits.length} commits`)

    if (commits.length === 0) {
      console.log('📝 No commits to generate changelog from')
      return
    }

    // Parse commits
    console.log('🔍 Parsing commit messages...')
    const parsedCommits = commits.map(parseCommit)

    // Group by category
    const categorized = categorizeCommits(parsedCommits)

    // AI enhancement
    console.log('🧠 Enhancing with AI...')
    const enhanced = await enhanceWithAI(parsedCommits, categorized)

    // Generate markdown
    console.log('📄 Generating changelog...')
    const changelog = generateMarkdown(enhanced, parsedCommits)

    // Write output
    writeFileSync(OUTPUT_FILE, changelog)
    console.log(`\n✅ Generated: ${OUTPUT_FILE}`)

    // Print preview
    console.log('\n--- Preview ---')
    console.log(changelog.slice(0, 1000) + (changelog.length > 1000 ? '\n...' : ''))

  } catch (error) {
    console.error('❌ Changelog generation failed:', error)
    process.exit(1)
  }
}

// ============================================
// HELPERS
// ============================================

function getLastTag(): string {
  try {
    const output = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      encoding: 'utf-8',
    })
    return output.trim()
  } catch {
    return ''
  }
}

function getCommits(): Commit[] {
  const range = SINCE ? `${SINCE}..${UNTIL}` : UNTIL

  try {
    const format = '%H|%s|%an|%aI|%b'
    const args = ['log', '--format=' + format, '--no-merges']
    if (SINCE) {
      args.push(`${SINCE}..${UNTIL}`)
    } else {
      args.push(UNTIL, '-50') // Limit to 50 commits if no tag
    }

    const output = execFileSync('git', args, {
      encoding: 'utf-8',
    })

    return output.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('|')
      return {
        hash: parts[0] || '',
        message: parts[1] || '',
        author: parts[2] || '',
        date: parts[3] || '',
        body: parts.slice(4).join('|').trim() || undefined,
      }
    })
  } catch (error) {
    console.error('Error getting commits:', error)
    return []
  }
}

function parseCommit(commit: Commit): Commit {
  // Parse conventional commit format: type(scope): message
  const conventionalMatch = commit.message.match(
    /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(([^)]+)\))?(!)?:\s*(.+)$/
  )

  if (conventionalMatch) {
    return {
      ...commit,
      category: conventionalMatch[1],
      scope: conventionalMatch[3],
      breaking: Boolean(conventionalMatch[4]),
      message: conventionalMatch[5],
    }
  }

  // Try to infer category from message
  const inferredCategory = inferCategory(commit.message)
  return {
    ...commit,
    category: inferredCategory,
  }
}

function inferCategory(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('add') || lower.includes('new') || lower.includes('feature')) return 'feat'
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('issue')) return 'fix'
  if (lower.includes('refactor') || lower.includes('clean')) return 'refactor'
  if (lower.includes('test')) return 'test'
  if (lower.includes('doc') || lower.includes('readme')) return 'docs'
  if (lower.includes('style') || lower.includes('format')) return 'style'
  if (lower.includes('perf') || lower.includes('optim')) return 'perf'
  if (lower.includes('ci') || lower.includes('workflow') || lower.includes('action')) return 'ci'
  return 'chore'
}

function categorizeCommits(commits: Commit[]): Map<string, Commit[]> {
  const categories = new Map<string, Commit[]>()

  for (const commit of commits) {
    const cat = commit.category || 'chore'
    if (!categories.has(cat)) {
      categories.set(cat, [])
    }
    categories.get(cat)!.push(commit)
  }

  return categories
}

async function enhanceWithAI(
  commits: Commit[],
  categorized: Map<string, Commit[]>
): Promise<ChangelogSection[]> {
  const model = AI_MODELS.fast

  // Prepare commit list for AI
  const commitList = commits.slice(0, 30).map(c => {
    const scope = c.scope ? `(${c.scope})` : ''
    const breaking = c.breaking ? ' [BREAKING]' : ''
    return `- ${c.category || 'chore'}${scope}: ${c.message}${breaking}`
  }).join('\n')

  const prompt = `You are writing release notes for "Familjen", a Norwegian family planning app.

## Commits
${commitList}
${commits.length > 30 ? `\n... and ${commits.length - 30} more commits` : ''}

## Your Task
Transform these commits into user-friendly release notes. Guidelines:
1. Group changes logically (not just by type)
2. Use clear, non-technical language when possible
3. Highlight breaking changes prominently
4. Mention new features first
5. Combine related fixes into single bullet points
6. Skip purely internal changes (CI, minor refactors) unless significant

## Response Format
Return a JSON object with sections array:
{
  "sections": [
    {
      "title": "✨ New Features",
      "changes": [
        "Added ability to sync with Spond sports groups",
        "New meal suggestion AI that considers allergies"
      ]
    },
    {
      "title": "🐛 Bug Fixes",
      "changes": [
        "Fixed calendar sync not updating properly",
        "Resolved issue with Norwegian characters in names"
      ]
    }
  ],
  "highlights": "Brief 1-2 sentence summary of the most important changes",
  "breaking": ["List of breaking changes if any"]
}

Only return the JSON object.`

  try {
    const response = await withRetry(
      () => callOpenRouter(model, [{ role: 'user', content: prompt }], {
        temperature: 0.3,
        maxTokens: 3000,
      }),
      'AI changelog enhancement'
    )

    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return fallbackSections(categorized)
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      sections: ChangelogSection[]
      highlights?: string
      breaking?: string[]
    }

    // Add breaking changes section if needed
    if (parsed.breaking && parsed.breaking.length > 0) {
      parsed.sections.unshift({
        category: 'breaking',
        title: '⚠️ Breaking Changes',
        changes: parsed.breaking,
      })
    }

    return parsed.sections

  } catch (error) {
    console.error('AI enhancement failed:', error)
    return fallbackSections(categorized)
  }
}

function fallbackSections(categorized: Map<string, Commit[]>): ChangelogSection[] {
  const sections: ChangelogSection[] = []

  // Sort categories by priority
  const sortedCategories = [...categorized.entries()]
    .sort((a, b) => {
      const aPriority = CATEGORIES[a[0] as keyof typeof CATEGORIES]?.priority || 99
      const bPriority = CATEGORIES[b[0] as keyof typeof CATEGORIES]?.priority || 99
      return aPriority - bPriority
    })

  for (const [cat, commits] of sortedCategories) {
    const catInfo = CATEGORIES[cat as keyof typeof CATEGORIES]
    sections.push({
      category: cat,
      title: catInfo?.title || `📦 ${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
      changes: commits.map(c => {
        const scope = c.scope ? `**${c.scope}**: ` : ''
        return `${scope}${c.message}`
      }),
    })
  }

  return sections
}

function generateMarkdown(sections: ChangelogSection[], commits: Commit[]): string {
  const date = new Date().toISOString().split('T')[0]
  const version = getNextVersion()

  let md = `# Changelog

## [${version}] - ${date}

`

  for (const section of sections) {
    if (section.changes.length === 0) continue

    md += `### ${section.title}\n\n`
    for (const change of section.changes) {
      md += `- ${change}\n`
    }
    md += '\n'
  }

  // Add contributors
  const authors = [...new Set(commits.map(c => c.author))]
  if (authors.length > 0) {
    md += `### 👥 Contributors\n\n`
    for (const author of authors) {
      md += `- ${author}\n`
    }
    md += '\n'
  }

  // Add full commit list (collapsed)
  md += `<details>\n<summary>📋 Full Commit List (${commits.length} commits)</summary>\n\n`
  for (const commit of commits) {
    const shortHash = commit.hash.slice(0, 7)
    md += `- \`${shortHash}\` ${commit.message}\n`
  }
  md += `\n</details>\n`

  return md
}

function getNextVersion(): string {
  try {
    // Get current version from package.json
    if (existsSync('package.json')) {
      const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
      return pkg.version || 'Unreleased'
    }
  } catch {
    // Ignore
  }

  // Try git tags
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      encoding: 'utf-8',
    }).trim()
    // Increment patch version
    const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)/)
    if (match) {
      return `${match[1]}.${match[2]}.${parseInt(match[3]) + 1}`
    }
    return tag
  } catch {
    return 'Unreleased'
  }
}

// Run
main()
