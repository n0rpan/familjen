'use client'

import { useState } from 'react'
import type { MealSuggestion, RecipeIngredient } from '@/lib/types'

interface AISuggestionModalProps {
  isOpen: boolean
  onClose: () => void
  suggestions: MealSuggestion[]
  isLoading: boolean
  error: string | null
  onAccept: (suggestion: MealSuggestion, saveAsRecipe: boolean) => void
  onRetry: () => void
}

export function AISuggestionModal({
  isOpen,
  onClose,
  suggestions,
  isLoading,
  error,
  onAccept,
  onRetry,
}: AISuggestionModalProps) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<MealSuggestion | null>(null)
  const [editedName, setEditedName] = useState('')
  const [editedIngredients, setEditedIngredients] = useState<RecipeIngredient[]>([])
  const [saveAsRecipe, setSaveAsRecipe] = useState(false)

  if (!isOpen) return null

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const days = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag']
    return `${days[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}`
  }

  const handleStartEdit = (suggestion: MealSuggestion) => {
    setEditingRecipe(suggestion)
    setEditedName(suggestion.name)
    setEditedIngredients(suggestion.ingredients || [])
    setSaveAsRecipe(true)
  }

  const handleSaveEdit = () => {
    if (!editingRecipe) return

    const updatedSuggestion: MealSuggestion = {
      ...editingRecipe,
      name: editedName,
      ingredients: editedIngredients,
    }

    onAccept(updatedSuggestion, saveAsRecipe)
    setEditingRecipe(null)
  }

  const handleQuickAccept = (suggestion: MealSuggestion) => {
    onAccept(suggestion, false)
  }

  const addIngredient = () => {
    setEditedIngredients([...editedIngredients, { item: '', amount: '' }])
  }

  const updateIngredient = (index: number, field: 'item' | 'amount', value: string) => {
    const updated = [...editedIngredients]
    updated[index] = { ...updated[index], [field]: value }
    setEditedIngredients(updated)
  }

  const removeIngredient = (index: number) => {
    setEditedIngredients(editedIngredients.filter((_, i) => i !== index))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl flex flex-col"
        style={{ background: 'var(--card)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-6"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(229, 185, 94, 0.2)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 10 10.5v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
                <path d="M12 12v2"/>
                <path d="M10 22h4"/>
                <path d="M10 18h4v4h-4z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
                AI Middagsforslag
              </h2>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                {suggestions.length > 0 ? `${suggestions.length} forslag` : 'Genererer forslag...'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-12 h-12 rounded-full border-4 border-[var(--sand)] border-t-[var(--color-honey)] animate-spin mb-4" />
              <p style={{ color: 'var(--muted)' }}>Genererer middagsforslag...</p>
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                Dette kan ta noen sekunder
              </p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
                style={{ background: 'rgba(232, 120, 109, 0.15)' }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <p className="text-lg font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                Kunne ikke generere forslag
              </p>
              <p className="mb-6" style={{ color: 'var(--muted)' }}>{error}</p>
              <button onClick={onRetry} className="btn btn-primary">
                Prøv igjen
              </button>
            </div>
          ) : editingRecipe ? (
            /* Edit recipe mode */
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                  Navn på rett
                </label>
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    Ingredienser
                  </label>
                  <button
                    onClick={addIngredient}
                    className="text-sm font-medium"
                    style={{ color: 'var(--accent)' }}
                  >
                    + Legg til
                  </button>
                </div>
                <div className="space-y-2">
                  {editedIngredients.map((ing, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={ing.item}
                        onChange={(e) => updateIngredient(index, 'item', e.target.value)}
                        placeholder="Ingrediens"
                        className="input flex-1"
                      />
                      <input
                        type="text"
                        value={ing.amount}
                        onChange={(e) => updateIngredient(index, 'amount', e.target.value)}
                        placeholder="Mengde"
                        className="input w-24"
                      />
                      <button
                        onClick={() => removeIngredient(index)}
                        className="p-2 rounded-lg hover:bg-red-50"
                        style={{ color: 'var(--muted)' }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAsRecipe}
                  onChange={(e) => setSaveAsRecipe(e.target.checked)}
                  className="w-5 h-5 rounded"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                  Lagre som oppskrift i samlingen
                </span>
              </label>

              <div className="flex gap-3">
                <button
                  onClick={() => setEditingRecipe(null)}
                  className="btn flex-1"
                  style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
                >
                  Avbryt
                </button>
                <button onClick={handleSaveEdit} className="btn btn-primary flex-1">
                  Bruk denne
                </button>
              </div>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-12">
              <p style={{ color: 'var(--muted)' }}>
                Ingen dager trenger forslag - alle er allerede planlagt!
              </p>
            </div>
          ) : (
            /* Suggestions list */
            <div className="space-y-3">
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className="rounded-xl overflow-hidden"
                  style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                >
                  {/* Day header */}
                  <button
                    onClick={() => setExpandedDay(expandedDay === suggestion.day ? null : suggestion.day)}
                    className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-[var(--sand)]"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-semibold"
                        style={{ background: 'var(--color-honey)', color: 'white' }}
                      >
                        {new Date(suggestion.day).getDate()}
                      </div>
                      <div>
                        <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                          {formatDate(suggestion.day)}
                        </div>
                        <div className="text-sm" style={{ color: 'var(--muted)' }}>
                          {suggestion.name}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        {suggestion.is_quick && (
                          <span className="badge badge-sage text-xs">Rask</span>
                        )}
                        {suggestion.is_kid_friendly && (
                          <span className="badge badge-sky text-xs">Barn</span>
                        )}
                      </div>
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--muted)"
                        strokeWidth="2"
                        className={`transition-transform ${expandedDay === suggestion.day ? 'rotate-180' : ''}`}
                      >
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </div>
                  </button>

                  {/* Expanded content */}
                  {expandedDay === suggestion.day && (
                    <div className="p-4 pt-0">
                      <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
                        {suggestion.description}
                      </p>

                      {suggestion.ingredients && suggestion.ingredients.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>
                            INGREDIENSER
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {suggestion.ingredients.map((ing, i) => (
                              <span
                                key={i}
                                className="text-xs px-2 py-1 rounded-lg"
                                style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
                              >
                                {ing.amount} {ing.item}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleQuickAccept(suggestion)}
                          className="btn btn-primary flex-1 text-sm"
                        >
                          Bruk
                        </button>
                        <button
                          onClick={() => handleStartEdit(suggestion)}
                          className="btn flex-1 text-sm"
                          style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
                        >
                          Rediger & lagre
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
