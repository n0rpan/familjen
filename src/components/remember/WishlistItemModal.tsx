'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import type { WishlistItem } from '@/lib/types'

interface WishlistItemModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: WishlistItemFormData) => Promise<void>
  wishlistId: string
  initialData?: WishlistItem | null
}

export interface WishlistItemFormData {
  id?: string
  wishlist_id: string
  name: string
  description: string | null
  link: string | null
  price: number | null
  currency: string
  priority: number
  quantity: number
  notes: string | null
}

export function WishlistItemModal({
  isOpen,
  onClose,
  onSave,
  wishlistId,
  initialData,
}: WishlistItemModalProps) {
  const { t } = useLanguage()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [link, setLink] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('NOK')
  const [priority, setPriority] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')

  // Reset form when modal opens/closes or initialData changes
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setName(initialData.name)
        setDescription(initialData.description || '')
        setLink(initialData.link || '')
        setPrice(initialData.price ? String(initialData.price) : '')
        setCurrency(initialData.currency || 'NOK')
        setPriority(initialData.priority || 0)
        setQuantity(initialData.quantity || 1)
        setNotes(initialData.notes || '')
      } else {
        setName('')
        setDescription('')
        setLink('')
        setPrice('')
        setCurrency('NOK')
        setPriority(0)
        setQuantity(1)
        setNotes('')
      }
      setError(null)
    }
  }, [isOpen, initialData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t.errors.invalidInput)
      return
    }

    setSaving(true)
    setError(null)

    try {
      const data: WishlistItemFormData = {
        id: initialData?.id,
        wishlist_id: wishlistId,
        name: name.trim(),
        description: description.trim() || null,
        link: link.trim() || null,
        price: price ? parseFloat(price) : null,
        currency,
        priority,
        quantity,
        notes: notes.trim() || null,
      }
      await onSave(data)
      onClose()
    } catch {
      setError(t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-2xl p-6 max-h-[85vh] overflow-y-auto my-auto"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {initialData ? t.wishlists.editItem : t.wishlists.addItem}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
            aria-label={t.common.close}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.itemName} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-3 rounded-xl"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              placeholder={t.wishlists.itemName}
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.itemDescription}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 rounded-xl resize-none"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              rows={2}
              placeholder={t.wishlists.itemDescription}
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
              onChange={(e) => setLink(e.target.value)}
              className="w-full p-3 rounded-xl"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              placeholder="https://..."
            />
          </div>

          {/* Price and Currency */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                {t.wishlists.itemPrice}
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full p-3 rounded-xl"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                placeholder="0"
                min="0"
                step="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                &nbsp;
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full p-3 rounded-xl"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              >
                <option value="NOK">NOK</option>
                <option value="SEK">SEK</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.itemPriority}
            </label>
            <div className="flex gap-2">
              {[0, 1, 2, 3].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className="flex-1 py-2 px-3 rounded-lg text-sm transition-colors"
                  style={{
                    background: priority === p ? 'var(--color-honey)' : 'var(--background)',
                    color: priority === p ? 'white' : 'var(--foreground)',
                    border: priority === p ? 'none' : '1px solid var(--border)',
                  }}
                >
                  {p === 0 ? '-' : '\u2605'.repeat(p)}
                </button>
              ))}
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.itemQuantity}
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--sand)]"
                style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--foreground)" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <span className="text-lg font-medium w-8 text-center" style={{ color: 'var(--foreground)' }}>
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity(quantity + 1)}
                className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--sand)]"
                style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--foreground)" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Notes (for buyer) */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.buyerNotes}
            </label>
            <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
              {t.wishlists.buyerNotesDesc}
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-3 rounded-xl resize-none"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              rows={2}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="p-3 rounded-xl text-sm"
              style={{ background: 'rgba(232, 120, 109, 0.1)', color: 'var(--color-coral)' }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl font-medium transition-colors hover:bg-[var(--sand)]"
              style={{ color: 'var(--muted)' }}
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 px-4 rounded-xl font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {saving ? t.common.saving : t.common.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
