'use client'

/**
 * DemoRecipesPage Component
 *
 * Client-side version of the recipes page that uses demo data hooks.
 */

import { useState, useMemo } from 'react'
import { useRecipes } from '@/hooks/data'
import { useLanguage } from '@/lib/i18n/context'

type RecipeFilter = 'all' | 'quick' | 'kid-friendly' | 'favorites'

export function DemoRecipesPage() {
  const { t } = useLanguage()
  const { recipes, loading, error } = useRecipes()
  const [activeFilter, setActiveFilter] = useState<RecipeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRecipe, setSelectedRecipe] = useState<string | null>(null)

  const filteredRecipes = useMemo(() => {
    let filtered = recipes

    // Apply filter
    if (activeFilter === 'quick') {
      filtered = filtered.filter(r => r.is_quick)
    } else if (activeFilter === 'kid-friendly') {
      filtered = filtered.filter(r => r.is_kid_friendly)
    } else if (activeFilter === 'favorites') {
      filtered = filtered.filter(r => r.is_favorite)
    }

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(r => r.name.toLowerCase().includes(query))
    }

    return filtered
  }, [recipes, activeFilter, searchQuery])

  const filters: { id: RecipeFilter; label: string }[] = [
    { id: 'all', label: 'Alle' },
    { id: 'favorites', label: 'Favoritter' },
    { id: 'quick', label: 'Raskt' },
    { id: 'kid-friendly', label: 'Barnevennlig' },
  ]

  const selectedRecipeData = recipes.find(r => r.id === selectedRecipe)

  if (loading) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.recipes}</h1>
        </div>
        <div className="animate-pulse grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-32 bg-gray-200 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container animate-fade-in">
        <div className="page-header mb-6">
          <h1 className="page-title">{t.nav.recipes}</h1>
        </div>
        <div className="card p-8 text-center">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <h1 className="page-title">{t.nav.recipes}</h1>
        <p style={{ color: 'var(--muted)' }}>
          {recipes.length} oppskrifter
        </p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Søk oppskrifter..."
          className="w-full px-4 py-3 rounded-xl"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {filters.map(filter => (
          <button
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
            className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors"
            style={{
              background: activeFilter === filter.id ? 'var(--accent)' : 'var(--card)',
              color: activeFilter === filter.id ? 'white' : 'var(--foreground)',
              border: `1px solid ${activeFilter === filter.id ? 'transparent' : 'var(--border)'}`,
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Recipe grid */}
      {filteredRecipes.length === 0 ? (
        <div
          className="card p-8 text-center"
          style={{
            border: '2px dashed var(--border)',
            background: 'transparent',
          }}
        >
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Ingen oppskrifter funnet
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            Prøv et annet søk eller filter
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {filteredRecipes.map(recipe => (
            <div
              key={recipe.id}
              onClick={() => setSelectedRecipe(recipe.id)}
              className="card p-4 cursor-pointer transition-all hover:scale-[1.02]"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {recipe.name}
                </h3>
                {recipe.is_favorite && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="var(--color-honey)"
                    stroke="var(--color-honey)"
                    strokeWidth="2"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                )}
              </div>
              <div className="flex gap-1 flex-wrap">
                {recipe.is_quick && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(126, 182, 196, 0.2)', color: 'var(--color-sky)' }}>
                    Raskt
                  </span>
                )}
                {recipe.is_kid_friendly && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(131, 166, 151, 0.2)', color: 'var(--color-sage)' }}>
                    Barnevennlig
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recipe detail modal */}
      {selectedRecipeData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setSelectedRecipe(null)}
        >
          <div
            className="card p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
                {selectedRecipeData.name}
              </h2>
              <button
                onClick={() => setSelectedRecipe(null)}
                className="p-1"
                style={{ color: 'var(--muted)' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {selectedRecipeData.ingredients && selectedRecipeData.ingredients.length > 0 && (
              <div className="mb-4">
                <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                  Ingredienser
                </h3>
                <ul className="space-y-1">
                  {selectedRecipeData.ingredients.map((ing, i) => (
                    <li key={i} className="text-sm" style={{ color: 'var(--muted)' }}>
                      • {ing.amount} {ing.item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedRecipeData.instructions && (
              <div>
                <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                  Fremgangsmåte
                </h3>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  {selectedRecipeData.instructions}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
