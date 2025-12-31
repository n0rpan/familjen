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
// AI PARENT EXPERIENCE SCHEMAS
// =============================================================================

/**
 * Schema for the AI daily briefing response.
 * Provides proactive insights for busy parents about conflicts, coordination issues,
 * and smart suggestions.
 */
export const DAILY_BRIEFING_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'daily_briefing',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        insights: {
          type: 'array',
          description: 'Proactive insights ordered by priority',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique ID for this insight' },
              type: {
                type: 'string',
                enum: ['conflict', 'coordination', 'reminder', 'suggestion', 'wellness'],
                description: 'Type of insight',
              },
              priority: {
                type: 'string',
                enum: ['critical', 'high', 'normal', 'low'],
              },
              title: { type: 'string', description: 'Short title in Norwegian' },
              description: { type: 'string', description: 'Detailed explanation in Norwegian' },
              date: { type: 'string', description: 'Relevant date YYYY-MM-DD' },
              affected_people: {
                type: 'array',
                items: { type: 'string' },
                description: 'Names of affected children/members',
              },
              suggested_action: {
                type: ['string', 'null'],
                description: 'What the parent could do to resolve this',
              },
              icon: { type: 'string', description: 'Emoji icon for this insight' },
            },
            required: ['id', 'type', 'priority', 'title', 'description', 'date', 'affected_people', 'icon'],
            additionalProperties: false,
          },
        },
        daily_summary: {
          type: 'string',
          description: 'A friendly 1-2 sentence summary of the day/week status for busy parents',
        },
        week_load_score: {
          type: 'number',
          description: 'Score 1-10 indicating how busy/complex the week is (10=very busy)',
        },
        pickup_patterns: {
          type: 'array',
          description: 'Detected patterns in pickup assignments for suggestions',
          items: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Description of the pattern' },
              confidence: { type: 'number', description: '0-1 confidence score' },
            },
            required: ['pattern', 'confidence'],
            additionalProperties: false,
          },
        },
      },
      required: ['insights', 'daily_summary', 'week_load_score', 'pickup_patterns'],
      additionalProperties: false,
    },
  },
}

/**
 * Schema for week context parsing.
 * Extracts actionable items from free-text week context.
 */
export const WEEK_CONTEXT_PARSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'week_context_parsed',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        extracted_events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['member_unavailable', 'child_event', 'household_event', 'reminder'],
              },
              title: { type: 'string' },
              date: { type: ['string', 'null'], description: 'YYYY-MM-DD if specified' },
              end_date: { type: ['string', 'null'] },
              time: { type: ['string', 'null'], description: 'HH:MM if specified' },
              member_name: { type: ['string', 'null'] },
              child_name: { type: ['string', 'null'] },
              affects_pickups: { type: 'boolean', description: 'True if this affects pickup availability' },
            },
            required: ['type', 'title', 'affects_pickups'],
            additionalProperties: false,
          },
        },
        availability_constraints: {
          type: 'array',
          description: 'Days when certain members are unavailable',
          items: {
            type: 'object',
            properties: {
              member_name: { type: 'string' },
              dates: {
                type: 'array',
                items: { type: 'string', description: 'YYYY-MM-DD' },
              },
              reason: { type: 'string' },
            },
            required: ['member_name', 'dates', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['extracted_events', 'availability_constraints'],
      additionalProperties: false,
    },
  },
}

/**
 * Schema for parent handoff summary.
 * Generates a summary when one parent hands off to another.
 */
export const HANDOFF_SUMMARY_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'handoff_summary',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of what the other parent needs to know',
        },
        urgent_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              deadline: { type: ['string', 'null'] },
              child_name: { type: ['string', 'null'] },
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
        today_tasks: {
          type: 'array',
          items: { type: 'string' },
        },
        special_notes: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['summary', 'urgent_items', 'today_tasks', 'special_notes'],
      additionalProperties: false,
    },
  },
}
