import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { MealSuggestion } from '@/lib/types'
import { aiSuggestRequestSchema, validateRequest } from '@/lib/schemas'
import { checkRateLimit, createRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'

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
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 })
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey(user.id, 'aiSuggest')
    const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.aiSuggest)
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

    const model = modelSetting?.value || 'anthropic/claude-3.5-sonnet'

    // Fetch household data
    const { data: household, error: householdError } = await supabase
      .from('households')
      .select('id, ai_meal_context')
      .single()

    if (householdError || !household) {
      return NextResponse.json({ error: 'Kunne ikke finne husstand' }, { status: 404 })
    }

    // Fetch all context data in parallel
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const weekEndStr = weekEnd.toISOString().split('T')[0]

    // Get recent meals (last 2 weeks) to avoid repetition
    const twoWeeksAgo = new Date(weekStart)
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0]

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

    // Process children's ages and allergies
    const childrenAges: { name: string; age: number; allergies: string[] }[] = []
    const allAllergiesSet = new Set<string>()
    if (childrenResult.data) {
      for (const child of childrenResult.data) {
        const allergies = (child.allergies as string[]) || []
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
        const allergies = (member.allergies as string[]) || []
        allergies.forEach(a => allAllergiesSet.add(a.toLowerCase()))
      }
    }

    const allAllergies = Array.from(allAllergiesSet)

    // Get recipes
    const recipes = recipesResult.data || []
    const favoriteRecipes = recipes.filter(r => r.is_favorite)
    const quickRecipes = recipes.filter(r => r.is_quick)

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

    // Get week-specific context
    const weekContext = weekContextResult.data?.context || null

    // Determine which days need suggestions
    const daysNeedingSuggestions: { date: string; partial?: string }[] = []
    const startDate = new Date(weekStart)

    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate)
      date.setDate(date.getDate() + i)
      const dateStr = date.toISOString().split('T')[0]

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

    // Build the prompt
    const season = getNorwegianSeason()
    const prompt = buildPrompt({
      daysNeedingSuggestions,
      childrenAges,
      recipes,
      favoriteRecipes,
      quickRecipes,
      recentMealNames,
      holidays,
      defaultContext: household.ai_meal_context,
      weekContext,
      season,
      allAllergies,
    })

    // Call OpenRouter API
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenRouter API-nøkkel ikke konfigurert' }, { status: 500 })
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
        temperature: 0.7,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenRouter error:', errorText)
      return NextResponse.json({ error: 'Kunne ikke få AI-forslag' }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: 'Tomt svar fra AI' }, { status: 500 })
    }

    // Parse the JSON response
    try {
      // Extract JSON from potential markdown code blocks
      let jsonContent = content
      if (content.includes('```json')) {
        jsonContent = content.split('```json')[1].split('```')[0].trim()
      } else if (content.includes('```')) {
        jsonContent = content.split('```')[1].split('```')[0].trim()
      }

      const parsed = JSON.parse(jsonContent)
      const suggestions: MealSuggestion[] = parsed.suggestions || []

      return NextResponse.json({ suggestions })
    } catch (parseError) {
      console.error('Failed to parse AI response:', content)
      return NextResponse.json({ error: 'Kunne ikke tolke AI-svar' }, { status: 500 })
    }
  } catch (error) {
    console.error('Suggest meals error:', error)
    return NextResponse.json({ error: 'En feil oppstod' }, { status: 500 })
  }
}

interface PromptContext {
  daysNeedingSuggestions: { date: string; partial?: string }[]
  childrenAges: { name: string; age: number; allergies: string[] }[]
  recipes: { id: string; name: string; is_favorite: boolean; is_quick: boolean; is_kid_friendly: boolean }[]
  favoriteRecipes: { name: string }[]
  quickRecipes: { name: string }[]
  recentMealNames: string[]
  holidays: { date: string; name: string }[]
  defaultContext: string | null
  weekContext: string | null
  season: string
  allAllergies: string[]  // Combined list of all allergies
}

function buildPrompt(context: PromptContext): string {
  const {
    daysNeedingSuggestions,
    childrenAges,
    recipes,
    favoriteRecipes,
    recentMealNames,
    holidays,
    defaultContext,
    weekContext,
    season,
    allAllergies,
  } = context

  let prompt = `Foreslå middager for følgende dager:\n\n`

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

  // Allergies - IMPORTANT, put early in prompt
  if (allAllergies.length > 0) {
    prompt += `\n**VIKTIG - Allergier/diettrestriksjoner (UNNGÅ disse ingrediensene):**\n`
    prompt += allAllergies.join(', ') + '\n'
  }

  // Children info
  if (childrenAges.length > 0) {
    prompt += `\n**Barn i familien:**\n`
    for (const child of childrenAges) {
      let childInfo = `- ${child.name}: ${child.age} år`
      if (child.allergies.length > 0) {
        childInfo += ` (allergisk mot: ${child.allergies.join(', ')})`
      }
      prompt += childInfo + '\n'
    }
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

  return prompt
}
