import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserHousehold } from '@/lib/supabase/household'
import { validateOrigin } from '@/lib/config'
import { getCommonItemCategory } from '@/lib/shopping-common-items'
import type { ShoppingCategory } from '@/lib/constants'
import { ApiErrors, handleApiError } from '@/lib/api-errors'

interface ShoppingSuggestion {
  name: string
  quantity: string | null
  reason: string
  category: ShoppingCategory
  source: 'recipe' | 'pattern' | 'staple'
}

export async function GET(request: Request) {
  try {
    // CSRF protection
    if (!validateOrigin(request)) {
      return ApiErrors.invalidOrigin()
    }

    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return ApiErrors.unauthorized()
    }

    // Fetch household
    const { data: household, error: householdError } = await getUserHousehold(supabase)
    if (householdError || !household) {
      return ApiErrors.noHousehold()
    }

    // Get current week's dates
    const today = new Date()
    const dayOfWeek = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
    const weekStart = monday.toISOString().split('T')[0]

    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const weekEnd = sunday.toISOString().split('T')[0]

    // First get the household's shopping lists
    const { data: shoppingLists, error: listsError } = await supabase
      .from('shopping_lists')
      .select('id')
      .eq('household_id', household.id)
      .eq('is_archived', false)

    if (listsError) {
      console.error('Failed to fetch shopping lists:', listsError)
      return NextResponse.json({ suggestions: [], mealsPlanned: 0 })
    }

    const listIds = (shoppingLists || []).map(l => l.id)

    // Now fetch meals and items in parallel (items filtered by list_id for security)
    const [mealsResult, currentItemsResult] = await Promise.all([
      // Get meals for this week with recipes
      supabase
        .from('meals')
        .select('date, custom_meal, recipe:recipes(name, ingredients)')
        .eq('household_id', household.id)
        .gte('date', weekStart)
        .lte('date', weekEnd),
      // Get current shopping list items (not bought) - ONLY from this household's lists
      listIds.length > 0
        ? supabase
            .from('shopping_list_items')
            .select('name, list_id')
            .in('list_id', listIds)
            .eq('is_bought', false)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (mealsResult.error) {
      console.error('Failed to fetch meals:', mealsResult.error)
    }

    // Get current items from the household's lists (already filtered by list_id)
    const currentItems = (currentItemsResult.data || [])
      .map(item => item.name.toLowerCase().trim())

    // Extract ingredients from meals
    const neededIngredients: Map<string, { name: string; amount: string; mealName: string }> = new Map()

    for (const meal of mealsResult.data || []) {
      // Handle recipes with ingredients
      const recipe = Array.isArray(meal.recipe) ? meal.recipe[0] : meal.recipe
      if (recipe?.ingredients) {
        const ingredients = recipe.ingredients as { item: string; amount: string }[]
        for (const ing of ingredients) {
          const key = ing.item.toLowerCase().trim()
          // Skip if already on list
          if (!currentItems.some(item => item.includes(key) || key.includes(item))) {
            if (!neededIngredients.has(key)) {
              neededIngredients.set(key, {
                name: ing.item,
                amount: ing.amount,
                mealName: recipe.name,
              })
            }
          }
        }
      }
    }

    // Build suggestions from recipe ingredients
    const suggestions: ShoppingSuggestion[] = []

    for (const [_key, ing] of neededIngredients) {
      // Get category from common items dictionary
      const category = getCommonItemCategory(ing.name) || 'other'

      suggestions.push({
        name: ing.name,
        quantity: ing.amount || null,
        reason: `Til ${ing.mealName}`,
        category,
        source: 'recipe',
      })

      // Limit to 5 suggestions
      if (suggestions.length >= 5) break
    }

    // Add common staples if we have room and there are meals planned
    if (suggestions.length < 5 && (mealsResult.data?.length || 0) > 0) {
      const staples = [
        { name: 'Melk', category: 'dairy' as ShoppingCategory },
        { name: 'Brød', category: 'pantry' as ShoppingCategory },
        { name: 'Egg', category: 'dairy' as ShoppingCategory },
        { name: 'Smør', category: 'dairy' as ShoppingCategory },
        { name: 'Ost', category: 'dairy' as ShoppingCategory },
      ]

      for (const staple of staples) {
        if (suggestions.length >= 5) break
        const key = staple.name.toLowerCase()
        if (!currentItems.some(item => item.includes(key) || key.includes(item))) {
          suggestions.push({
            name: staple.name,
            quantity: null,
            reason: 'Ofte brukt',
            category: staple.category,
            source: 'staple',
          })
        }
      }
    }

    return NextResponse.json({
      suggestions,
      mealsPlanned: mealsResult.data?.length || 0,
      weekStart,
    })
  } catch (error) {
    return handleApiError(error, 'shopping suggest')
  }
}
