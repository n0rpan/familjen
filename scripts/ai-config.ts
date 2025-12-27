/**
 * AI Model Configuration for CI/CD
 *
 * Uses OpenRouter for model access with structured outputs.
 * See: https://openrouter.ai/docs/guides/features/structured-outputs
 *
 * Update these models as new versions release.
 * Current as of Dec 2025.
 */

export interface AIModelConfig {
  // Fast, cheap model for quick checks (migration review, etc.)
  fast: string
  // More capable model for code review
  capable: string
  // Vision-capable model for visual review
  vision: string
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
}

/**
 * Call OpenRouter API with optional structured output support
 *
 * When schema is provided, uses OpenRouter's structured outputs feature
 * to guarantee the response matches the JSON schema.
 *
 * Includes timeout protection to prevent hung CI jobs.
 */
export async function callOpenRouter(model: string, messages: Message[], options: CallOptions = {}): Promise<string> {
  const body: Record<string, unknown> = {
    model,
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
 * Fallback parser for models that don't support structured outputs
 */
export function parseJsonFromResponse(content: string): Record<string, unknown> | null {
  // Try to find JSON in the response (handles markdown code blocks)
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/)
  if (!jsonMatch) {
    return null
  }
  try {
    return JSON.parse(jsonMatch[1] || jsonMatch[0])
  } catch {
    return null
  }
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
