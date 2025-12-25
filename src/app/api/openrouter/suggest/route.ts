import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserHousehold } from '@/lib/supabase/household'
import { validateOrigin } from '@/lib/config'
import type { MealSuggestion } from '@/lib/types'
import { aiSuggestRequestSchema, validateRequest } from '@/lib/schemas'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'
import { extractJSON } from '@/lib/json-extract'
import { formatDateISO } from '@/lib/utils'
import { validateMealSuggestions } from '@/lib/ai-validation'
import { sanitizePromptInput, sanitizePromptArray } from '@/lib/sanitize'
import { MEAL_SUGGESTION_SCHEMA } from '@/lib/ai-schemas'

// Helper to calculate age from birth date
function calculateAge(birthDate: string): number {
  const today = new Date()
  const birth = new Date(birthDate)
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

// Helper to determine season in Norway
function getNorwegianSeason(): string {
  const month = new Date().getMonth() + 1 // 1-12
  if (month >= 3 && month <= 5) return 'vår'
  if (month >= 6 && month <= 8) return 'sommer'
  if (month >= 9 && month <= 11) return 'høst'
  return 'vinter'
}

export async function POST(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }

    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 })
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'aiSuggest')
    const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMITS.aiSuggest)
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: `For mange forespørsler. Prøv igjen om ${rateLimit.retryAfter} sekunder.` },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    // Validate request body
    const validation = await validateRequest(request, aiSuggestRequestSchema)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { weekStart, existingMeals } = validation.data

    // Fetch model from app_settings
    const { data: modelSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'openrouter_model')
      .single()

    const model = modelSetting?.value || 'google/gemini-2.5-flash-lite'

    // Fetch household data (using safe multi-row handler)
    const { data: household, error: householdError } = await getUserHousehold(supabase)

    if (householdError || !household) {
      return NextResponse.json({ error: 'Kunne ikke finne husstand' }, { status: 404 })
    }

    // Fetch all context data in parallel
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    // Use formatDateISO for local timezone handling (not UTC)
    const weekEndStr = formatDateISO(weekEnd)

    // Get recent meals (last 2 weeks) to avoid repetition
    const twoWeeksAgo = new Date(weekStart)
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    const twoWeeksAgoStr = formatDateISO(twoWeeksAgo)

    const [
      childrenResult,
      membersResult,
      recipesResult,
      recentMealsResult,
      holidaysResult,
      weekContextResult,
    ] = await Promise.all([
      supabase.from('children').select('name, birth_date, allergies').eq('household_id', household.id),
      supabase.from('household_members').select('name, birth_date, allergies, is_parent').eq('household_id', household.id).eq('is_parent', true),
      supabase.from('recipes').select('id, name, is_favorite, is_quick, is_kid_friendly').eq('household_id', household.id),
      supabase.from('meals').select('date, custom_meal, recipe:recipes(name)').eq('household_id', household.id).gte('date', twoWeeksAgoStr).lt('date', weekStart).order('date', { ascending: false }),
      supabase.from('calendar_events').select('date, name').or(`household_id.eq.${household.id},household_id.is.null`).gte('date', weekStart).lte('date', weekEndStr).eq('event_type', 'holiday'),
      supabase.from('week_contexts').select('context').eq('household_id', household.id).eq('week_start', weekStart).maybeSingle(),
    ])

    // Process children's ages and allergies (sanitized to prevent prompt injection)
    const childrenAges: { name: string; age: number; allergies: string[] }[] = []
    const allAllergiesSet = new Set<string>()
    if (childrenResult.data) {
      for (const child of childrenResult.data) {
        const rawAllergies = (child.allergies as string[]) || []
        const allergies = sanitizePromptArray(rawAllergies)
        // Add to combined set
        allergies.forEach(a => allAllergiesSet.add(a.toLowerCase()))
        if (child.birth_date) {
          childrenAges.push({
            name: child.name,
            age: calculateAge(child.birth_date),
            allergies,
          })
        }
      }
    }

    // Also add allergies from household members (parents)
    if (membersResult.data) {
      for (const member of membersResult.data) {
        const rawAllergies = (member.allergies as string[]) || []
        const allergies = sanitizePromptArray(rawAllergies)
        allergies.forEach(a => allAllergiesSet.add(a.toLowerCase()))
      }
    }

    const allAllergies = Array.from(allAllergiesSet)

    // Get recipes
    const recipes = recipesResult.data || []
    const favoriteRecipes = recipes.filter(r => r.is_favorite)

    // Get recent meals for context
    const recentMealNames = (recentMealsResult.data || [])
      .map((m) => {
        // Supabase returns relations as arrays or objects depending on the query
        const recipeName = Array.isArray(m.recipe)
          ? m.recipe[0]?.name
          : (m.recipe as { name: string } | null)?.name
        return recipeName || m.custom_meal
      })
      .filter(Boolean) as string[]

    // Get holidays for the week
    const holidays = (holidaysResult.data || []).map(h => ({ date: h.date, name: h.name }))

    // Get week-specific context (sanitized to prevent prompt injection)
    const weekContext = weekContextResult.data?.context
      ? sanitizePromptInput(weekContextResult.data.context, 500)
      : null

    // Determine which days need suggestions
    const daysNeedingSuggestions: { date: string; partial?: string }[] = []
    const startDate = new Date(weekStart)

    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate)
      date.setDate(date.getDate() + i)
      const dateStr = formatDateISO(date)

      const existingMeal = existingMeals.find(m => m.date === dateStr)

      // Weekend days (Saturday = 5, Sunday = 6 in getDay() when Monday is start)
      const dayOfWeek = date.getDay()
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

      if (!existingMeal?.name || existingMeal.name.length < 3) {
        // Empty or very short - needs full suggestion
        if (!isWeekend) { // Skip weekends by default
          daysNeedingSuggestions.push({ date: dateStr })
        }
      } else if (existingMeal.name.length < 15) {
        // Short entry like "kylling" or "fisk" - enhance it
        daysNeedingSuggestions.push({ date: dateStr, partial: existingMeal.name })
      }
    }

    if (daysNeedingSuggestions.length === 0) {
      return NextResponse.json({ suggestions: [] })
    }

    // Check API key early
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenRouter API-nøkkel ikke konfigurert' }, { status: 500 })
    }

    // Prepare context for generation
    const season = getNorwegianSeason()
    const parentCount = membersResult.data?.length || 2
    const familyContext = {
      allergies: allAllergies,
      childrenAges: childrenAges.map(c => ({ name: c.name, age: c.age })),
      parentCount,
      shareNamesWithAi: household.share_names_with_ai ?? true,
    }

    // Generate-validate-retry loop
    const MAX_RETRIES = 3
    let validatedMeals: MealSuggestion[] = []
    let pendingDays = [...daysNeedingSuggestions]
    let failedMeals: { day: string; reason: string }[] = []

    for (let attempt = 0; attempt < MAX_RETRIES && pendingDays.length > 0; attempt++) {
      if (attempt > 0) {
        console.log(`[Suggest] Retry ${attempt}/${MAX_RETRIES} for ${pendingDays.length} days`)
      }

      // Build prompt (include failure reasons on retry)
      const prompt = buildPrompt({
        daysNeedingSuggestions: pendingDays,
        childrenAges,
        parentCount,
        recipes,
        favoriteRecipes,
        recentMealNames,
        holidays,
        defaultContext: household.ai_meal_context ? sanitizePromptInput(household.ai_meal_context, 500) : null,
        weekContext,
        season,
        allAllergies,
        shareNamesWithAi: household.share_names_with_ai ?? true,
        failedMeals: attempt > 0 ? failedMeals : undefined,
      })

      // Call OpenRouter API
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)

      let response: Response
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
            'X-Title': 'Familjen',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: `Du er en hjelpsom assistent for norsk familieplanlegging. Du foreslår middager som er:
- Enkle å lage (få ingredienser, kort tilberedningstid)
- Barnevennlige (passer for barn i alle aldre)
- Proteinrike og næringsrike
- Varierte gjennom uken
- Sesongbaserte når mulig

KRITISK VIKTIG: Hvis familien har allergier eller matrestriksjoner, må du ALDRI foreslå retter som inneholder disse ingrediensene. Dette er et helsekrav.

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

Ikke inkluder noe annet enn JSON i svaret.`,
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.4,
            max_tokens: 2000,
            response_format: MEAL_SUGGESTION_SCHEMA,
          }),
          signal: controller.signal,
        })
      } catch (fetchError) {
        clearTimeout(timeoutId)
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          console.error('OpenRouter request timed out')
          return NextResponse.json({ error: 'AI-forespørselen tok for lang tid' }, { status: 504 })
        }
        throw fetchError
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) {
        console.error('OpenRouter error:', { status: response.status, statusText: response.statusText })
        return NextResponse.json({ error: 'Kunne ikke få AI-forslag' }, { status: 500 })
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content

      if (!content) {
        console.warn('[Suggest] Empty response on attempt', attempt + 1)
        continue // Try again
      }

      // Parse the JSON response
      const parsed = extractJSON<{ suggestions?: MealSuggestion[] }>(content)
      if (!parsed || !parsed.suggestions) {
        console.warn('[Suggest] Could not parse response on attempt', attempt + 1)
        continue // Try again
      }

      const newSuggestions = parsed.suggestions

      // Validate the new suggestions
      const validation = await validateMealSuggestions(newSuggestions, familyContext, model)

      // Add valid meals to our collection
      validatedMeals = [...validatedMeals, ...validation.validMeals]

      // Log quality issues as warnings
      const qualityIssues = validation.issues.filter(i => i.type !== 'allergen' && i.type !== 'safety')
      if (qualityIssues.length > 0) {
        console.log('[Menu Quality]', qualityIssues.map(i => `${i.mealName}: ${i.reason}`).join(', '))
      }

      // Check if any meals failed validation
      if (validation.invalidMeals.length > 0) {
        // Prepare for retry: only regenerate failed days
        failedMeals = validation.invalidMeals.map(m => ({
          day: m.meal.day,
          reason: m.reason,
        }))
        const failedDays = new Set(failedMeals.map(m => m.day))
        pendingDays = pendingDays.filter(d => failedDays.has(d.date))

        console.warn(`[Suggest] ${validation.invalidMeals.length} meals rejected:`,
          validation.invalidMeals.map(m => `${m.meal.name} (${m.reason})`).join(', ')
        )
      } else {
        // All meals passed validation - we're done!
        pendingDays = []
      }
    }

    // Log if we gave up on some days
    if (pendingDays.length > 0) {
      console.error(`[Suggest] Failed to generate valid meals for ${pendingDays.length} days after ${MAX_RETRIES} attempts`)
    }

    return NextResponse.json({ suggestions: validatedMeals })
  } catch (error) {
    console.error('Suggest meals error:', error)
    return NextResponse.json({ error: 'En feil oppstod' }, { status: 500 })
  }
}

interface PromptContext {
  daysNeedingSuggestions: { date: string; partial?: string }[]
  childrenAges: { name: string; age: number; allergies: string[] }[]
  parentCount: number  // Number of adults in household
  recipes: { id: string; name: string; is_favorite: boolean; is_quick: boolean; is_kid_friendly: boolean }[]
  favoriteRecipes: { name: string }[]
  recentMealNames: string[]
  holidays: { date: string; name: string }[]
  defaultContext: string | null
  weekContext: string | null
  season: string
  allAllergies: string[]  // Combined list of all allergies
  shareNamesWithAi: boolean  // When false, anonymize children names
  failedMeals?: { day: string; reason: string }[]  // For retry: why previous suggestions failed
}

function buildPrompt(context: PromptContext): string {
  const {
    daysNeedingSuggestions,
    childrenAges,
    parentCount,
    recipes,
    favoriteRecipes,
    recentMealNames,
    holidays,
    defaultContext,
    weekContext,
    season,
    allAllergies,
    shareNamesWithAi,
    failedMeals,
  } = context

  let prompt = `Foreslå middager for følgende dager:\n\n`

  // If this is a retry, explain why previous suggestions failed
  if (failedMeals && failedMeals.length > 0) {
    prompt = `VIKTIG: Forrige forslag ble avvist. Prøv på nytt med andre retter.\n\n`
    prompt += `Avviste retter:\n`
    for (const failed of failedMeals) {
      prompt += `- ${failed.day}: ${failed.reason}\n`
    }
    prompt += `\nForeslå NYE middager for følgende dager:\n\n`
  }

  // Days needing suggestions
  for (const day of daysNeedingSuggestions) {
    const date = new Date(day.date)
    const dayName = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'][date.getDay()]
    const holiday = holidays.find(h => h.date === day.date)

    prompt += `- ${dayName} ${date.getDate()}.${date.getMonth() + 1}`
    if (holiday) prompt += ` (${holiday.name})`
    if (day.partial) prompt += ` - har skrevet "${day.partial}", foreslå en konkret rett med dette`
    prompt += '\n'
  }

  prompt += `\n**Sesong:** ${season}\n`

  // Family size - important for portion sizes
  const totalPeople = parentCount + childrenAges.length
  prompt += `\n**Familiestørrelse:** ${parentCount} voksne + ${childrenAges.length} barn = ${totalPeople} personer\n`

  // Allergies - IMPORTANT, put early in prompt
  if (allAllergies.length > 0) {
    prompt += `\n**VIKTIG - Allergier/diettrestriksjoner (UNNGÅ disse ingrediensene):**\n`
    prompt += allAllergies.join(', ') + '\n'
  }

  // Children info (anonymize if shareNamesWithAi is false)
  if (childrenAges.length > 0) {
    prompt += `\n**Barn i familien:**\n`
    childrenAges.forEach((child, index) => {
      const displayName = shareNamesWithAi ? child.name : `Barn ${index + 1}`
      let childInfo = `- ${displayName}: ${child.age} år`
      if (child.allergies.length > 0) {
        childInfo += ` (allergisk mot: ${child.allergies.join(', ')})`
      }
      prompt += childInfo + '\n'
    })
  }

  // Favorite recipes
  if (favoriteRecipes.length > 0) {
    prompt += `\n**Familiens favoritter (kan gjerne foreslås):**\n`
    prompt += favoriteRecipes.map(r => r.name).join(', ') + '\n'
  }

  // Existing recipes
  if (recipes.length > 0) {
    prompt += `\n**Oppskrifter familien har fra før:**\n`
    prompt += recipes.map(r => r.name).slice(0, 20).join(', ') + '\n'
  }

  // Recent meals to avoid
  if (recentMealNames.length > 0) {
    prompt += `\n**Nylige middager (unngå gjentakelse):**\n`
    prompt += recentMealNames.slice(0, 10).join(', ') + '\n'
  }

  // Default preferences
  if (defaultContext) {
    prompt += `\n**Familiens preferanser:**\n${defaultContext}\n`
  }

  // Week-specific context
  if (weekContext) {
    prompt += `\n**Spesielt for denne uken:**\n${weekContext}\n`
  }

  prompt += `\n**Viktig:**
- Forslagene skal være enkle med få ingredienser
- Barna skal like maten
- Fokuser på protein
- Varier mellom ulike proteiner (kylling, fisk, kjøtt, vegetar)
- Ta hensyn til sesongen og eventuelle helligdager`

  // Reinforce allergies at the end (AI pays more attention to end of prompt)
  if (allAllergies.length > 0) {
    prompt += `\n\n**PÅMINNELSE - UNNGÅ DISSE INGREDIENSENE (allergier):** ${allAllergies.join(', ')}`
  }

  return prompt
}
