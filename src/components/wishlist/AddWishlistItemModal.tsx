'use client'

import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type { WishlistItem, WishlistOccasion } from '@/lib/types'
import { WISHLIST_OCCASIONS } from '@/lib/constants'

interface AddWishlistItemModalProps {
  isOpen: boolean
  onClose: () => void
  personId: string
  personType: 'child' | 'member'
  householdId: string
  defaultOccasion?: WishlistOccasion
  onItemAdded: (item: WishlistItem) => void
  editItem?: WishlistItem | null
}

export const AddWishlistItemModal = memo(function AddWishlistItemModal({
  isOpen,
  onClose,
  personId,
  personType,
  householdId,
  defaultOccasion = 'general',
  onItemAdded,
  editItem,
}: AddWishlistItemModalProps) {
  const { t } = useLanguage()
  const supabase = useMemo(() => createClient(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [link, setLink] = useState('')
  const [price, setPrice] = useState('')
  const [priority, setPriority] = useState(0)
  const [occasion, setOccasion] = useState<WishlistOccasion>(defaultOccasion)

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [existingImagePath, setExistingImagePath] = useState<string | null>(null)

  // Loading and error states
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  // Reset form when modal opens or editItem changes
  useEffect(() => {
    if (isOpen) {
      setName(editItem?.name || '')
      setDescription(editItem?.description || '')
      setLink(editItem?.link || '')
      setPrice(editItem?.price?.toString() || '')
      setPriority(editItem?.priority || 0)
      setOccasion(editItem?.occasion || defaultOccasion)
      setImageFile(null)
      setImagePreview(
        editItem?.image_path
          ? supabase.storage.from('wishlist-images').getPublicUrl(editItem.image_path).data.publicUrl
          : null
      )
      setExistingImagePath(editItem?.image_path || null)
      setSaveError(null)
      setAiMessage(null)
      setAiError(null)
    }
  }, [isOpen, editItem, defaultOccasion, supabase])

  // Handle image selection
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImageFile(file)
    setExistingImagePath(null)

    // Create preview with error handling
    const reader = new FileReader()
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string)
    }
    reader.onerror = () => {
      console.error('Failed to read image file')
      setSaveError(t.wishlists.imageReadError || 'Kunne ikke lese bildefilen')
    }
    reader.readAsDataURL(file)
  }, [t])

  // Remove image
  const removeImage = useCallback(() => {
    setImageFile(null)
    setImagePreview(null)
    setExistingImagePath(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  // Analyze image with AI
  const analyzeImage = useCallback(async () => {
    if (!imageFile && !existingImagePath) return

    setAnalyzing(true)
    setAiMessage(null)
    setAiError(null)

    try {
      // Convert image to base64
      let base64Image: string | null = null

      if (imageFile) {
        base64Image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('Failed to read image'))
          reader.readAsDataURL(imageFile)
        })
      } else if (existingImagePath) {
        // Fetch existing image and convert to base64
        const url = supabase.storage.from('wishlist-images').getPublicUrl(existingImagePath).data.publicUrl
        const response = await fetch(url)
        if (!response.ok) throw new Error('Failed to fetch image')
        const blob = await response.blob()
        base64Image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('Failed to read image'))
          reader.readAsDataURL(blob)
        })
      }

      if (!base64Image) return

      // Call AI endpoint
      const response = await fetch('/api/openrouter/analyze-wishlist-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `AI analysis failed (${response.status})`)
      }

      const result = await response.json()

      // Fill in extracted data
      if (result.name && !name) setName(result.name)
      if (result.description && !description) setDescription(result.description)
      if (result.price && !price) setPrice(result.price.toString())

      setAiMessage(t.wishlists.imageAnalyzed)
    } catch (error) {
      console.error('AI analysis error:', error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('No API key')) {
        setAiError(t.wishlists.aiNotConfigured || 'AI-analyse er ikke konfigurert')
      } else {
        setAiError(t.wishlists.aiAnalysisFailed || 'Kunne ikke analysere bildet')
      }
    } finally {
      setAnalyzing(false)
    }
  }, [imageFile, existingImagePath, supabase, name, description, price, t])

  // Save item
  const handleSave = useCallback(async () => {
    if (!name.trim()) return

    setSaving(true)
    setSaveError(null)

    try {
      let imagePath = existingImagePath

      // Upload new image if selected
      if (imageFile) {
        const ext = imageFile.name.split('.').pop()
        const filename = `${householdId}/${personId}/${Date.now()}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('wishlist-images')
          .upload(filename, imageFile)

        if (uploadError) {
          console.error('Image upload failed:', uploadError)
          setSaveError(t.wishlists.imageUploadFailed || 'Kunne ikke laste opp bildet. Prøv igjen.')
          return
        }
        imagePath = filename
      }

      // Build the item data
      const personFilter = personType === 'child'
        ? { child_id: personId, member_id: null }
        : { member_id: personId, child_id: null }

      const itemData = {
        household_id: householdId,
        ...personFilter,
        name: name.trim(),
        description: description.trim() || null,
        link: link.trim() || null,
        price: price ? parseFloat(price) : null,
        priority,
        occasion,
        image_path: imagePath,
      }

      let savedItem: WishlistItem

      if (editItem) {
        // Update existing item
        const { data, error } = await supabase
          .from('wishlist_items')
          .update(itemData)
          .eq('id', editItem.id)
          .select()
          .single()

        if (error) {
          console.error('Update error:', error)
          setSaveError(t.wishlists.saveFailed || 'Kunne ikke lagre endringene. Prøv igjen.')
          return
        }
        savedItem = data
      } else {
        // Insert new item
        const { data, error } = await supabase
          .from('wishlist_items')
          .insert(itemData)
          .select()
          .single()

        if (error) {
          console.error('Insert error:', error)
          setSaveError(t.wishlists.saveFailed || 'Kunne ikke lagre ønsket. Prøv igjen.')
          return
        }
        savedItem = data
      }

      onItemAdded(savedItem)
      onClose()
    } catch (error) {
      console.error('Save error:', error)
      setSaveError(t.wishlists.saveFailed || 'Noe gikk galt. Prøv igjen.')
    } finally {
      setSaving(false)
    }
  }, [
    name, description, link, price, priority, occasion,
    imageFile, existingImagePath, editItem,
    householdId, personId, personType,
    supabase, onItemAdded, onClose, t
  ])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl"
        style={{ background: 'var(--card)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 p-4 border-b" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
            {editItem ? t.wishlists.editItem : t.wishlists.addItem}
          </h3>
        </div>

        {/* Form */}
        <div className="p-4 space-y-4">
          {/* Image upload */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleImageSelect}
              className="hidden"
            />

            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="w-full h-48 object-cover rounded-xl"
                />
                <div className="absolute top-2 right-2 flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium"
                    style={{ background: 'var(--card)', color: 'var(--foreground)' }}
                  >
                    {t.wishlists.changeImage}
                  </button>
                  <button
                    onClick={removeImage}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium"
                    style={{ background: 'var(--color-coral)', color: 'white' }}
                  >
                    {t.wishlists.removeImage}
                  </button>
                </div>

                {/* AI analyze button */}
                <button
                  onClick={analyzeImage}
                  disabled={analyzing}
                  className="absolute bottom-2 left-2 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  {analyzing ? (
                    <>
                      <span className="animate-spin">⚡</span>
                      {t.wishlists.analyzing}
                    </>
                  ) : (
                    <>
                      <span>✨</span>
                      {t.wishlists.analyzeImage}
                    </>
                  )}
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span className="text-sm">{t.wishlists.addImage}</span>
              </button>
            )}

            {aiMessage && (
              <p className="text-sm mt-2" style={{ color: 'var(--color-sage)' }}>
                {aiMessage}
              </p>
            )}
            {aiError && (
              <p className="text-sm mt-2 p-2 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                {aiError}
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.itemName} *
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t.wishlists.itemName}
              className="w-full px-3 py-2 rounded-lg"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.itemDescription}
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t.wishlists.itemDescription}
              rows={2}
              className="w-full px-3 py-2 rounded-lg resize-none"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {/* Link */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.itemLink}
            </label>
            <input
              type="url"
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder={t.wishlists.itemLinkPlaceholder}
              className="w-full px-3 py-2 rounded-lg"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {/* Price */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.itemPrice}
            </label>
            <input
              type="number"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="0"
              min="0"
              className="w-full px-3 py-2 rounded-lg"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {/* Occasion */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.occasions[occasion]}
            </label>
            <div className="flex gap-2">
              {WISHLIST_OCCASIONS.map(occ => (
                <button
                  key={occ}
                  onClick={() => setOccasion(occ)}
                  className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: occasion === occ ? 'var(--accent)' : 'var(--background)',
                    color: occasion === occ ? 'white' : 'var(--foreground)',
                    border: `1px solid ${occasion === occ ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {t.wishlists.occasions[occ]}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.itemPriority}
            </label>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4, 5].map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className="flex-1 py-2 rounded-lg text-lg transition-colors"
                  style={{
                    background: priority >= p && p > 0 ? 'rgba(229, 185, 94, 0.2)' : 'var(--background)',
                    border: `1px solid ${priority >= p && p > 0 ? 'var(--color-honey)' : 'var(--border)'}`,
                  }}
                  title={p === 0 ? t.wishlists.noPriority : t.wishlists.priorityStars.replace('{count}', String(p))}
                >
                  {p === 0 ? '○' : '★'}
                </button>
              ))}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              {priority === 0 ? t.wishlists.noPriority
                : priority === 1 ? t.wishlists.lowPriority
                : priority === 2 ? t.wishlists.lowPriority
                : priority === 3 ? t.wishlists.mediumPriority
                : priority === 4 ? t.wishlists.highPriority
                : t.wishlists.mustHave}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 p-4 border-t" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
          {saveError && (
            <p className="text-sm mb-3 p-3 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
              {saveError}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg font-medium"
              style={{ background: 'var(--background)', color: 'var(--foreground)' }}
            >
              {t.common.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="flex-1 py-2.5 rounded-lg font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {saving ? t.common.saving : t.common.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
