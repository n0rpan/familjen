/**
 * AI-based validation for meal suggestions
 * Uses a second AI call to verify allergen safety and menu quality
 */

import { extractJSON } from './json-extract'
import { sanitizePromptInput, sanitizePromptArray } from './sanitize'
import { MEAL_VALIDATION_SCHEMA } from './ai-schemas'
import type { MealSuggestion } from './types'

/** Valid issue types for meal validation */
const VALID_ISSUE_TYPES = ['allergen', 'safety', 'quality', 'variety'] as const
type IssueType = typeof VALID_ISSUE_TYPES[number]

export interface MealValidationResult {
  isValid: boolean
  issues: MealIssue[]
  validMeals: MealSuggestion[]
  invalidMeals: { meal: MealSuggestion; reason: string }[]
}

export interface MealIssue {
  mealName: string
  day: string
  type: IssueType
  reason: string
  ingredient?: string
}

export interface FamilyContext {
  allergies: string[]
  childrenAges: { name: string; age: number }[]
  parentCount: number
  shareNamesWithAi: boolean
}

interface ValidationResponse {
  valid_meals: string[]  // List of days that are OK
  issues: Array<{
    day: string
    meal_name: string
    type: string  // Validated against VALID_ISSUE_TYPES at runtime
    reason: string
    ingredient?: string
  }>
  overall_feedback?: string
}

/** Check if a string is a valid issue type */
function isValidIssueType(type: string): type is IssueType {
  return VALID_ISSUE_TYPES.includes(type as IssueType)
}

/**
 * Validates meal suggestions using AI to check for:
 * - Food safety (real, edible food - not fictional or non-food items)
 * - Allergen safety (semantic understanding, not keyword matching)
 * - Menu variety (not too repetitive)
 * - Family appropriateness (kid-friendly, balanced for family size)
 */
export async function validateMealSuggestions(
  meals: MealSuggestion[],
  family: FamilyContext,
  model: string
): Promise<MealValidationResult> {
  if (meals.length === 0) {
    return { isValid: true, issues: [], validMeals: [], invalidMeals: [] }
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.warn('[AI Validation] No API key, skipping validation')
    return { isValid: true, issues: [], validMeals: meals, invalidMeals: [] }
  }

  // Build family description (sanitize names to prevent prompt injection)
  const childrenDesc = family.childrenAges.length > 0
    ? family.childrenAges.map((c, i) => {
        const safeName = family.shareNamesWithAi ? sanitizePromptInput(c.name, 50) : `Barn ${i + 1}`
        return `${safeName} (${c.age} år)`
      }).join(', ')
    : 'ingen barn'

  const familyDesc = `${family.parentCount} voksne og ${family.childrenAges.length} barn (${childrenDesc})`

  // Sanitize allergies to prevent prompt injection
  const sanitizedAllergies = sanitizePromptArray(family.allergies)

  // Build meals description
  const mealsDesc = meals.map(m => {
    const ingredients = m.ingredients.map(i => i.item).join(', ')
    const desc = m.description ? ` - "${m.description}"` : ''
    return `- ${m.day}: "${m.name}"${desc}\n  Ingredienser: ${ingredients}`
  }).join('\n')

  const prompt = `Du er en ernæringsekspert som validerer ukemenyer for familier.

FAMILIEN:
- ${familyDesc}
${sanitizedAllergies.length > 0 ? `- ALLERGIER (KRITISK): ${sanitizedAllergies.join(', ')}` : '- Ingen allergier'}

FORESLÅTT MENY:
${mealsDesc}

VALIDER MENYEN:

1. SIKKERHET (KRITISK - null toleranse):
   - Avvis retter som IKKE er ekte, spiselig mat
   - Alle ingredienser må være reelle matvarer du kan kjøpe i en butikk
   - Avvis: fiktive retter, tullenavn, ikke-spiselige ting, farlige ingredienser

2. ALLERGENER (KRITISK - null toleranse):
   - Sjekk ALLE ingredienser for allergener
   - "Kokosmelk" er TRYGT for melkeallergi (ikke meieri)
   - "Muskatnøtt" er TRYGT for nøtteallergi (ikke en trenøtt)
   - "Laktosefri melk" er IKKE trygt for melkeallergi (fortsatt meieri)
   - Sjekk også skjulte allergener (majones = egg, parmesan = melk, etc.)

3. VARIASJON:
   - Er det god variasjon i proteiner (kylling, fisk, kjøtt, vegetar)?
   - Ikke for mange like retter samme uke

4. FAMILIEVENNLIGHET:
   - Passer rettene for barn i de angitte aldrene?
   - Er porsjonene/oppskriftene passende for familiestørrelsen?

Svar BARE med gyldig JSON (ingen markdown):
{
  "valid_meals": ["YYYY-MM-DD", ...],
  "issues": [
    {
      "day": "YYYY-MM-DD",
      "meal_name": "navn",
      "type": "allergen|safety|quality|variety",
      "reason": "kort forklaring",
      "ingredient": "problematisk ingrediens eller null"
    }
  ],
  "overall_feedback": "kort oppsummering av menyen (valgfritt)"
}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        'X-Title': 'Familjen Validation',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0, // Deterministic for safety
        max_tokens: 500,
        response_format: MEAL_VALIDATION_SCHEMA,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error('[AI Validation] API error:', response.status)
      // On API error, return meals as-is (fail open, but log)
      return { isValid: true, issues: [], validMeals: meals, invalidMeals: [] }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      console.warn('[AI Validation] Empty response')
      return { isValid: true, issues: [], validMeals: meals, invalidMeals: [] }
    }

    const parsed = extractJSON<ValidationResponse>(content)
    if (!parsed) {
      console.warn('[AI Validation] Could not parse response')
      return { isValid: true, issues: [], validMeals: meals, invalidMeals: [] }
    }

    // Process results (validate issue types, treat unknown types as 'safety' to be cautious)
    const issues: MealIssue[] = (parsed.issues || []).map(issue => {
      const validType = isValidIssueType(issue.type) ? issue.type : 'safety'
      if (!isValidIssueType(issue.type)) {
        console.warn(`[AI Validation] Unknown issue type "${issue.type}", treating as safety issue`)
      }
      return {
        mealName: issue.meal_name,
        day: issue.day,
        type: validType,
        reason: issue.reason,
        ingredient: issue.ingredient,
      }
    })

    // Separate valid and invalid meals
    // Only allergen and safety issues cause rejection; quality/variety are warnings
    const criticalDays = new Set(
      issues.filter(i => i.type === 'allergen' || i.type === 'safety').map(i => i.day)
    )

    const validMeals = meals.filter(m => !criticalDays.has(m.day))
    const invalidMeals = meals
      .filter(m => criticalDays.has(m.day))
      .map(m => ({
        meal: m,
        reason: issues.find(i => i.day === m.day && (i.type === 'allergen' || i.type === 'safety'))?.reason || 'Safety or allergen issue',
      }))

    if (parsed.overall_feedback) {
      console.log('[AI Validation] Feedback:', parsed.overall_feedback)
    }

    if (invalidMeals.length > 0) {
      console.warn('[AI Validation] Removed unsafe/allergenic meals:',
        invalidMeals.map(m => `${m.meal.name} (${m.reason})`).join(', ')
      )
    }

    return {
      isValid: invalidMeals.length === 0,
      issues,
      validMeals,
      invalidMeals,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[AI Validation] Request timed out')
    } else {
      console.error('[AI Validation] Error:', error)
    }
    // Fail open on errors - return meals as-is
    return { isValid: true, issues: [], validMeals: meals, invalidMeals: [] }
  }
}
