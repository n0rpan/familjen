'use client'

/**
 * RecipesPageContent Component
 *
 * Client component for the recipes page.
 * Receives initial data from server (PPR) and manages local state for mutations.
 * Supports AI prefill navigation for creating recipes from parsed actions.
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRecipes, useShoppingLists } from '@/hooks/data'
import type { Recipe, Household } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'
import { RecipesPagePartialSkeleton } from '@/components/Skeleton'
import { revalidateRecipes } from '@/lib/revalidate'
import type { RecipesPageData } from '@/lib/data/server'
import { PREFILL_STORAGE_KEYS, type RecipePrefillData } from '@/lib/ai-action-routing'

interface RecipesPageContentProps {
  initialData?: RecipesPageData
  isDemo?: boolean
}

export function RecipesPageContent({ initialData, isDemo = false }: RecipesPageContentProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Use initial data if provided, otherwise use hooks
  const hasInitialData = !!initialData

  // State initialized from server data
  const [household, setHousehold] = useState<Household | null>(initialData?.household || null)
  const [recipesData, setRecipesData] = useState<Recipe[]>(initialData?.recipes || [])

  // Track whether form was opened from AI navigation (for future UX enhancements)
  const [isFromAIPrefill, setIsFromAIPrefill] = useState(false)

  // Use hooks for mutations (these also work in demo mode)
  const {
    recipes: hookRecipes,
    loading: hookLoading,
    addRecipe,
    updateRecipe,
    deleteRecipe,
  } = useRecipes()
  const { addItemToList } = useShoppingLists()

  // Sync hook data when available (for mutations and demo mode)
  useEffect(() => {
    if (!hasInitialData && hookRecipes.length > 0) {
      setRecipesData(hookRecipes)
    }
  }, [hasInitialData, hookRecipes])

  // Use hook recipes for display after mutations
  const recipes = hasInitialData ? recipesData : hookRecipes

  // Local UI state
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

  const loading = !hasInitialData && hookLoading

  // Check for AI prefill navigation
  useEffect(() => {
    const addRecipe = searchParams.get('addRecipe') === 'true'
    if (!addRecipe) return

    // Read prefill data from localStorage
    try {
      const stored = localStorage.getItem(PREFILL_STORAGE_KEYS.recipe)
      if (stored) {
        const data = JSON.parse(stored) as RecipePrefillData
        setIsFromAIPrefill(true)

        // Prefill form fields
        setNewRecipe({
          name: data.name || '',
          instructions: data.instructions || '',
          external_link: data.external_link || '',
          is_quick: data.is_quick ?? false,
          is_kid_friendly: data.is_kid_friendly ?? true,
        })

        // Prefill ingredients if provided
        if (data.ingredients && data.ingredients.length > 0) {
          setIngredients(data.ingredients)
        }

        // Open the form
        setShowForm(true)

        // Clean up localStorage
        localStorage.removeItem(PREFILL_STORAGE_KEYS.recipe)
      } else {
        // No prefill data but query param present - just open form
        setShowForm(true)
      }
    } catch (err) {
      console.error('Failed to read recipe prefill data:', err)
      setShowForm(true) // Still open form even if prefill fails
    }

    // Clear the query param without causing a navigation
    const url = new URL(window.location.href)
    url.searchParams.delete('addRecipe')
    window.history.replaceState({}, '', url.toString())
  }, [searchParams])

  // Clear prefill state when form is closed
  const handleCloseForm = useCallback(() => {
    setShowForm(false)
    setIsFromAIPrefill(false)
    setNewRecipe({
      name: '',
      instructions: '',
      external_link: '',
      is_quick: false,
      is_kid_friendly: true,
    })
    setIngredients([])
    setNewIngredient({ item: '', amount: '' })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRecipe.name || !household) return

    setSaving(true)

    try {
      await addRecipe({
        name: newRecipe.name,
        instructions: newRecipe.instructions || null,
        external_link: newRecipe.external_link || null,
        is_quick: newRecipe.is_quick,
        is_kid_friendly: newRecipe.is_kid_friendly,
        is_favorite: false,
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
      setMessage({ type: 'success', text: t.success.saved })

      // Revalidate cache and refresh
      if (!isDemo && household?.id) {
        revalidateRecipes(household.id)
        router.refresh()
      }
    } catch {
      setMessage({ type: 'error', text: t.errors.saveFailed })
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const addIngredientToList = () => {
    if (!newIngredient.item.trim()) return
    setIngredients([...ingredients, { item: newIngredient.item.trim(), amount: newIngredient.amount.trim() }])
    setNewIngredient({ item: '', amount: '' })
  }

  const removeIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index))
  }

  const handleDeleteRecipe = async (id: string) => {
    if (!confirm(t.recipes.deleteRecipeConfirm.replace('{name}', ''))) return

    try {
      await deleteRecipe(id)
      if (!isDemo && household?.id) {
        revalidateRecipes(household.id)
        router.refresh()
      }
    } catch {
      setMessage({ type: 'error', text: t.errors.saveFailed })
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const toggleFavorite = async (id: string, currentValue: boolean) => {
    try {
      await updateRecipe(id, { is_favorite: !currentValue })
      if (!isDemo && household?.id) {
        revalidateRecipes(household.id)
      }
    } catch {
      // Silent fail for favorite toggle
    }
  }

  const addToShoppingList = async (recipe: Recipe) => {
    if (!recipe.ingredients || recipe.ingredients.length === 0) {
      setMessage({ type: 'error', text: t.errors.generic })
      setTimeout(() => setMessage(null), 3000)
      return
    }

    try {
      for (const ing of recipe.ingredients) {
        await addItemToList({
          name: ing.item,
          quantity: ing.amount,
          category: 'other',
          source_recipe_id: recipe.id,
          is_bought: false,
        })
      }
      setMessage({ type: 'success', text: t.success.saved })
    } catch {
      setMessage({ type: 'error', text: t.errors.saveFailed })
    }
    setTimeout(() => setMessage(null), 3000)
  }

  // Filter and sort recipes (favorites first)
  const displayedRecipes = useMemo(() => {
    return recipes
      .filter(r => filter === 'all' || r.is_favorite)
      .sort((a, b) => {
        if (a.is_favorite && !b.is_favorite) return -1
        if (!a.is_favorite && b.is_favorite) return 1
        return a.name.localeCompare(b.name, 'nb')
      })
  }, [recipes, filter])

  // Only show skeleton if loading AND no cached data yet
  if (loading && !household) {
    return <RecipesPagePartialSkeleton t={t} />
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
          {recipes.length === 0 && (
            <p className="mt-1" style={{ color: 'var(--muted)' }}>
              {t.recipes.noRecipesDesc}
            </p>
          )}
        </div>
        <button
          onClick={() => showForm ? handleCloseForm() : setShowForm(true)}
          className={`btn btn-primary self-start sm:self-auto ${showForm ? '' : 'hidden sm:inline-flex'}`}
        >
          {showForm ? t.common.cancel : `+ ${t.recipes.addRecipe}`}
        </button>
      </div>

      {/* Mobile FAB */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="fixed bottom-24 right-4 z-40 sm:hidden w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          style={{
            background: 'var(--accent)',
            color: 'white',
            boxShadow: '0 4px 12px color-mix(in srgb, var(--accent) 40%, transparent)',
          }}
          aria-label={t.recipes.addRecipe}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      )}

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

            <div className="flex gap-2">
              <input
                type="text"
                value={newIngredient.item}
                onChange={(e) => setNewIngredient({ ...newIngredient, item: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIngredientToList(); } }}
                placeholder={t.recipes.ingredientsPlaceholder}
                className="input text-sm"
                style={{ flex: '1 1 auto', minWidth: 0 }}
              />
              <input
                type="text"
                value={newIngredient.amount}
                onChange={(e) => setNewIngredient({ ...newIngredient, amount: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIngredientToList(); } }}
                placeholder={t.recipes.portions}
                className="input text-sm"
                style={{ flex: '0 0 100px', width: '100px' }}
              />
              <button
                type="button"
                onClick={addIngredientToList}
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
                    onClick={() => handleDeleteRecipe(recipe.id)}
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
