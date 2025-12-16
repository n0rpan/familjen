'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/context'
import type { Child, HouseholdMember, WishlistOccasion } from '@/lib/types'

interface WishlistModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: WishlistFormData) => Promise<void>
  members: HouseholdMember[]
  children: Child[]
  currentMemberId: string | null
  initialData?: WishlistFormData | null
}

export interface WishlistFormData {
  id?: string
  member_id: string | null
  child_id: string | null
  name: string
  occasion: WishlistOccasion | null
  occasion_date: string | null
  description: string | null
  is_public: boolean
}

export function WishlistModal({
  isOpen,
  onClose,
  onSave,
  members,
  children,
  currentMemberId,
  initialData,
}: WishlistModalProps) {
  const { t } = useLanguage()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [ownerType, setOwnerType] = useState<'member' | 'child'>('member')
  const [memberId, setMemberId] = useState<string | null>(null)
  const [childId, setChildId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [occasion, setOccasion] = useState<WishlistOccasion | null>(null)
  const [occasionDate, setOccasionDate] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)

  // Reset form when modal opens/closes or initialData changes
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setOwnerType(initialData.child_id ? 'child' : 'member')
        setMemberId(initialData.member_id)
        setChildId(initialData.child_id)
        setName(initialData.name)
        setOccasion(initialData.occasion)
        setOccasionDate(initialData.occasion_date || '')
        setDescription(initialData.description || '')
        setIsPublic(initialData.is_public)
      } else {
        // Default to current member
        setOwnerType('member')
        setMemberId(currentMemberId)
        setChildId(null)
        setName('')
        setOccasion(null)
        setOccasionDate('')
        setDescription('')
        setIsPublic(true)
      }
      setError(null)
    }
  }, [isOpen, initialData, currentMemberId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t.errors.invalidInput)
      return
    }

    if (ownerType === 'member' && !memberId) {
      setError(t.errors.invalidInput)
      return
    }

    if (ownerType === 'child' && !childId) {
      setError(t.errors.invalidInput)
      return
    }

    setSaving(true)
    setError(null)

    try {
      const data: WishlistFormData = {
        id: initialData?.id,
        member_id: ownerType === 'member' ? memberId : null,
        child_id: ownerType === 'child' ? childId : null,
        name: name.trim(),
        occasion,
        occasion_date: occasionDate || null,
        description: description.trim() || null,
        is_public: isPublic,
      }
      await onSave(data)
      onClose()
    } catch {
      setError(t.errors.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const occasions: WishlistOccasion[] = ['birthday', 'christmas', 'anniversary', 'general', 'other']

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
            {initialData ? t.wishlists.editWishlist : t.wishlists.createWishlist}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Owner type toggle */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.remember.assignTo}
            </label>
            <div className="flex gap-2 p-1 rounded-xl" style={{ background: 'var(--background)' }}>
              <button
                type="button"
                onClick={() => {
                  setOwnerType('member')
                  setChildId(null)
                  if (!memberId) setMemberId(currentMemberId)
                }}
                className="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: ownerType === 'member' ? 'var(--accent)' : 'transparent',
                  color: ownerType === 'member' ? 'white' : 'var(--muted)',
                }}
              >
                {t.settings.members}
              </button>
              {children.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setOwnerType('child')
                    setMemberId(null)
                    if (!childId) setChildId(children[0]?.id || null)
                  }}
                  className="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: ownerType === 'child' ? 'var(--accent)' : 'transparent',
                    color: ownerType === 'child' ? 'white' : 'var(--muted)',
                  }}
                >
                  {t.settings.children}
                </button>
              )}
            </div>
          </div>

          {/* Member/Child selector */}
          {ownerType === 'member' ? (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                {t.week.selectMember} *
              </label>
              <select
                value={memberId || ''}
                onChange={(e) => setMemberId(e.target.value || null)}
                className="w-full p-3 rounded-xl"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                required
              >
                <option value="">{t.week.selectMember}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                {t.week.selectChild} *
              </label>
              <select
                value={childId || ''}
                onChange={(e) => setChildId(e.target.value || null)}
                className="w-full p-3 rounded-xl"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                required
              >
                <option value="">{t.week.selectChild}</option>
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Wishlist name */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.wishlistName} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-3 rounded-xl"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              placeholder={t.wishlists.wishlistName}
              required
            />
          </div>

          {/* Occasion */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.occasion}
            </label>
            <div className="flex flex-wrap gap-2">
              {occasions.map((occ) => (
                <button
                  key={occ}
                  type="button"
                  onClick={() => setOccasion(occasion === occ ? null : occ)}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: occasion === occ ? 'var(--accent)' : 'var(--background)',
                    color: occasion === occ ? 'white' : 'var(--foreground)',
                    border: occasion === occ ? 'none' : '1px solid var(--border)',
                  }}
                >
                  {t.wishlists.occasions[occ]}
                </button>
              ))}
            </div>
          </div>

          {/* Occasion date */}
          {occasion && occasion !== 'general' && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                {t.wishlists.occasionDate}
              </label>
              <input
                type="date"
                value={occasionDate}
                onChange={(e) => setOccasionDate(e.target.value)}
                className="w-full p-3 rounded-xl"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              />
            </div>
          )}

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
            />
          </div>

          {/* Public toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPublic(!isPublic)}
              className="w-12 h-7 rounded-full transition-colors relative"
              style={{ background: isPublic ? 'var(--accent)' : 'var(--border)' }}
            >
              <div
                className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all"
                style={{ left: isPublic ? '26px' : '4px' }}
              />
            </button>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                {t.wishlists.makePublic}
              </p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {t.wishlists.makePublicDesc}
              </p>
            </div>
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
