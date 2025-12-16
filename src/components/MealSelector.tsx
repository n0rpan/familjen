'use client'

import { useState, useRef, useEffect } from 'react'
import type { Recipe } from '@/lib/types'

interface MealSelectorProps {
  value: string
  recipes: Recipe[]
  onChange: (value: string, recipeId?: string) => void
  onRequestAISuggestion?: () => void
  placeholder?: string
  disabled?: boolean
}

export function MealSelector({
  value,
  recipes,
  onChange,
  onRequestAISuggestion,
  placeholder = '...',
  disabled = false,
}: MealSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Filter and sort recipes
  const filteredRecipes = recipes
    .filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      // Favorites first
      if (a.is_favorite && !b.is_favorite) return -1
      if (!a.is_favorite && b.is_favorite) return 1
      return a.name.localeCompare(b.name, 'nb')
    })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearch(newValue)
    onChange(newValue)
  }

  const handleInputFocus = () => {
    setIsOpen(true)
    setSearch(value)
  }

  const selectRecipe = (recipe: Recipe) => {
    onChange(recipe.name, recipe.id)
    setIsOpen(false)
    setSearch('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      inputRef.current?.blur()
    }
    if (e.key === 'Enter' && filteredRecipes.length > 0) {
      selectRecipe(filteredRecipes[0])
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-1">
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? search : value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 text-sm p-2 rounded-lg text-center min-w-0"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
          }}
        />
        {onRequestAISuggestion && (
          <button
            type="button"
            onClick={onRequestAISuggestion}
            disabled={disabled}
            className="p-2 rounded-lg transition-all hover:scale-105 shrink-0"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--color-honey)',
            }}
            title="Få AI-forslag"
            aria-label="Få AI-forslag"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 10.5v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
              <path d="M12 12v2"/>
              <path d="M10 22h4"/>
              <path d="M10 18h4v4h-4z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && recipes.length > 0 && (
        <div
          className="absolute z-50 mt-1 w-64 max-h-64 overflow-y-auto rounded-xl shadow-lg left-1/2 -translate-x-1/2"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
          }}
        >
          {filteredRecipes.length === 0 ? (
            <div className="p-3 text-sm text-center" style={{ color: 'var(--muted)' }}>
              Ingen oppskrifter funnet
            </div>
          ) : (
            <>
              {/* Quick access to favorites */}
              {filteredRecipes.some(r => r.is_favorite) && (
                <div className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-xs font-medium mb-2 px-2" style={{ color: 'var(--muted)' }}>
                    Favoritter
                  </div>
                  {filteredRecipes.filter(r => r.is_favorite).map(recipe => (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => selectRecipe(recipe)}
                      className="w-full text-left px-3 py-2 text-sm rounded-lg transition-colors hover:bg-[var(--sand)] flex items-center gap-2"
                      style={{ color: 'var(--foreground)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-coral)" stroke="var(--color-coral)" strokeWidth="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                      </svg>
                      <span className="truncate">{recipe.name}</span>
                      {recipe.is_quick && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-sage)', color: 'white' }}>
                          Rask
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* All recipes */}
              <div className="p-2">
                {filteredRecipes.some(r => r.is_favorite) && (
                  <div className="text-xs font-medium mb-2 px-2" style={{ color: 'var(--muted)' }}>
                    Alle oppskrifter
                  </div>
                )}
                {filteredRecipes.filter(r => !r.is_favorite).map(recipe => (
                  <button
                    key={recipe.id}
                    type="button"
                    onClick={() => selectRecipe(recipe)}
                    className="w-full text-left px-3 py-2 text-sm rounded-lg transition-colors hover:bg-[var(--sand)] flex items-center gap-2"
                    style={{ color: 'var(--foreground)' }}
                  >
                    <span className="truncate flex-1">{recipe.name}</span>
                    <div className="flex gap-1 shrink-0">
                      {recipe.is_quick && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-sage)', color: 'white' }}>
                          Rask
                        </span>
                      )}
                      {recipe.is_kid_friendly && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-sky)', color: 'white' }}>
                          Barn
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
