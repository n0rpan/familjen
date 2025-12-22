'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Recipe, Household } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'
import { RecipesPagePartialSkeleton } from '@/components/Skeleton'

export default function RecipesPage() {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [household, setHousehold] = useState<Household | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [newRecipe, setNewRecipe] = useState({
    name: '',
    instructions: '',
    external_link: '',
    is_quick: false,
    is_kid_friendly: true,
  })
  const [ingredients, setIngredients] = useState<{ item: string; amount: string }[]>([])
  const [newIngredient, setNewIngredient] = useState({ item: '', amount: '' })
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | 'favorites'>('all')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      // First get user's membership to find their specific household
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error(t.errors.unauthorized)
      }

      const { data: membership } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!membership) {
        setHousehold(null)
        setRecipes([])
        setLoading(false)
        return
      }

      // Now fetch household by ID and recipes in parallel
      const [householdResult, recipesResult] = await Promise.all([
        supabase.from('households').select('id, name, ai_meal_context, share_names_with_ai, external_integrations_enabled, created_at').eq('id', membership.household_id).single(),
        supabase.from('recipes').select('*').eq('household_id', membership.household_id).order('name'),
      ])

      if (householdResult.error) {
        throw new Error(t.errors.couldNotLoadHousehold)
      }
      if (recipesResult.error) {
        throw new Error(t.errors.couldNotLoadRecipes)
      }

      setHousehold(householdResult.data)
      setRecipes(recipesResult.data || [])
    } catch (err) {
      console.error('Recipes page error:', err)
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRecipe.name || !household) return

    setSaving(true)

    await supabase.from('recipes').insert({
      household_id: household.id,
      name: newRecipe.name,
      instructions: newRecipe.instructions || null,
      external_link: newRecipe.external_link || null,
      is_quick: newRecipe.is_quick,
      is_kid_friendly: newRecipe.is_kid_friendly,
      ingredients: ingredients.length > 0 ? ingredients : null,
    })

    setNewRecipe({
      name: '',
      instructions: '',
      external_link: '',
      is_quick: false,
      is_kid_friendly: true,
    })
    setIngredients([])
    setNewIngredient({ item: '', amount: '' })
    setShowForm(false)
    await loadData()
    setSaving(false)
  }

  const addIngredient = () => {
    if (!newIngredient.item.trim()) return
    setIngredients([...ingredients, { item: newIngredient.item.trim(), amount: newIngredient.amount.trim() }])
    setNewIngredient({ item: '', amount: '' })
  }

  const removeIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index))
  }

  const deleteRecipe = async (id: string) => {
    if (!confirm(t.recipes.deleteRecipeConfirm.replace('{name}', ''))) return

    await supabase.from('recipes').delete().eq('id', id)
    loadData()
  }

  const toggleFavorite = async (id: string, currentValue: boolean) => {
    await supabase.from('recipes').update({ is_favorite: !currentValue }).eq('id', id)
    // Optimistic update
    setRecipes(recipes.map(r => r.id === id ? { ...r, is_favorite: !currentValue } : r))
  }

  const addToShoppingList = async (recipe: Recipe) => {
    if (!recipe.ingredients || recipe.ingredients.length === 0) {
      setMessage({ type: 'error', text: t.errors.generic })
      setTimeout(() => setMessage(null), 3000)
      return
    }
    if (!household) return

    // Get or create the shopping list
    let { data: lists } = await supabase
      .from('shopping_lists')
      .select('id')
      .eq('household_id', household.id)
      .limit(1)
      .single()

    if (!lists) {
      // Create the list if it doesn't exist
      const { data: newList } = await supabase
        .from('shopping_lists')
        .insert({ household_id: household.id, name: t.nav.shoppingList, sort_order: 0 })
        .select('id')
        .single()
      lists = newList
    }

    if (!lists) {
      setMessage({ type: 'error', text: t.errors.saveFailed })
      setTimeout(() => setMessage(null), 3000)
      return
    }

    // Add all ingredients to the list
    const items = recipe.ingredients.map(ing => ({
      list_id: lists.id,
      name: ing.item,
      quantity: ing.amount,
      source_recipe_id: recipe.id,
    }))

    const { error } = await supabase.from('shopping_list_items').insert(items)

    if (error) {
      setMessage({ type: 'error', text: t.errors.saveFailed })
    } else {
      setMessage({ type: 'success', text: t.success.saved })
    }
    setTimeout(() => setMessage(null), 3000)
  }

  // Filter and sort recipes (favorites first)
  const displayedRecipes = recipes
    .filter(r => filter === 'all' || r.is_favorite)
    .sort((a, b) => {
      if (a.is_favorite && !b.is_favorite) return -1
      if (!a.is_favorite && b.is_favorite) return 1
      return a.name.localeCompare(b.name, 'nb')
    })

  // Only show skeleton if loading AND no cached data yet
  if (loading && !household) {
    return <RecipesPagePartialSkeleton t={t} />
  }

  if (error) {
    return (
      <div className="space-y-8 animate-fade-in">
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
            style={{ background: 'rgba(232, 120, 109, 0.15)' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h2 className="text-2xl font-semibold font-display mb-3" style={{ color: 'var(--foreground)' }}>
            {error}
          </h2>
          <p className="mb-8" style={{ color: 'var(--muted)' }}>
            {t.errors.generic}
          </p>
          <button onClick={loadData} className="btn btn-primary">
            {t.common.retry}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Toast message */}
      {message && (
        <div
          className="fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg animate-slide-up"
          style={{
            background: message.type === 'success' ? 'var(--color-sage)' : 'var(--color-coral)',
            color: 'white',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.recipes.title}
          </h1>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            {t.recipes.noRecipesDesc}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn btn-primary self-start sm:self-auto"
        >
          {showForm ? t.common.cancel : `+ ${t.recipes.addRecipe}`}
        </button>
      </div>

      {/* Filter tabs */}
      {recipes.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              background: filter === 'all' ? 'var(--accent)' : 'var(--card)',
              color: filter === 'all' ? 'white' : 'var(--muted)',
              border: filter === 'all' ? 'none' : '1px solid var(--border)',
            }}
          >
            {t.common.search} ({recipes.length})
          </button>
          <button
            onClick={() => setFilter('favorites')}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2"
            style={{
              background: filter === 'favorites' ? 'var(--color-coral)' : 'var(--card)',
              color: filter === 'favorites' ? 'white' : 'var(--muted)',
              border: filter === 'favorites' ? 'none' : '1px solid var(--border)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={filter === 'favorites' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            {t.recipes.isFavorite} ({recipes.filter(r => r.is_favorite).length})
          </button>
        </div>
      )}

      {/* Add recipe form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-6 md:p-8 space-y-5 animate-fade-in"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(229, 185, 94, 0.2)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14"/>
                <path d="M5 12h14"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
              {t.recipes.addRecipe}
            </h2>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.recipes.recipeName} *
            </label>
            <input
              type="text"
              value={newRecipe.name}
              onChange={(e) => setNewRecipe({ ...newRecipe, name: e.target.value })}
              placeholder={t.recipes.recipeName}
              className="input"
              required
            />
          </div>

          {/* Ingredients section */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.recipes.ingredients}
            </label>

            {/* Current ingredients list */}
            {ingredients.length > 0 && (
              <div className="space-y-2 mb-3">
                {ingredients.map((ing, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: 'var(--background)' }}
                  >
                    <span className="flex-1 text-sm" style={{ color: 'var(--foreground)' }}>
                      {ing.item}
                    </span>
                    {ing.amount && (
                      <span className="text-sm" style={{ color: 'var(--muted)' }}>
                        {ing.amount}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeIngredient(index)}
                      className="p-1 rounded hover:bg-red-50 transition-colors"
                      style={{ color: 'var(--muted)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new ingredient */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newIngredient.item}
                onChange={(e) => setNewIngredient({ ...newIngredient, item: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIngredient(); } }}
                placeholder={t.recipes.ingredientsPlaceholder}
                className="input text-sm"
                style={{ flex: '1 1 auto', minWidth: 0 }}
              />
              <input
                type="text"
                value={newIngredient.amount}
                onChange={(e) => setNewIngredient({ ...newIngredient, amount: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIngredient(); } }}
                placeholder={t.recipes.portions}
                className="input text-sm"
                style={{ flex: '0 0 100px', width: '100px' }}
              />
              <button
                type="button"
                onClick={addIngredient}
                disabled={!newIngredient.item.trim()}
                className="btn btn-secondary px-3"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              {t.recipes.ingredientsPlaceholder}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.recipes.instructions}
            </label>
            <textarea
              value={newRecipe.instructions}
              onChange={(e) => setNewRecipe({ ...newRecipe, instructions: e.target.value })}
              placeholder={t.recipes.instructionsPlaceholder}
              rows={4}
              className="input resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.recipes.editRecipe}
            </label>
            <input
              type="url"
              value={newRecipe.external_link}
              onChange={(e) => setNewRecipe({ ...newRecipe, external_link: e.target.value })}
              placeholder="https://..."
              className="input"
            />
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={newRecipe.is_quick}
                onChange={(e) => setNewRecipe({ ...newRecipe, is_quick: e.target.checked })}
                className="w-5 h-5 rounded"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="text-sm" style={{ color: 'var(--foreground)' }}>{t.recipes.isQuick}</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={newRecipe.is_kid_friendly}
                onChange={(e) => setNewRecipe({ ...newRecipe, is_kid_friendly: e.target.checked })}
                className="w-5 h-5 rounded"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="text-sm" style={{ color: 'var(--foreground)' }}>{t.recipes.isKidFriendly}</span>
            </label>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving || !newRecipe.name}
              className="btn btn-primary"
            >
              {saving ? t.common.loading : t.common.save}
            </button>
          </div>
        </form>
      )}

      {/* Recipes list */}
      <div className="space-y-3">
        {recipes.length === 0 ? (
          <div
            className="rounded-2xl p-8 md:p-12 text-center"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
              style={{ background: 'rgba(229, 185, 94, 0.15)' }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
                <path d="M7 2v20"/>
                <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
              </svg>
            </div>
            <p className="text-lg" style={{ color: 'var(--muted)' }}>
              {t.recipes.noRecipes}
            </p>
          </div>
        ) : displayedRecipes.length === 0 ? (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <p style={{ color: 'var(--muted)' }}>
              {t.common.noResults}
            </p>
          </div>
        ) : (
          displayedRecipes.map((recipe) => (
            <div
              key={recipe.id}
              className="rounded-xl p-5 card-hover"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>
                      {recipe.name}
                    </h3>
                    {recipe.is_favorite && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--color-coral)" stroke="var(--color-coral)" strokeWidth="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                      </svg>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {recipe.is_quick && (
                      <span className="badge badge-sage">{t.recipes.isQuick}</span>
                    )}
                    {recipe.is_kid_friendly && (
                      <span className="badge badge-sky">{t.recipes.isKidFriendly}</span>
                    )}
                  </div>
                  {recipe.instructions && (
                    <p className="text-sm mt-3 line-clamp-2" style={{ color: 'var(--muted)' }}>
                      {recipe.instructions}
                    </p>
                  )}
                  {recipe.external_link && (
                    <a
                      href={recipe.external_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm mt-3 font-medium transition-opacity hover:opacity-80"
                      style={{ color: 'var(--accent)' }}
                    >
                      {t.recipes.editRecipe}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleFavorite(recipe.id, recipe.is_favorite)}
                    className="p-2 rounded-lg transition-all hover:scale-110"
                    title={t.recipes.isFavorite}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill={recipe.is_favorite ? 'var(--color-coral)' : 'none'}
                      stroke={recipe.is_favorite ? 'var(--color-coral)' : 'var(--muted)'}
                      strokeWidth="2"
                    >
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                  </button>
                  {recipe.ingredients && recipe.ingredients.length > 0 && (
                    <button
                      onClick={() => addToShoppingList(recipe)}
                      className="p-2 rounded-lg transition-all hover:scale-105"
                      style={{ color: 'var(--color-sage)' }}
                      title={t.nav.shoppingList}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <path d="M16 10a4 4 0 0 1-8 0"/>
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => deleteRecipe(recipe.id)}
                    className="p-2 rounded-lg transition-colors hover:bg-red-50"
                    style={{ color: 'var(--muted)' }}
                    title={t.recipes.deleteRecipe}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3,6 5,6 21,6"/>
                      <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
