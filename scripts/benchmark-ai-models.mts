#!/usr/bin/env npx tsx
/**
 * AI Model Benchmark Script
 *
 * Tests different AI models for the app's two main AI tasks:
 * 1. parse-reminders - Parse Norwegian natural language into structured reminders
 * 2. suggest - Generate meal suggestions
 *
 * Run: npx tsx --env-file=.env.local scripts/benchmark-ai-models.ts
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

if (!OPENROUTER_API_KEY) {
  console.error('Error: OPENROUTER_API_KEY not found in .env.local')
  process.exit(1)
}

// Models to benchmark
const MODELS = {
  // Fast/cheap models
  'gpt-5-nano': 'openai/gpt-5-nano',
  'gpt-5-mini': 'openai/gpt-5-mini',
  'haiku-4.5': 'anthropic/claude-haiku-4.5',
  'gemini-2.5-flash-lite': 'google/gemini-2.5-flash-lite',
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  // Strong models
  'gpt-5.2': 'openai/gpt-5.2',
  'sonnet-4.5': 'anthropic/claude-sonnet-4.5',
  'gemini-2.5-pro': 'google/gemini-2.5-pro',
}

// Pricing per 1M tokens (for cost calculation)
const PRICING: Record<string, { input: number; output: number }> = {
  'openai/gpt-5-nano': { input: 0.05, output: 0.40 },
  'openai/gpt-5-mini': { input: 0.25, output: 2.00 },
  'anthropic/claude-haiku-4.5': { input: 1.00, output: 5.00 },
  'google/gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'openai/gpt-5.2': { input: 1.75, output: 14.00 },
  'anthropic/claude-sonnet-4.5': { input: 3.00, output: 15.00 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10.00 },
}

// Test cases for parse-reminders
const PARSE_TEST_CASES = [
  {
    name: 'Simple reminder',
    input: 'Storm logoped i morgen kl 16',
    children: [{ name: 'Storm', id: 'child-1' }, { name: 'Ylva', id: 'child-2' }],
    expected: {
      title_contains: 'logoped',
      child_name: 'Storm',
      has_time: true,
      task_type: 'appointment',
    },
  },
  {
    name: 'Multiple reminders',
    input: 'Ylva skal ha med gymtøy på mandag, Storm har tannlege tirsdag kl 10',
    children: [{ name: 'Storm', id: 'child-1' }, { name: 'Ylva', id: 'child-2' }],
    expected: {
      count: 2,
      has_bring: true,
      has_appointment: true,
    },
  },
  {
    name: 'Closure/planleggingsdag',
    input: 'Barnehagen har planleggingsdag på fredag',
    children: [{ name: 'Storm', id: 'child-1' }],
    expected: {
      task_type: 'closure',
      title_contains: 'planleggingsdag',
    },
  },
]

// Test case for meal suggestions
const SUGGEST_TEST_CASE = {
  name: 'Week meal suggestions',
  days: ['2025-12-18', '2025-12-19'],
  children: [{ name: 'Storm', age: 4, allergies: [] }, { name: 'Ylva', age: 7, allergies: ['nøtter'] }],
  recentMeals: ['Taco', 'Pasta bolognese', 'Fish fingers'],
  expected: {
    has_suggestions: true,
    valid_json: true,
    avoids_nuts: true,
  },
}

// System prompts (matching the app)
const PARSE_SYSTEM_PROMPT = (today: string, childContext: string) => `Du er en hjelpsom assistent som tolker norske påminnelser for en familieplanleggingsapp.

Din oppgave er å analysere naturlig norsk tekst og trekke ut strukturert informasjon om påminnelser.

TASK TYPES (velg mest passende):
- "bring": Når noe skal tas med (gymtøy, matpakke, skift, utstyr)
- "appointment": Avtaler (lege, tannlege, foreldremøte)
- "activity": Aktiviteter (fotball, svømming, bursdagsfest, kurs)
- "closure": Stengt/fri (barnehagen stengt, planleggingsdag, ferie)
- "reminder": Generelle påminnelser
- "other": Annet som ikke passer kategoriene over

DATOER (i dag er ${today}):
- "i morgen" = dagen etter i dag
- "på mandag/tirsdag/..." = neste forekomst av den ukedagen
- "neste uke" = mandag neste uke
- Relative datoer tolkes fra dagens dato

VIKTIGE REGLER:
1. Hvis et barnenavn nevnes, koble påminnelsen til det barnet
2. Sett confidence høyt (0.8-1.0) for tydelige påminnelser, lavere (0.5-0.7) for uklare
3. Returner ALLTID gyldig JSON
4. Dato må være på formatet YYYY-MM-DD
5. Tid må være på formatet HH:MM (24-timers)

Svar ALLTID i dette JSON-formatet:
{
  "reminders": [
    {
      "title": "Kort tittel på påminnelsen",
      "date": "YYYY-MM-DD eller null",
      "time": "HH:MM eller null",
      "task_type": "bring|appointment|activity|closure|reminder|other",
      "child_name": "Barnenavn eller null",
      "child_id": "UUID fra listen eller null",
      "notes": "Ekstra detaljer eller null",
      "confidence": 0.0-1.0
    }
  ]
}${childContext}`

const SUGGEST_SYSTEM_PROMPT = `Du er en hjelpsom assistent for norsk familieplanlegging. Du foreslår middager som er:
- Enkle å lage (få ingredienser, kort tilberedningstid)
- Barnevennlige (passer for barn i alle aldre)
- Proteinrike og næringsrike
- Varierte gjennom uken
- Sesongbaserte når mulig

Svar ALLTID i gyldig JSON-format med denne strukturen:
{
  "suggestions": [
    {
      "day": "YYYY-MM-DD",
      "name": "Oppskriftsnavn",
      "description": "Kort beskrivelse av retten",
      "ingredients": [{"item": "ingrediens", "amount": "mengde"}],
      "is_quick": true/false,
      "is_kid_friendly": true/false
    }
  ]
}

Ikke inkluder noe annet enn JSON i svaret.`

interface BenchmarkResult {
  model: string
  task: string
  testCase: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  success: boolean
  validJson: boolean
  passedValidation: boolean
  error?: string
  rawOutput?: string
}

async function callOpenRouter(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; latencyMs: number; inputTokens: number; outputTokens: number }> {
  const startTime = Date.now()

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Familjen Benchmark',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    }),
  })

  const latencyMs = Date.now() - startTime

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''
  const inputTokens = data.usage?.prompt_tokens || 0
  const outputTokens = data.usage?.completion_tokens || 0

  return { content, latencyMs, inputTokens, outputTokens }
}

function extractJson(content: string): unknown {
  let jsonContent = content
  if (content.includes('```json')) {
    jsonContent = content.split('```json')[1].split('```')[0].trim()
  } else if (content.includes('```')) {
    jsonContent = content.split('```')[1].split('```')[0].trim()
  }
  return JSON.parse(jsonContent)
}

function validateParseResult(
  parsed: unknown,
  expected: typeof PARSE_TEST_CASES[0]['expected']
): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const result = parsed as { reminders?: unknown[] }

  if (!Array.isArray(result.reminders)) return false

  // Check count if specified
  if ('count' in expected && result.reminders.length !== expected.count) {
    return false
  }

  // Check if at least one reminder exists
  if (result.reminders.length === 0) return false

  const firstReminder = result.reminders[0] as Record<string, unknown>

  // Check title contains
  if ('title_contains' in expected) {
    const titleMatch = result.reminders.some(
      (r: Record<string, unknown>) =>
        typeof r.title === 'string' &&
        r.title.toLowerCase().includes((expected.title_contains as string).toLowerCase())
    )
    if (!titleMatch) return false
  }

  // Check child name
  if ('child_name' in expected) {
    const childMatch = result.reminders.some(
      (r: Record<string, unknown>) =>
        typeof r.child_name === 'string' &&
        r.child_name.toLowerCase() === (expected.child_name as string).toLowerCase()
    )
    if (!childMatch) return false
  }

  // Check has time
  if ('has_time' in expected && expected.has_time) {
    if (!firstReminder.time) return false
  }

  // Check task type
  if ('task_type' in expected) {
    const typeMatch = result.reminders.some(
      (r: Record<string, unknown>) => r.task_type === expected.task_type
    )
    if (!typeMatch) return false
  }

  // Check has_bring
  if ('has_bring' in expected && expected.has_bring) {
    const hasBring = result.reminders.some(
      (r: Record<string, unknown>) => r.task_type === 'bring'
    )
    if (!hasBring) return false
  }

  // Check has_appointment
  if ('has_appointment' in expected && expected.has_appointment) {
    const hasAppointment = result.reminders.some(
      (r: Record<string, unknown>) => r.task_type === 'appointment'
    )
    if (!hasAppointment) return false
  }

  return true
}

function validateSuggestResult(
  parsed: unknown,
  expected: typeof SUGGEST_TEST_CASE['expected'],
  allergies: string[]
): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const result = parsed as { suggestions?: unknown[] }

  if (!Array.isArray(result.suggestions)) return false
  if (result.suggestions.length === 0) return false

  // Check avoids allergens
  if (expected.avoids_nuts && allergies.includes('nøtter')) {
    const hasNuts = result.suggestions.some((s: Record<string, unknown>) => {
      const name = (s.name as string || '').toLowerCase()
      const desc = (s.description as string || '').toLowerCase()
      const ingredients = (s.ingredients as Array<{ item: string }>) || []
      const ingredientText = ingredients.map(i => i.item.toLowerCase()).join(' ')

      return name.includes('nøtt') || name.includes('nut') ||
             desc.includes('nøtt') || desc.includes('nut') ||
             ingredientText.includes('nøtt') || ingredientText.includes('nut')
    })
    if (hasNuts) return false
  }

  return true
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model]
  if (!pricing) return 0
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

async function benchmarkParseReminders(
  modelName: string,
  modelId: string
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []
  const today = new Date().toISOString().split('T')[0]

  for (const testCase of PARSE_TEST_CASES) {
    const childContext = `\n\nBarn i familien:\n${testCase.children.map(c => `- ${c.name} (id: ${c.id})`).join('\n')}`
    const systemPrompt = PARSE_SYSTEM_PROMPT(today, childContext)
    const userPrompt = `Tolk følgende tekst og trekk ut påminnelser:\n\n"${testCase.input}"\n\nDagens dato er: ${today}`

    try {
      const { content, latencyMs, inputTokens, outputTokens } = await callOpenRouter(
        modelId,
        systemPrompt,
        userPrompt
      )

      let validJson = false
      let passedValidation = false
      let parsed: unknown = null

      try {
        parsed = extractJson(content)
        validJson = true
        passedValidation = validateParseResult(parsed, testCase.expected)
      } catch {
        validJson = false
      }

      results.push({
        model: modelName,
        task: 'parse-reminders',
        testCase: testCase.name,
        latencyMs,
        inputTokens,
        outputTokens,
        costUsd: calculateCost(modelId, inputTokens, outputTokens),
        success: true,
        validJson,
        passedValidation,
        rawOutput: content.substring(0, 200),
      })
    } catch (error) {
      results.push({
        model: modelName,
        task: 'parse-reminders',
        testCase: testCase.name,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        success: false,
        validJson: false,
        passedValidation: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500))
  }

  return results
}

async function benchmarkSuggest(
  modelName: string,
  modelId: string
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []
  const testCase = SUGGEST_TEST_CASE

  const userPrompt = `Foreslå middager for følgende dager:

${testCase.days.map(d => `- ${d}`).join('\n')}

**Barn i familien:**
${testCase.children.map(c => `- ${c.name}: ${c.age} år${c.allergies.length > 0 ? ` (allergisk mot: ${c.allergies.join(', ')})` : ''}`).join('\n')}

**VIKTIG - Allergier (UNNGÅ disse ingrediensene):**
${testCase.children.flatMap(c => c.allergies).join(', ') || 'Ingen'}

**Nylige middager (unngå gjentakelse):**
${testCase.recentMeals.join(', ')}

**Viktig:**
- Forslagene skal være enkle med få ingredienser
- Barna skal like maten
- Fokuser på protein
- Varier mellom ulike proteiner (kylling, fisk, kjøtt, vegetar)`

  try {
    const { content, latencyMs, inputTokens, outputTokens } = await callOpenRouter(
      modelId,
      SUGGEST_SYSTEM_PROMPT,
      userPrompt
    )

    let validJson = false
    let passedValidation = false
    let parsed: unknown = null

    try {
      parsed = extractJson(content)
      validJson = true
      passedValidation = validateSuggestResult(
        parsed,
        testCase.expected,
        testCase.children.flatMap(c => c.allergies)
      )
    } catch {
      validJson = false
    }

    results.push({
      model: modelName,
      task: 'suggest',
      testCase: testCase.name,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd: calculateCost(modelId, inputTokens, outputTokens),
      success: true,
      validJson,
      passedValidation,
      rawOutput: content.substring(0, 200),
    })
  } catch (error) {
    results.push({
      model: modelName,
      task: 'suggest',
      testCase: testCase.name,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      success: false,
      validJson: false,
      passedValidation: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }

  return results
}

function printResults(results: BenchmarkResult[]) {
  console.log('\n' + '='.repeat(100))
  console.log('AI MODEL BENCHMARK RESULTS')
  console.log('='.repeat(100) + '\n')

  // Group by model
  const byModel = new Map<string, BenchmarkResult[]>()
  for (const r of results) {
    const existing = byModel.get(r.model) || []
    existing.push(r)
    byModel.set(r.model, existing)
  }

  // Summary table
  console.log('## SUMMARY BY MODEL\n')
  console.log('| Model | Avg Latency | Valid JSON | Passed Tests | Avg Cost |')
  console.log('|-------|-------------|------------|--------------|----------|')

  const summaries: Array<{
    model: string
    avgLatency: number
    validJsonPct: number
    passedPct: number
    avgCost: number
    totalTests: number
  }> = []

  for (const [model, modelResults] of byModel) {
    const successResults = modelResults.filter(r => r.success)
    const avgLatency = successResults.length > 0
      ? successResults.reduce((sum, r) => sum + r.latencyMs, 0) / successResults.length
      : 0
    const validJsonPct = successResults.length > 0
      ? (successResults.filter(r => r.validJson).length / successResults.length) * 100
      : 0
    const passedPct = successResults.length > 0
      ? (successResults.filter(r => r.passedValidation).length / successResults.length) * 100
      : 0
    const avgCost = successResults.length > 0
      ? successResults.reduce((sum, r) => sum + r.costUsd, 0) / successResults.length
      : 0

    summaries.push({
      model,
      avgLatency,
      validJsonPct,
      passedPct,
      avgCost,
      totalTests: modelResults.length,
    })

    console.log(
      `| ${model.padEnd(20)} | ${avgLatency.toFixed(0).padStart(6)}ms | ${validJsonPct.toFixed(0).padStart(9)}% | ${passedPct.toFixed(0).padStart(11)}% | $${avgCost.toFixed(6)} |`
    )
  }

  // Detailed results by task
  console.log('\n## DETAILED RESULTS\n')

  // Parse reminders
  console.log('### Parse Reminders Task\n')
  console.log('| Model | Test Case | Latency | JSON | Passed | Cost |')
  console.log('|-------|-----------|---------|------|--------|------|')

  for (const r of results.filter(r => r.task === 'parse-reminders')) {
    const jsonStatus = r.success ? (r.validJson ? '✅' : '❌') : '💥'
    const passedStatus = r.success ? (r.passedValidation ? '✅' : '❌') : '💥'
    console.log(
      `| ${r.model.padEnd(20)} | ${r.testCase.padEnd(20)} | ${r.latencyMs.toString().padStart(5)}ms | ${jsonStatus} | ${passedStatus} | $${r.costUsd.toFixed(6)} |`
    )
    if (r.error) {
      console.log(`|   ERROR: ${r.error.substring(0, 60)}`)
    }
  }

  // Suggest
  console.log('\n### Meal Suggestions Task\n')
  console.log('| Model | Test Case | Latency | JSON | Passed | Cost |')
  console.log('|-------|-----------|---------|------|--------|------|')

  for (const r of results.filter(r => r.task === 'suggest')) {
    const jsonStatus = r.success ? (r.validJson ? '✅' : '❌') : '💥'
    const passedStatus = r.success ? (r.passedValidation ? '✅' : '❌') : '💥'
    console.log(
      `| ${r.model.padEnd(20)} | ${r.testCase.padEnd(20)} | ${r.latencyMs.toString().padStart(5)}ms | ${jsonStatus} | ${passedStatus} | $${r.costUsd.toFixed(6)} |`
    )
    if (r.error) {
      console.log(`|   ERROR: ${r.error.substring(0, 60)}`)
    }
  }

  // Recommendations
  console.log('\n## RECOMMENDATIONS\n')

  // Find best fast model (passed all tests, lowest latency)
  const passedAll = summaries.filter(s => s.passedPct === 100 && s.validJsonPct === 100)

  if (passedAll.length > 0) {
    const fastestPassing = passedAll.sort((a, b) => a.avgLatency - b.avgLatency)[0]
    const cheapestPassing = passedAll.sort((a, b) => a.avgCost - b.avgCost)[0]

    console.log(`**Fastest model that passed all tests:** ${fastestPassing.model} (${fastestPassing.avgLatency.toFixed(0)}ms avg)`)
    console.log(`**Cheapest model that passed all tests:** ${cheapestPassing.model} ($${cheapestPassing.avgCost.toFixed(6)} avg)`)

    // Check if we need two models or one is enough
    const fastEnough = passedAll.filter(s => s.avgLatency < 2000)
    if (fastEnough.length > 0) {
      console.log(`\n**Recommendation:** Use "${fastEnough[0].model}" for both tasks - fast enough (<2s) and passes all validations.`)
    } else {
      console.log(`\n**Recommendation:** Consider using a faster model for parse-reminders (user-facing, needs quick response).`)
    }
  } else {
    console.log('No model passed all tests. Review detailed results above.')

    // Find best partial performers
    const bestPasser = summaries.sort((a, b) => b.passedPct - a.passedPct)[0]
    console.log(`Best performer: ${bestPasser.model} with ${bestPasser.passedPct.toFixed(0)}% tests passed`)
  }

  console.log('\n' + '='.repeat(100) + '\n')
}

async function main() {
  console.log('Starting AI Model Benchmark...\n')
  console.log('Models to test:', Object.keys(MODELS).join(', '))
  console.log('Tasks: parse-reminders, suggest\n')

  const allResults: BenchmarkResult[] = []

  for (const [name, id] of Object.entries(MODELS)) {
    console.log(`\nTesting ${name}...`)

    const parseResults = await benchmarkParseReminders(name, id)
    allResults.push(...parseResults)
    console.log(`  parse-reminders: ${parseResults.filter(r => r.success).length}/${parseResults.length} successful`)

    const suggestResults = await benchmarkSuggest(name, id)
    allResults.push(...suggestResults)
    console.log(`  suggest: ${suggestResults.filter(r => r.success).length}/${suggestResults.length} successful`)

    // Delay between models
    await new Promise(r => setTimeout(r, 1000))
  }

  printResults(allResults)
}

main().catch(console.error)
