/**
 * Shared JSON schemas for OpenRouter structured outputs.
 * These ensure consistent, parseable responses from AI calls.
 *
 * All AI endpoints should import schemas from this file for consistency.
 *
 * @see https://openrouter.ai/docs/guides/features/structured-outputs
 */

// =============================================================================
// MEAL SUGGESTION SCHEMAS
// =============================================================================

/**
 * Schema for meal suggestions from the AI.
 * Used by both /api/openrouter/suggest and parse-action suggest mode.
 */
export const MEAL_SUGGESTION_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'meal_suggestions',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day: { type: 'string', description: 'Date in YYYY-MM-DD format' },
              name: { type: 'string', description: 'Name of the dish' },
              description: { type: 'string', description: 'Short description of the dish' },
              ingredients: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    item: { type: 'string' },
                    amount: { type: 'string' },
                  },
                  required: ['item', 'amount'],
                  additionalProperties: false,
                },
              },
              is_quick: { type: 'boolean' },
              is_kid_friendly: { type: 'boolean' },
            },
            required: ['day', 'name', 'description', 'ingredients', 'is_quick', 'is_kid_friendly'],
            additionalProperties: false,
          },
        },
      },
      required: ['suggestions'],
      additionalProperties: false,
    },
  },
}

/**
 * Schema for meal validation responses.
 * Used by ai-validation.ts to check meal safety and quality.
 */
export const MEAL_VALIDATION_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'meal_validation',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        valid_meals: {
          type: 'array',
          items: { type: 'string' },
          description: 'Dates of valid meals in YYYY-MM-DD format',
        },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day: { type: 'string' },
              meal_name: { type: 'string' },
              type: { type: 'string', enum: ['allergen', 'safety', 'quality', 'variety'] },
              reason: { type: 'string' },
              ingredient: { type: ['string', 'null'] },
            },
            required: ['day', 'meal_name', 'type', 'reason'],
            additionalProperties: false,
          },
        },
        overall_feedback: { type: ['string', 'null'] },
      },
      required: ['valid_meals', 'issues'],
      additionalProperties: false,
    },
  },
}

// =============================================================================
// ACTION PARSING SCHEMAS
// =============================================================================

/**
 * Schema for the universal AI input action parsing.
 * Handles meals, tasks, events, shopping items, etc.
 */
export const ACTION_PARSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'parsed_actions',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['meal', 'shopping_item', 'child_task', 'member_event', 'household_event', 'pickup', 'wishlist_item', 'navigate'],
              },
              operation: {
                type: 'string',
                enum: ['add', 'modify', 'edit', 'delete', 'complete'],
              },
              data: { type: 'object' },
              display: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  subtitle: { type: 'string' },
                  icon: { type: 'string' },
                },
                required: ['title', 'subtitle', 'icon'],
                additionalProperties: false,
              },
              confidence: { type: 'number' },
              needs_clarification: {
                type: ['object', 'null'],
                properties: {
                  field: { type: 'string' },
                  question: { type: 'string' },
                  options: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        value: { type: ['string', 'null'] },
                        result_type: { type: 'string' },
                      },
                      required: ['label', 'value'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['field', 'question', 'options'],
                additionalProperties: false,
              },
            },
            required: ['type', 'operation', 'data', 'display', 'confidence'],
            additionalProperties: false,
          },
        },
      },
      required: ['actions'],
      additionalProperties: false,
    },
  },
}

// =============================================================================
// SEARCH & FEED SCHEMAS
// =============================================================================

/**
 * Schema for feed/ask question answering.
 */
export const FEED_ASK_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'feed_answer',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'The answer to the user question' },
        sourceIndices: {
          type: 'array',
          items: { type: 'number' },
          description: 'Indices of messages used as sources (1-based)',
        },
        noRelevantInfo: { type: 'boolean' },
      },
      required: ['answer', 'sourceIndices', 'noRelevantInfo'],
      additionalProperties: false,
    },
  },
}

/**
 * Schema for search mode summary responses.
 */
export const SEARCH_SUMMARY_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'search_summary',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'A concise summary answering the search query' },
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
}

// =============================================================================
// SHOPPING LIST SCHEMAS
// =============================================================================

/**
 * Schema for shopping duplicate detection.
 * Used by check-shopping-duplicate endpoint.
 */
export const SHOPPING_DUPLICATE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'shopping_duplicate_check',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        matches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number', description: '1-based index of matching item in list' },
              matchType: { type: 'string', enum: ['exact', 'semantic', 'variant'] },
              reason: { type: 'string', description: 'Brief Norwegian explanation' },
            },
            required: ['index', 'matchType', 'reason'],
            additionalProperties: false,
          },
        },
        suggestion: {
          type: ['string', 'null'],
          description: 'Optional suggestion for the user in Norwegian',
        },
      },
      required: ['matches', 'suggestion'],
      additionalProperties: false,
    },
  },
}
