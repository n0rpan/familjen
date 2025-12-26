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

// Default models - override via environment variables
// Updated Dec 2025: Using latest Gemini 3 Flash and Claude Sonnet 4.5
export const AI_MODELS: AIModelConfig = {
  // Gemini 3 Flash Preview - fast and cost-effective
  fast: process.env.OPENROUTER_FAST_MODEL || 'google/gemini-3-flash-preview',
  // Claude Sonnet 4.5 for deeper code review
  capable: process.env.OPENROUTER_CAPABLE_MODEL || 'anthropic/claude-sonnet-4-5-20250514',
  // Gemini 3 Flash for vision tasks (screenshot comparison)
  vision: process.env.OPENROUTER_VISION_MODEL || 'google/gemini-3-flash-preview',
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

type Message = {
  role: string
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
}

interface CallOptions {
  temperature?: number
  maxTokens?: number
  schema?: (typeof SCHEMAS)[keyof typeof SCHEMAS]
  schemaName?: string
}

/**
 * Call OpenRouter API with optional structured output support
 *
 * When schema is provided, uses OpenRouter's structured outputs feature
 * to guarantee the response matches the JSON schema.
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

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenRouterKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/n0rpan/familjen',
      'X-Title': 'Familjen CI/CD',
    },
    body: JSON.stringify(body),
  })

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
