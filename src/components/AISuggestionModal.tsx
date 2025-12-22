'use client'

import { useState, useRef, memo } from 'react'
import type { MealSuggestion, RecipeIngredient } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'

// Internal type for editable ingredients with stable IDs
type EditableIngredient = RecipeIngredient & { _id: string }

interface AISuggestionModalProps {
  isOpen: boolean
  onClose: () => void
  suggestions: MealSuggestion[]
  isLoading: boolean
  error: string | null
  onAccept: (suggestion: MealSuggestion, saveAsRecipe: boolean) => void
  onRetry: () => void
  onAddToShoppingList?: (ingredients: RecipeIngredient[]) => Promise<void>
  onApplyAll?: () => void
}

export const AISuggestionModal = memo(function AISuggestionModal({
  isOpen,
  onClose,
  suggestions,
  isLoading,
  error,
  onAccept,
  onRetry,
  onAddToShoppingList,
  onApplyAll,
}: AISuggestionModalProps) {
  const { t } = useLanguage()
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [addingToList, setAddingToList] = useState<string | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<MealSuggestion | null>(null)
  const [editedName, setEditedName] = useState('')
  const [editedIngredients, setEditedIngredients] = useState<EditableIngredient[]>([])
  const [saveAsRecipe, setSaveAsRecipe] = useState(false)
  const idCounterRef = useRef(0)

  // Generate unique IDs for ingredients
  const generateId = () => `ing-${++idCounterRef.current}`

  if (!isOpen) return null

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const dayIndex = date.getDay()
    const weekdaysArray = t.date.weekdays
    // weekdays[0] is Monday, so we need to map Sunday (0) to weekdays[6]
    const adjustedIndex = dayIndex === 0 ? 6 : dayIndex - 1
    return `${weekdaysArray[adjustedIndex]} ${date.getDate()}.${date.getMonth() + 1}`
  }

  const handleStartEdit = (suggestion: MealSuggestion) => {
    setEditingRecipe(suggestion)
    setEditedName(suggestion.name)
    // Add IDs to incoming ingredients
    setEditedIngredients((suggestion.ingredients || []).map(ing => ({ ...ing, _id: generateId() })))
    setSaveAsRecipe(true)
  }

  const handleSaveEdit = () => {
    if (!editingRecipe) return

    // Strip _id when saving
    const cleanIngredients: RecipeIngredient[] = editedIngredients.map(({ item, amount }) => ({ item, amount }))
    const updatedSuggestion: MealSuggestion = {
      ...editingRecipe,
      name: editedName,
      ingredients: cleanIngredients,
    }

    onAccept(updatedSuggestion, saveAsRecipe)
    setEditingRecipe(null)
  }

  const handleQuickAccept = (suggestion: MealSuggestion) => {
    onAccept(suggestion, false)
  }

  const handleAddToShoppingList = async (suggestion: MealSuggestion) => {
    if (!onAddToShoppingList || !suggestion.ingredients?.length) return
    setAddingToList(suggestion.day)
    try {
      await onAddToShoppingList(suggestion.ingredients)
    } finally {
      setAddingToList(null)
    }
  }

  const addIngredient = () => {
    setEditedIngredients([...editedIngredients, { item: '', amount: '', _id: generateId() }])
  }

  const updateIngredient = (id: string, field: 'item' | 'amount', value: string) => {
    setEditedIngredients(editedIngredients.map(ing =>
      ing._id === id ? { ...ing, [field]: value } : ing
    ))
  }

  const removeIngredient = (id: string) => {
    setEditedIngredients(editedIngredients.filter(ing => ing._id !== id))
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
                {t.week.aiModalTitle}
              </h2>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                {suggestions.length > 0 ? `${suggestions.length} ${t.week.suggestions}` : t.week.generatingSuggestions}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {suggestions.length > 1 && onApplyAll && !editingRecipe && (
              <button
                onClick={onApplyAll}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ background: 'var(--color-sage)', color: 'white' }}
              >
                {t.week.applyAll}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
              style={{ color: 'var(--muted)' }}
              aria-label={t.common.close}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-12 h-12 rounded-full border-4 border-[var(--sand)] border-t-[var(--color-honey)] animate-spin mb-4" />
              <p style={{ color: 'var(--muted)' }}>{t.week.generatingSuggestions}</p>
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                {t.week.takesAFewSeconds}
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
                {t.week.couldNotGenerate}
              </p>
              <p className="mb-6" style={{ color: 'var(--muted)' }}>{error}</p>
              <button onClick={onRetry} className="btn btn-primary">
                {t.common.retry}
              </button>
            </div>
          ) : editingRecipe ? (
            /* Edit recipe mode */
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                  {t.week.dishName}
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
                    {t.recipes.ingredients}
                  </label>
                  <button
                    onClick={addIngredient}
                    className="text-sm font-medium"
                    style={{ color: 'var(--accent)' }}
                  >
                    + {t.week.addIngredient}
                  </button>
                </div>
                <div className="space-y-2">
                  {editedIngredients.map((ing) => (
                    <div key={ing._id} className="flex gap-2">
                      <input
                        type="text"
                        value={ing.item}
                        onChange={(e) => updateIngredient(ing._id, 'item', e.target.value)}
                        placeholder={t.week.ingredient}
                        className="input flex-1"
                      />
                      <input
                        type="text"
                        value={ing.amount}
                        onChange={(e) => updateIngredient(ing._id, 'amount', e.target.value)}
                        placeholder={t.week.amount}
                        className="input w-24"
                      />
                      <button
                        onClick={() => removeIngredient(ing._id)}
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
                  {t.week.saveAsRecipe}
                </span>
              </label>

              <div className="flex gap-3">
                <button
                  onClick={() => setEditingRecipe(null)}
                  className="btn flex-1"
                  style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
                >
                  {t.common.cancel}
                </button>
                <button onClick={handleSaveEdit} className="btn btn-primary flex-1">
                  {t.week.useThis}
                </button>
              </div>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-12">
              <p style={{ color: 'var(--muted)' }}>
                {t.week.noDaysNeedSuggestions}
              </p>
            </div>
          ) : (
            /* Suggestions list */
            <div className="space-y-3">
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.day}
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
                          <span className="badge badge-sage text-xs">{t.recipes.quick}</span>
                        )}
                        {suggestion.is_kid_friendly && (
                          <span className="badge badge-sky text-xs">{t.recipes.kidFriendly}</span>
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
                            {t.recipes.ingredientsHeader}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {suggestion.ingredients.map((ing, i) => (
                              <span
                                key={`${ing.item}-${ing.amount}-${i}`}
                                className="text-xs px-2 py-1 rounded-lg"
                                style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
                              >
                                {ing.amount} {ing.item}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => handleQuickAccept(suggestion)}
                          className="btn btn-primary flex-1 text-sm min-w-[80px]"
                        >
                          {t.week.use}
                        </button>
                        {onAddToShoppingList && (
                          <button
                            onClick={() => handleAddToShoppingList(suggestion)}
                            disabled={!suggestion.ingredients?.length || addingToList === suggestion.day}
                            className="btn flex-1 text-sm min-w-[80px] flex items-center justify-center gap-1"
                            style={{ background: 'var(--color-sage)', color: 'white', opacity: suggestion.ingredients?.length ? 1 : 0.5 }}
                            title={!suggestion.ingredients?.length ? t.week.noIngredients : undefined}
                          >
                            {addingToList === suggestion.day ? (
                              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                              </svg>
                            ) : (
                              <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                                  <line x1="3" y1="6" x2="21" y2="6"/>
                                  <path d="M16 10a4 4 0 0 1-8 0"/>
                                </svg>
                                {t.week.addToShoppingList}
                              </>
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleStartEdit(suggestion)}
                          className="btn text-sm min-w-[80px]"
                          style={{ background: 'var(--sand)', color: 'var(--foreground)' }}
                        >
                          {t.week.editAndSave}
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
})
