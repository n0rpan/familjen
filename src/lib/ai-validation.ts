/**
 * AI-based validation for meal suggestions
 * Uses a second AI call to verify allergen safety and menu quality
 */

import { extractJSON } from './json-extract'
import type { MealSuggestion } from './types'

export interface MealValidationResult {
  isValid: boolean
  issues: MealIssue[]
  validMeals: MealSuggestion[]
  invalidMeals: { meal: MealSuggestion; reason: string }[]
}

export interface MealIssue {
  mealName: string
  day: string
  type: 'allergen' | 'safety' | 'quality' | 'variety'
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
    type: 'allergen' | 'safety' | 'quality' | 'variety'
    reason: string
    ingredient?: string
  }>
  overall_feedback?: string
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

  // Build family description
  const childrenDesc = family.childrenAges.length > 0
    ? family.childrenAges.map((c, i) =>
        family.shareNamesWithAi ? `${c.name} (${c.age} år)` : `Barn ${i + 1} (${c.age} år)`
      ).join(', ')
    : 'ingen barn'

  const familyDesc = `${family.parentCount} voksne og ${family.childrenAges.length} barn (${childrenDesc})`

  // Build meals description
  const mealsDesc = meals.map(m => {
    const ingredients = m.ingredients.map(i => i.item).join(', ')
    const desc = m.description ? ` - "${m.description}"` : ''
    return `- ${m.day}: "${m.name}"${desc}\n  Ingredienser: ${ingredients}`
  }).join('\n')

  const prompt = `Du er en ernæringsekspert som validerer ukemenyer for familier.

FAMILIEN:
- ${familyDesc}
${family.allergies.length > 0 ? `- ALLERGIER (KRITISK): ${family.allergies.join(', ')}` : '- Ingen allergier'}

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

    // Process results
    const issues: MealIssue[] = (parsed.issues || []).map(issue => ({
      mealName: issue.meal_name,
      day: issue.day,
      type: issue.type,
      reason: issue.reason,
      ingredient: issue.ingredient,
    }))

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
