/**
 * Dependency Graph Analyzer for Smart CI
 *
 * Analyzes TypeScript imports to build a dependency graph.
 * This helps determine the full impact of file changes.
 *
 * For example, if types.ts changes, we need to test all files that import it.
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'

// ============================================
// TYPES
// ============================================

export interface DependencyGraph {
  // Map from file path to files it imports
  imports: Map<string, Set<string>>
  // Map from file path to files that import it
  importedBy: Map<string, Set<string>>
  // Build timestamp
  builtAt: string
}

export interface ImpactAnalysis {
  // Files directly changed
  directlyChanged: string[]
  // Files that import changed files (first level)
  firstLevelDependents: string[]
  // All files that could be affected (transitive)
  allAffected: string[]
  // Suggested test scope based on impact
  suggestedScope: SuggestedScope
}

export interface SuggestedScope {
  visual: string[] // Pages/components to test visually
  e2e: string[] // E2E test files to run
  unit: string[] // Unit test files to run
  runFull: boolean // Whether to run full test suite
  reason: string // Why this scope was suggested
}

// ============================================
// CORE FILE CATEGORIES
// ============================================

/**
 * Core files that affect many other files
 * Changes to these should trigger broader testing
 */
export const CORE_FILES = new Set([
  'src/lib/types.ts',
  'src/lib/utils.ts',
  'src/lib/api-errors.ts', // Error handling patterns affect all API routes
  'src/lib/supabase/client.ts',
  'src/lib/supabase/server.ts',
  'src/lib/supabase/middleware.ts',
  'src/lib/i18n/context.tsx',
  'src/lib/i18n/types.ts',
  'src/components/Header.tsx',
  'src/components/AppShell.tsx',
  'src/proxy.ts', // Next.js 16 auth proxy - changes affect all protected routes
])

/**
 * Map component files to their visual test pages
 */
export const COMPONENT_TO_PAGE: Record<string, string[]> = {
  'src/components/WeekGrid.tsx': ['week'],
  'src/components/WeekSection.tsx': ['home', 'week'],
  'src/components/TodaySection.tsx': ['home'],
  'src/components/TodayOverview.tsx': ['home'],
  'src/components/DayView.tsx': ['home', 'week'],
  'src/components/MealSelector.tsx': ['week'],
  'src/components/AISuggestionModal.tsx': ['week'],
  'src/components/WishlistSection.tsx': ['wishlist', 'settings'],
  'src/components/Header.tsx': ['all'],
  'src/components/AppShell.tsx': ['all'],
}

/**
 * Map component directories to e2e test files
 */
export const COMPONENT_TO_E2E: Record<string, string[]> = {
  'src/components/integrations': ['tests/e2e/integrations.spec.ts'],
  'src/app/api': ['tests/e2e/api.spec.ts'],
  'src/lib/demo': ['tests/e2e/demo.spec.ts'],
}

// ============================================
// DEPENDENCY GRAPH BUILDING
// ============================================

/**
 * Build dependency graph for the project
 * Uses TypeScript's import resolution
 */
export function buildDependencyGraph(rootDir: string = '.'): DependencyGraph {
  const imports = new Map<string, Set<string>>()
  const importedBy = new Map<string, Set<string>>()

  // Find all TypeScript files
  const tsFiles = findAllTsFiles(join(rootDir, 'src'))

  for (const file of tsFiles) {
    const fileImports = extractImports(file, rootDir)
    imports.set(file, fileImports)

    // Build reverse mapping
    for (const importedFile of fileImports) {
      if (!importedBy.has(importedFile)) {
        importedBy.set(importedFile, new Set())
      }
      importedBy.get(importedFile)!.add(file)
    }
  }

  return {
    imports,
    importedBy,
    builtAt: new Date().toISOString(),
  }
}

/**
 * Find all TypeScript files in a directory
 */
function findAllTsFiles(dir: string): string[] {
  const files: string[] = []

  if (!existsSync(dir)) return files

  try {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        files.push(...findAllTsFiles(fullPath))
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        files.push(fullPath)
      }
    }
  } catch {
    // Ignore permission errors
  }

  return files
}

/**
 * Extract imports from a TypeScript file
 */
function extractImports(filePath: string, rootDir: string): Set<string> {
  const imports = new Set<string>()

  try {
    const content = readFileSync(filePath, 'utf-8')
    const fileDir = dirname(filePath)

    // Match import statements
    const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g
    let match

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1]
      const resolvedPath = resolveImport(importPath, fileDir, rootDir)

      if (resolvedPath) {
        imports.add(resolvedPath)
      }
    }
  } catch {
    // Ignore read errors
  }

  return imports
}

/**
 * Resolve an import path to an actual file
 */
function resolveImport(importPath: string, fromDir: string, rootDir: string): string | null {
  // Skip node_modules imports
  if (!importPath.startsWith('.') && !importPath.startsWith('@/')) {
    return null
  }

  let targetPath: string

  if (importPath.startsWith('@/')) {
    // Resolve @/ alias to src/
    targetPath = join(rootDir, 'src', importPath.slice(2))
  } else {
    // Relative import
    targetPath = resolve(fromDir, importPath)
  }

  // Try common extensions
  const extensions = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

  for (const ext of extensions) {
    const fullPath = targetPath + ext
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      return relative(rootDir, fullPath)
    }
  }

  return null
}

// ============================================
// IMPACT ANALYSIS
// ============================================

/**
 * Analyze the impact of changed files
 */
export function analyzeImpact(changedFiles: string[], graph: DependencyGraph): ImpactAnalysis {
  const directlyChanged = changedFiles
  const firstLevelDependents: Set<string> = new Set()
  const allAffected: Set<string> = new Set(changedFiles)

  // Get first-level dependents
  for (const file of changedFiles) {
    const dependents = graph.importedBy.get(file)
    if (dependents) {
      for (const dep of dependents) {
        firstLevelDependents.add(dep)
        allAffected.add(dep)
      }
    }
  }

  // Get transitive dependents (up to 3 levels to avoid explosion)
  let currentLevel = new Set(firstLevelDependents)
  for (let level = 0; level < 3; level++) {
    const nextLevel: Set<string> = new Set()

    for (const file of currentLevel) {
      const dependents = graph.importedBy.get(file)
      if (dependents) {
        for (const dep of dependents) {
          if (!allAffected.has(dep)) {
            nextLevel.add(dep)
            allAffected.add(dep)
          }
        }
      }
    }

    if (nextLevel.size === 0) break
    currentLevel = nextLevel
  }

  // Determine suggested scope
  const suggestedScope = determineSuggestedScope(changedFiles, [...allAffected])

  return {
    directlyChanged,
    firstLevelDependents: [...firstLevelDependents],
    allAffected: [...allAffected],
    suggestedScope,
  }
}

/**
 * Determine suggested test scope based on impact
 */
function determineSuggestedScope(changedFiles: string[], allAffected: string[]): SuggestedScope {
  // Check for core file changes
  const coreFileChanged = changedFiles.some(f => CORE_FILES.has(f))

  if (coreFileChanged) {
    return {
      visual: ['all'],
      e2e: ['all'],
      unit: ['all'],
      runFull: true,
      reason: 'Core file changed - running full test suite',
    }
  }

  // Determine visual pages to test
  const visualPages = new Set<string>()
  for (const file of allAffected) {
    const pages = COMPONENT_TO_PAGE[file]
    if (pages) {
      pages.forEach(p => visualPages.add(p))
    }
  }

  // Determine e2e tests to run
  const e2eTests = new Set<string>()
  for (const file of allAffected) {
    for (const [pattern, tests] of Object.entries(COMPONENT_TO_E2E)) {
      if (file.startsWith(pattern)) {
        tests.forEach(t => e2eTests.add(t))
      }
    }
  }

  // Determine unit tests to run
  const unitTests = new Set<string>()
  for (const file of allAffected) {
    // Find corresponding test file
    const testFile = file
      .replace('/src/', '/tests/')
      .replace('.ts', '.test.ts')
      .replace('.tsx', '.test.tsx')

    if (existsSync(testFile)) {
      unitTests.add(testFile)
    }
  }

  // If too many affected files, run full
  if (allAffected.length > 50) {
    return {
      visual: ['all'],
      e2e: ['all'],
      unit: ['all'],
      runFull: true,
      reason: `Large impact (${allAffected.length} files affected) - running full suite`,
    }
  }

  return {
    visual: [...visualPages],
    e2e: [...e2eTests],
    unit: [...unitTests],
    runFull: false,
    reason: `Scoped to ${visualPages.size} pages, ${e2eTests.size} e2e tests, ${unitTests.size} unit tests`,
  }
}

// ============================================
// QUICK CHECKS (without full graph)
// ============================================

/**
 * Quick check if files affect specific areas
 */
export function quickImpactCheck(changedFiles: string[]): {
  affectsMigrations: boolean
  affectsComponents: boolean
  affectsApi: boolean
  affectsTypes: boolean
  affectsTests: boolean
  affectsConfig: boolean
  affectsDocs: boolean
  coreFileChanged: boolean
} {
  const result = {
    affectsMigrations: false,
    affectsComponents: false,
    affectsApi: false,
    affectsTypes: false,
    affectsTests: false,
    affectsConfig: false,
    affectsDocs: false,
    coreFileChanged: false,
  }

  for (const file of changedFiles) {
    if (file.includes('supabase/migrations/')) result.affectsMigrations = true
    if (file.includes('src/components/')) result.affectsComponents = true
    if (file.includes('src/app/api/')) result.affectsApi = true
    if (file.includes('/types') || file.endsWith('types.ts')) result.affectsTypes = true
    if (file.includes('/tests/') || file.endsWith('.test.ts')) result.affectsTests = true
    if (
      file.endsWith('.json') ||
      file.includes('config') ||
      file === 'next.config.ts' ||
      file === 'tailwind.config.ts'
    )
      result.affectsConfig = true
    if (file.endsWith('.md')) result.affectsDocs = true
    if (CORE_FILES.has(file)) result.coreFileChanged = true
  }

  return result
}

/**
 * Get a simple categorization of changed files
 */
export function categorizeChanges(changedFiles: string[]): {
  migrations: string[]
  components: string[]
  pages: string[]
  api: string[]
  lib: string[]
  hooks: string[]
  tests: string[]
  config: string[]
  docs: string[]
  scripts: string[]
  other: string[]
} {
  const result: Record<string, string[]> = {
    migrations: [],
    components: [],
    pages: [],
    api: [],
    lib: [],
    hooks: [],
    tests: [],
    config: [],
    docs: [],
    scripts: [],
    other: [],
  }

  for (const file of changedFiles) {
    if (file.includes('supabase/migrations/')) {
      result.migrations.push(file)
    } else if (file.includes('src/components/')) {
      result.components.push(file)
    } else if (file.includes('src/app/api/')) {
      result.api.push(file)
    } else if (file.includes('src/app/') && (file.endsWith('page.tsx') || file.endsWith('layout.tsx'))) {
      result.pages.push(file)
    } else if (file.includes('src/lib/')) {
      result.lib.push(file)
    } else if (file.includes('src/hooks/')) {
      result.hooks.push(file)
    } else if (file.startsWith('tests/') || file.includes('/tests/') || file.endsWith('.test.ts') || file.endsWith('.spec.ts')) {
      result.tests.push(file)
    } else if (file.endsWith('.json') || file.includes('config') || file.endsWith('.config.ts')) {
      result.config.push(file)
    } else if (file.endsWith('.md')) {
      result.docs.push(file)
    } else if (file.startsWith('scripts/')) {
      result.scripts.push(file)
    } else {
      result.other.push(file)
    }
  }

  return result as {
    migrations: string[]
    components: string[]
    pages: string[]
    api: string[]
    lib: string[]
    hooks: string[]
    tests: string[]
    config: string[]
    docs: string[]
    scripts: string[]
    other: string[]
  }
}
