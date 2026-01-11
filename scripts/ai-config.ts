/**
 * AI Model Configuration for CI/CD
 *
 * Uses OpenRouter for model access with structured outputs.
 * See: https://openrouter.ai/docs/guides/features/structured-outputs
 *
 * Recommended models (Dec 2025 - tested for quality & speed):
 *
 * | Role    | Env Var                  | Recommended Model                    | Why                           |
 * |---------|--------------------------|--------------------------------------|-------------------------------|
 * | fast    | OPENROUTER_FAST_MODEL    | google/gemini-3-flash-preview        | Fast (1.5s), thorough         |
 * | capable | OPENROUTER_CAPABLE_MODEL | anthropic/claude-sonnet-4.5          | Best code review quality      |
 * | vision  | OPENROUTER_VISION_MODEL  | google/gemini-3-flash-preview        | Fast vision + 1M context      |
 * | verdict | OPENROUTER_VERDICT_MODEL | openai/gpt-5.2                       | Fast reasoning, 400K context  |
 * | test    | OPENROUTER_TEST_MODEL    | google/gemini-2.5-flash-lite         | Cheapest for bulk analysis    |
 *
 * Alternative options:
 * - verdict: anthropic/claude-opus-4.5 (best reasoning), google/gemini-3-pro-preview
 * - capable: x-ai/grok-code-fast-1 (faster but less thorough)
 * - fast: google/gemini-2.5-flash-lite (cheapest), x-ai/grok-4.1-fast (2M context)
 *
 * ## Online Models (Web Search)
 *
 * Append `:online` to any model ID to enable web search:
 * - "openai/gpt-4o:online" - GPT-4o with web search
 * - "anthropic/claude-sonnet-4:online" - Claude with web search
 *
 * Use getOnlineModel() to safely append :online to a model ID.
 * See: https://openrouter.ai/docs/guides/routing/model-variants/online
 */

export interface AIModelConfig {
  // Fast model for quick checks (test selector, pre-verdict, etc.)
  fast: string
  // Capable model for detailed code review
  capable: string
  // Vision model for visual validation
  vision: string
  // Verdict model for final decision (needs good reasoning)
  verdict: string
  // Test model for bulk analysis (cheapest)
  test: string
}

// Model configuration - set via environment variables (GitHub Secrets)
// No hardcoded defaults - ensures you're always using your intended models
function getRequiredModel(envVar: string, name: string): string {
  const model = process.env[envVar]
  if (!model) {
    throw new Error(
      `${envVar} environment variable is required. ` +
        `Set it in GitHub Secrets or locally to specify the ${name} model.`
    )
  }
  return model
}

// Lazy-loaded to allow scripts to check for env vars before accessing
export const AI_MODELS: AIModelConfig = {
  get fast() {
    return getRequiredModel('OPENROUTER_FAST_MODEL', 'fast')
  },
  get capable() {
    return getRequiredModel('OPENROUTER_CAPABLE_MODEL', 'capable')
  },
  get vision() {
    return getRequiredModel('OPENROUTER_VISION_MODEL', 'vision')
  },
  get verdict() {
    return getRequiredModel('OPENROUTER_VERDICT_MODEL', 'verdict')
  },
  get test() {
    return getRequiredModel('OPENROUTER_TEST_MODEL', 'test')
  },
}

/**
 * Convert a model ID to its :online variant for web search capability.
 *
 * @example
 * getOnlineModel('openai/gpt-4o') // => 'openai/gpt-4o:online'
 * getOnlineModel('openai/gpt-4o:online') // => 'openai/gpt-4o:online' (idempotent)
 */
export function getOnlineModel(model: string): string {
  if (model.endsWith(':online')) {
    return model
  }
  return `${model}:online`
}

/**
 * Check if a model supports the :online variant.
 * Most OpenRouter models support :online for web search.
 */
export function supportsOnline(model: string): boolean {
  // Most models support :online, but some don't
  // This is a conservative list - add more as tested
  const unsupportedPrefixes = [
    'stability-ai/', // Image models
    'black-forest-labs/', // Image models
  ]
  return !unsupportedPrefixes.some(prefix => model.startsWith(prefix))
}

/**
 * Model pricing info from OpenRouter API
 */
export interface ModelPricing {
  id: string
  name: string
  pricing: {
    prompt: number   // Cost per token (input)
    completion: number  // Cost per token (output)
  }
  context_length: number
  supportsOnline: boolean
}

// Cache for model pricing (5 minute TTL)
let modelPricingCache: { data: ModelPricing[]; timestamp: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Fetch current model availability and pricing from OpenRouter API.
 * Results are cached for 5 minutes to avoid excessive API calls.
 */
export async function fetchAvailableModels(): Promise<string[]> {
  const models = await fetchModelPricing()
  return models.map(m => m.id)
}

/**
 * Fetch model pricing from OpenRouter API.
 * Returns pricing per token for cost calculation.
 * Cached for 5 minutes.
 */
export async function fetchModelPricing(): Promise<ModelPricing[]> {
  // Return cached data if still valid
  if (modelPricingCache && Date.now() - modelPricingCache.timestamp < CACHE_TTL_MS) {
    return modelPricingCache.data
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
    })
    if (!response.ok) {
      console.warn('Could not fetch OpenRouter models:', response.status)
      return modelPricingCache?.data || []
    }
    const data = await response.json()

    const models: ModelPricing[] = (data.data || []).map((m: {
      id: string
      name: string
      pricing?: { prompt?: string; completion?: string }
      context_length?: number
    }) => ({
      id: m.id,
      name: m.name || m.id,
      pricing: {
        // OpenRouter returns pricing as string per token
        prompt: parseFloat(m.pricing?.prompt || '0'),
        completion: parseFloat(m.pricing?.completion || '0'),
      },
      context_length: m.context_length || 0,
      supportsOnline: supportsOnline(m.id),
    }))

    // Update cache
    modelPricingCache = { data: models, timestamp: Date.now() }
    return models
  } catch (e) {
    console.warn('Error fetching OpenRouter models:', e)
    return modelPricingCache?.data || []
  }
}

/**
 * Get pricing for a specific model.
 * Returns null if model not found or pricing unavailable.
 */
export async function getModelPricing(modelId: string): Promise<ModelPricing | null> {
  const models = await fetchModelPricing()
  // Remove :online suffix for lookup
  const baseModelId = modelId.replace(/:online$/, '')
  return models.find(m => m.id === baseModelId) || null
}

/**
 * Calculate cost from token usage using real OpenRouter pricing.
 * Falls back to estimate if pricing unavailable.
 */
export async function calculateRealCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number
): Promise<{ cost: number; source: 'api' | 'estimate' }> {
  const pricing = await getModelPricing(modelId)

  if (pricing && (pricing.pricing.prompt > 0 || pricing.pricing.completion > 0)) {
    const cost = (promptTokens * pricing.pricing.prompt) + (completionTokens * pricing.pricing.completion)
    return { cost, source: 'api' }
  }

  // Fallback: rough estimate ($1/1M input, $4/1M output)
  const estimatedCost = (promptTokens / 1_000_000) * 1.0 + (completionTokens / 1_000_000) * 4.0
  return { cost: estimatedCost, source: 'estimate' }
}

// JSON Schemas for structured outputs
export const SCHEMAS = {
  migrationReview: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['PASS', 'FAIL', 'WARN'],
        description: 'Overall review verdict',
      },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: {
              type: 'string',
              enum: ['critical', 'warning', 'info'],
            },
            message: { type: 'string' },
            line: { type: ['integer', 'null'] },
          },
          required: ['severity', 'message'],
          additionalProperties: false,
        },
        description: 'List of issues found',
      },
      suggestions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Improvement suggestions',
      },
      summary: {
        type: 'string',
        description: 'One paragraph summary',
      },
    },
    required: ['verdict', 'issues', 'suggestions', 'summary'],
    additionalProperties: false,
  },

  codeReview: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
        description: 'Overall review verdict',
      },
      blocking: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            line: { type: ['integer', 'null'] },
            issue: { type: 'string' },
          },
          required: ['file', 'issue'],
          additionalProperties: false,
        },
        description: 'Blocking issues that must be fixed',
      },
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            line: { type: ['integer', 'null'] },
            suggestion: { type: 'string' },
          },
          required: ['file', 'suggestion'],
          additionalProperties: false,
        },
        description: 'Non-blocking suggestions',
      },
      summary: {
        type: 'string',
        description: '2-3 sentence summary',
      },
    },
    required: ['verdict', 'blocking', 'suggestions', 'summary'],
    additionalProperties: false,
  },

  visualReview: {
    type: 'object',
    properties: {
      pass: {
        type: 'boolean',
        description: 'Whether the visual check passed',
      },
      score: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Quality score 0-100',
      },
      issues: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of visual issues',
      },
      positives: {
        type: 'array',
        items: { type: 'string' },
        description: 'Positive observations',
      },
      summary: {
        type: 'string',
        description: 'One sentence assessment',
      },
    },
    required: ['pass', 'score', 'issues', 'positives', 'summary'],
    additionalProperties: false,
  },
} as const

export type MigrationReviewResult = {
  verdict: 'PASS' | 'FAIL' | 'WARN'
  issues: Array<{ severity: 'critical' | 'warning' | 'info'; message: string; line?: number | null }>
  suggestions: string[]
  summary: string
}

export type CodeReviewResult = {
  verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  blocking: Array<{ file: string; line?: number | null; issue: string }>
  suggestions: Array<{ file: string; line?: number | null; suggestion: string }>
  summary: string
}

export type VisualReviewResult = {
  pass: boolean
  score: number
  issues: string[]
  positives: string[]
  summary: string
}

export function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    throw new Error('OPENROUTER_API_KEY environment variable is required')
  }
  return key
}

// Default timeout for AI API calls (2 minutes)
const DEFAULT_TIMEOUT_MS = 120_000

// Retry configuration for transient failures
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 1000

/**
 * Execute a function with exponential backoff retry
 * Retries on network errors and 5xx responses
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  maxRetries = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry on auth errors or validation errors
      if (lastError.message.includes('401') || lastError.message.includes('400')) {
        throw lastError
      }

      if (attempt < maxRetries) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)
        console.warn(`⚠️ ${operation} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

/**
 * Wrap a promise with a timeout
 * Prevents hung API calls from blocking CI indefinitely
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${operation} timed out after ${ms / 1000}s`)), ms)
  )
  return Promise.race([promise, timeout])
}

type Message = {
  role: string
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
}

interface CallOptions {
  temperature?: number
  maxTokens?: number
  schema?: (typeof SCHEMAS)[keyof typeof SCHEMAS]
  schemaName?: string
  timeoutMs?: number
  /** Enable web search for research tasks (adds :online suffix) */
  enableWebSearch?: boolean
}

export interface OpenRouterResponse {
  content: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cost?: number
  }
}

/**
 * Call OpenRouter API with optional structured output support
 *
 * When schema is provided, uses OpenRouter's structured outputs feature
 * to guarantee the response matches the JSON schema.
 *
 * When enableWebSearch is true, uses the :online model variant for web search.
 *
 * Includes timeout protection to prevent hung CI jobs.
 */
export async function callOpenRouter(model: string, messages: Message[], options: CallOptions = {}): Promise<string> {
  // Use online model if web search enabled
  const effectiveModel = options.enableWebSearch && supportsOnline(model)
    ? getOnlineModel(model)
    : model

  const body: Record<string, unknown> = {
    model: effectiveModel,
    messages,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 4000,
  }

  // Add structured output format if schema provided
  if (options.schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.schemaName || 'response',
        strict: true,
        schema: options.schema,
      },
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const operationName = options.schemaName ? `AI ${options.schemaName}` : 'AI API call'

  const fetchPromise = fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenRouterKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/n0rpan/familjen',
      'X-Title': 'Familjen CI/CD',
    },
    body: JSON.stringify(body),
  })

  const response = await withTimeout(fetchPromise, timeoutMs, operationName)

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

/**
 * Call OpenRouter API and return full response including cost info.
 * Use this when you need to track costs accurately.
 */
export async function callOpenRouterWithCost(
  model: string,
  messages: Message[],
  options: CallOptions = {}
): Promise<OpenRouterResponse> {
  // Use online model if web search enabled
  const effectiveModel = options.enableWebSearch && supportsOnline(model)
    ? getOnlineModel(model)
    : model

  const body: Record<string, unknown> = {
    model: effectiveModel,
    messages,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 4000,
  }

  if (options.schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.schemaName || 'response',
        strict: true,
        schema: options.schema,
      },
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const operationName = options.schemaName ? `AI ${options.schemaName}` : 'AI API call'

  const fetchPromise = fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenRouterKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/n0rpan/familjen',
      'X-Title': 'Familjen CI/CD',
    },
    body: JSON.stringify(body),
  })

  const response = await withTimeout(fetchPromise, timeoutMs, operationName)

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''
  const usage = data.usage ? {
    prompt_tokens: data.usage.prompt_tokens || 0,
    completion_tokens: data.usage.completion_tokens || 0,
    total_tokens: data.usage.total_tokens || 0,
    cost: data.usage.cost ?? data.usage.total_cost ?? undefined,
  } : undefined

  return { content, usage }
}

/**
 * Perform a research query using web search.
 * Uses :online model variant to access real-time web data.
 *
 * @example
 * const info = await researchQuery(AI_MODELS.fast, "What is the latest version of Next.js?")
 */
export async function researchQuery(model: string, query: string): Promise<string> {
  return callOpenRouter(model, [
    {
      role: 'system',
      content: 'You are a research assistant with web search capability. Provide accurate, up-to-date information based on current web data. Be concise and cite sources when relevant.',
    },
    {
      role: 'user',
      content: query,
    },
  ], {
    enableWebSearch: true,
    temperature: 0,
    maxTokens: 2000,
  })
}

/**
 * Call OpenRouter with structured output and parse result
 *
 * Guaranteed to return a properly typed result matching the schema.
 */
export async function callOpenRouterStructured<T>(
  model: string,
  messages: Message[],
  schema: (typeof SCHEMAS)[keyof typeof SCHEMAS],
  schemaName: string,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<T> {
  const content = await callOpenRouter(model, messages, {
    ...options,
    schema,
    schemaName,
  })

  try {
    return JSON.parse(content) as T
  } catch (error) {
    // Fallback: try to extract JSON from response (for models that don't support structured outputs)
    console.warn(`⚠️ Structured output parsing failed for ${schemaName}, attempting fallback extraction`)
    console.warn(`   Model: ${model}`)
    console.warn(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`)

    const parsed = parseJsonFromResponse(content)
    if (parsed) {
      console.warn(`   ✓ Fallback extraction succeeded`)
      return parsed as T
    }

    console.error(`   ✗ Fallback extraction also failed`)
    console.error(`   Response preview: ${content.slice(0, 200)}...`)
    throw new Error(`Failed to parse structured response: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Fallback parser for models that don't support structured outputs.
 *
 * Strategy (in order of preference):
 * 1. Extract from markdown code block (most specific, handles ```json ... ```)
 * 2. Find first balanced JSON object from start of content (handles raw JSON)
 * 3. Find first balanced JSON object anywhere in content (fallback)
 *
 * The balanced brace matching prevents greedy regex from matching
 * the wrong object when multiple JSON objects exist in the response.
 */
export function parseJsonFromResponse(content: string): Record<string, unknown> | null {
  // Strategy 1: Try markdown code block first (most reliable)
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // Code block content wasn't valid JSON, continue to next strategy
    }
  }

  // Strategy 2: Try to extract balanced JSON object from start
  const trimmed = content.trim()
  if (trimmed.startsWith('{')) {
    const extracted = extractBalancedJson(trimmed)
    if (extracted) {
      try {
        return JSON.parse(extracted)
      } catch {
        // Continue to next strategy
      }
    }
  }

  // Strategy 3: Find first { and try to extract balanced object
  const firstBrace = content.indexOf('{')
  if (firstBrace >= 0) {
    const extracted = extractBalancedJson(content.slice(firstBrace))
    if (extracted) {
      try {
        return JSON.parse(extracted)
      } catch {
        // All strategies failed
      }
    }
  }

  return null
}

/**
 * Extract a balanced JSON object from a string.
 * Counts braces to find matching closing brace, respecting string literals.
 */
function extractBalancedJson(str: string): string | null {
  if (!str.startsWith('{')) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = 0; i < str.length; i++) {
    const char = str[i]

    if (escape) {
      escape = false
      continue
    }

    if (char === '\\' && inString) {
      escape = true
      continue
    }

    if (char === '"' && !escape) {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') depth++
    if (char === '}') {
      depth--
      if (depth === 0) {
        return str.slice(0, i + 1)
      }
    }
  }

  return null // No balanced closing brace found
}

/**
 * Fetch with structured output for vision models
 *
 * Similar to callOpenRouterStructured but designed for vision models
 * that take image content in messages.
 *
 * Includes timeout protection (default 3 minutes for vision models
 * since image processing can be slower).
 */
export async function fetchWithStructuredOutput<T>(
  messages: Message[],
  schema: Record<string, unknown>,
  model: string,
  timeoutMs: number = 180_000 // 3 minutes default for vision
): Promise<T> {
  const body = {
    model,
    messages,
    temperature: 0,
    max_tokens: 4000,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'visual_validation',
        strict: true,
        schema,
      },
    },
  }

  const fetchPromise = fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenRouterKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/n0rpan/familjen',
      'X-Title': 'Familjen CI/CD - Visual Validation',
    },
    body: JSON.stringify(body),
  })

  const response = await withTimeout(fetchPromise, timeoutMs, 'AI visual validation')

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('No content in API response')
  }

  try {
    return JSON.parse(content) as T
  } catch (error) {
    // Fallback extraction
    const parsed = parseJsonFromResponse(content)
    if (parsed) {
      return parsed as T
    }
    throw new Error(`Failed to parse response: ${error instanceof Error ? error.message : 'Unknown'}`)
  }
}
