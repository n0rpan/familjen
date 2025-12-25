/**
 * Shared JSON schemas for OpenRouter structured outputs.
 * These ensure consistent, parseable responses from AI calls.
 *
 * @see https://openrouter.ai/docs/guides/features/structured-outputs
 */

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

/**
 * Schema for quick meal suggestions (from parse-action suggest mode).
 * Simpler than full meal suggestion schema.
 */
export const QUICK_MEAL_SUGGEST_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'quick_meal_suggestions',
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
              name: { type: 'string' },
              description: { type: 'string' },
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
            },
            required: ['day', 'name', 'description', 'ingredients'],
            additionalProperties: false,
          },
        },
      },
      required: ['suggestions'],
      additionalProperties: false,
    },
  },
}
