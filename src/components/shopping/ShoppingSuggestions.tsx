'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import type { ShoppingCategory } from '@/lib/constants'

interface ShoppingSuggestion {
  name: string
  quantity: string | null
  reason: string
  category: ShoppingCategory
  source: 'recipe' | 'pattern' | 'staple'
}

interface ShoppingSuggestionsProps {
  onAddItem: (name: string, quantity: string | null, category: ShoppingCategory) => void
  refreshTrigger?: number
}

export function ShoppingSuggestions({ onAddItem, refreshTrigger }: ShoppingSuggestionsProps) {
  const { t } = useLanguage()
  const [suggestions, setSuggestions] = useState<ShoppingSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [mealsPlanned, setMealsPlanned] = useState(0)
  const [addedItems, setAddedItems] = useState<Set<string>>(new Set())

  const fetchSuggestions = useCallback(async () => {
    try {
      const response = await fetch('/api/openrouter/shopping-suggest')
      if (response.ok) {
        const data = await response.json()
        setSuggestions(data.suggestions || [])
        setMealsPlanned(data.mealsPlanned || 0)
      }
    } catch (error) {
      console.error('Failed to fetch shopping suggestions:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSuggestions()
  }, [fetchSuggestions, refreshTrigger])

  const handleAdd = useCallback((suggestion: ShoppingSuggestion) => {
    onAddItem(suggestion.name, suggestion.quantity, suggestion.category)
    setAddedItems(prev => new Set([...prev, suggestion.name]))
  }, [onAddItem])

  // Filter out already added items
  const availableSuggestions = suggestions.filter(s => !addedItems.has(s.name))

  if (loading) {
    return null // Don't show loading state - suggestions are optional
  }

  if (availableSuggestions.length === 0) {
    return null
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--sand)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-honey)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          {t.shopping.suggestions ?? 'Forslag'}
        </span>
        {mealsPlanned > 0 && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {t.shopping.basedOnMeals?.replace('{count}', String(mealsPlanned)) ?? `Basert på ${mealsPlanned} planlagte måltider`}
          </span>
        )}
      </div>

      {/* Suggestions list */}
      <div className="flex flex-wrap gap-2">
        {availableSuggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.name}-${index}`}
            onClick={() => handleAdd(suggestion)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors hover:brightness-95"
            style={{
              background: 'var(--card)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
            title={suggestion.reason}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-sage)"
              strokeWidth="2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{suggestion.name}</span>
            {suggestion.quantity && (
              <span style={{ color: 'var(--muted)' }}>({suggestion.quantity})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tip for more suggestions */}
      {mealsPlanned === 0 && (
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          {t.shopping.planMealsForSuggestions ?? 'Planlegg måltider i ukeplanleggeren for bedre forslag'}
        </p>
      )}
    </div>
  )
}
