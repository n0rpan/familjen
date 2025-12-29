'use client'

import { memo } from 'react'
import type { Child, ChildColor } from '@/lib/types'
import type { TranslationStrings } from '@/lib/i18n/types'
import { CHILD_COLORS } from '@/lib/colors'

interface ChildrenSectionProps {
  children: Child[]
  editingChildId: string | null
  editingChildForm: {
    name: string
    location_name: string
    location_type: 'school' | 'kindergarten'
    birth_date: string
    color: ChildColor
    allergies: string[]
  }
  newChild: {
    name: string
    location_name: string
    location_type: 'school' | 'kindergarten'
    birth_date: string
    color: ChildColor
  }
  newAllergy: string
  saving: boolean
  t: TranslationStrings
  onEditingChildFormChange: (form: ChildrenSectionProps['editingChildForm']) => void
  onNewChildChange: (child: ChildrenSectionProps['newChild']) => void
  onNewAllergyChange: (allergy: string) => void
  onStartEdit: (child: Child) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onAddChild: (e: React.FormEvent) => void
  onDeleteChild: (id: string) => void
  onAddAllergy: () => void
  onRemoveAllergy: (allergy: string) => void
}

export const ChildrenSection = memo(function ChildrenSection({
  children,
  editingChildId,
  editingChildForm,
  newChild,
  newAllergy,
  saving,
  t,
  onEditingChildFormChange,
  onNewChildChange,
  onNewAllergyChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onAddChild,
  onDeleteChild,
  onAddAllergy,
  onRemoveAllergy,
}: ChildrenSectionProps) {
  return (
    <section
      className="rounded-2xl p-6 md:p-8"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(126, 182, 196, 0.2)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 14c0-4-3.5-6-7-6s-7 2-7 6v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4Z"/>
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
            {t.settings.children}
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.settings.childLocation}
          </p>
        </div>
      </div>

      {/* Existing children */}
      <div className="space-y-3 mb-6">
        {children.length === 0 ? (
          <p className="text-center py-8" style={{ color: 'var(--muted)' }}>
            {t.common.noResults}
          </p>
        ) : (
          children.map((child) => {
            const colorConfig = CHILD_COLORS.find(c => c.value === child.color) || CHILD_COLORS[0]
            const isEditing = editingChildId === child.id

            if (isEditing) {
              const editColor = CHILD_COLORS.find(c => c.value === editingChildForm.color) || CHILD_COLORS[0]
              return (
                <div
                  key={child.id}
                  className="p-4 rounded-xl space-y-4"
                  style={{ background: 'var(--background)', border: '2px solid var(--accent)' }}
                >
                  {/* Edit header */}
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-semibold"
                      style={{ background: editColor.bg, color: editColor.text }}
                    >
                      {editingChildForm.name.charAt(0) || '?'}
                    </div>
                    <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                      {t.settings.editChild}
                    </span>
                  </div>

                  {/* Edit form */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.childName} *</label>
                      <input
                        type="text"
                        value={editingChildForm.name}
                        onChange={(e) => onEditingChildFormChange({ ...editingChildForm, name: e.target.value })}
                        className="input"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.childLocation}</label>
                      <input
                        type="text"
                        placeholder={t.wizard.locationNamePlaceholder}
                        value={editingChildForm.location_name}
                        onChange={(e) => onEditingChildFormChange({ ...editingChildForm, location_name: e.target.value })}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.childBirthDate}</label>
                      <input
                        type="date"
                        value={editingChildForm.birth_date}
                        onChange={(e) => onEditingChildFormChange({ ...editingChildForm, birth_date: e.target.value })}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.childLocationType}</label>
                      <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                        <button
                          type="button"
                          onClick={() => onEditingChildFormChange({ ...editingChildForm, location_type: 'kindergarten' })}
                          className="flex-1 py-2 px-3 text-sm font-medium transition-colors"
                          style={{
                            background: editingChildForm.location_type === 'kindergarten' ? 'var(--color-sage)' : 'transparent',
                            color: editingChildForm.location_type === 'kindergarten' ? 'white' : 'var(--muted)',
                          }}
                        >
                          {t.settings.childLocationTypes.kindergarten}
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditingChildFormChange({ ...editingChildForm, location_type: 'school' })}
                          className="flex-1 py-2 px-3 text-sm font-medium transition-colors"
                          style={{
                            background: editingChildForm.location_type === 'school' ? 'var(--color-sky)' : 'transparent',
                            color: editingChildForm.location_type === 'school' ? 'white' : 'var(--muted)',
                          }}
                        >
                          {t.settings.childLocationTypes.school}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Color picker */}
                  <div>
                    <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>{t.settings.childColor}</label>
                    <div className="flex gap-2">
                      {CHILD_COLORS.map((color) => (
                        <button
                          key={color.value}
                          type="button"
                          onClick={() => onEditingChildFormChange({ ...editingChildForm, color: color.value })}
                          className="w-8 h-8 rounded-full transition-all"
                          style={{
                            background: color.bg,
                            border: editingChildForm.color === color.value ? `3px solid ${color.text}` : '3px solid transparent',
                            transform: editingChildForm.color === color.value ? 'scale(1.1)' : 'scale(1)',
                          }}
                          title={color.label}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Allergies */}
                  <div>
                    <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>{t.settings.childAllergies}</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {editingChildForm.allergies.map((allergy) => (
                        <span
                          key={allergy}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm"
                          style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
                        >
                          {allergy}
                          <button
                            type="button"
                            onClick={() => onRemoveAllergy(allergy)}
                            className="hover:bg-red-100 rounded-full p-0.5"
                            aria-label={t.common.remove}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"/>
                              <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </span>
                      ))}
                      {editingChildForm.allergies.length === 0 && (
                        <span className="text-sm" style={{ color: 'var(--muted)' }}>{t.settings.noAllergies}</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={t.settings.allergyPlaceholder}
                        value={newAllergy}
                        onChange={(e) => onNewAllergyChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            onAddAllergy()
                          }
                        }}
                        className="input"
                        style={{ flex: '1 1 auto', minWidth: 0 }}
                      />
                      <button
                        type="button"
                        onClick={onAddAllergy}
                        disabled={!newAllergy.trim()}
                        className="btn btn-secondary"
                      >
                        {t.settings.addAllergy}
                      </button>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={onSaveEdit}
                      disabled={saving || !editingChildForm.name}
                      className="btn btn-primary"
                    >
                      {saving ? t.common.saving : t.common.save}
                    </button>
                    <button
                      onClick={onCancelEdit}
                      className="btn btn-secondary"
                    >
                      {t.common.cancel}
                    </button>
                    <button
                      onClick={() => {
                        onCancelEdit()
                        onDeleteChild(child.id)
                      }}
                      className="btn ml-auto"
                      style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
                    >
                      {t.common.delete}
                    </button>
                  </div>
                </div>
              )
            }

            // View mode
            return (
              <div
                key={child.id}
                className="p-4 rounded-xl transition-colors cursor-pointer hover:shadow-md"
                style={{ background: 'var(--background)' }}
                onClick={() => onStartEdit(child)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-semibold"
                      style={{ background: colorConfig.bg, color: colorConfig.text }}
                    >
                      {child.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                          {child.name}
                        </span>
                        {child.birth_date && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--sand)', color: 'var(--muted)' }}>
                            {new Date(child.birth_date).toLocaleDateString('nb-NO')}
                          </span>
                        )}
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: child.location_type === 'school' ? 'rgba(126, 182, 196, 0.2)' : 'rgba(131, 166, 151, 0.2)',
                            color: child.location_type === 'school' ? 'var(--color-sky)' : 'var(--color-sage)',
                          }}
                        >
                          {child.location_type === 'school' ? t.settings.childLocationTypes.school : t.settings.childLocationTypes.kindergarten}
                        </span>
                      </div>
                      {child.location_name && (
                        <span className="text-sm" style={{ color: 'var(--muted)' }}>
                          {child.location_name}
                        </span>
                      )}
                      {child.allergies && child.allergies.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {child.allergies.map((allergy) => (
                            <span
                              key={allergy}
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
                            >
                              {allergy}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add new child form */}
      <form onSubmit={onAddChild} className="pt-6" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-sm font-medium mb-4" style={{ color: 'var(--foreground)' }}>
          {t.settings.addChild}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <input
            type="text"
            placeholder={t.settings.childName}
            value={newChild.name}
            onChange={(e) => onNewChildChange({ ...newChild, name: e.target.value })}
            className="input"
            required
          />
          <input
            type="text"
            placeholder={t.wizard.locationNamePlaceholder}
            value={newChild.location_name}
            onChange={(e) => onNewChildChange({ ...newChild, location_name: e.target.value })}
            className="input"
          />
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.settings.childBirthDate}</label>
            {newChild.birth_date ? (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={newChild.birth_date}
                  onChange={(e) => onNewChildChange({ ...newChild, birth_date: e.target.value })}
                  className="input flex-1"
                />
                <button
                  type="button"
                  onClick={() => onNewChildChange({ ...newChild, birth_date: '' })}
                  className="px-3 rounded-xl transition-colors hover:bg-[var(--sand)]"
                  style={{ color: 'var(--muted)' }}
                  title={t.common.remove}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onNewChildChange({ ...newChild, birth_date: new Date().toISOString().split('T')[0] })}
                className="input text-left w-full"
                style={{ color: 'var(--muted)' }}
              >
                + {t.settings.childBirthDate}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {/* Location type toggle */}
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => onNewChildChange({ ...newChild, location_type: 'kindergarten' })}
              className="py-2 px-4 text-sm font-medium transition-colors"
              style={{
                background: newChild.location_type === 'kindergarten' ? 'var(--color-sage)' : 'transparent',
                color: newChild.location_type === 'kindergarten' ? 'white' : 'var(--muted)',
              }}
            >
              {t.settings.childLocationTypes.kindergarten}
            </button>
            <button
              type="button"
              onClick={() => onNewChildChange({ ...newChild, location_type: 'school' })}
              className="py-2 px-4 text-sm font-medium transition-colors"
              style={{
                background: newChild.location_type === 'school' ? 'var(--color-sky)' : 'transparent',
                color: newChild.location_type === 'school' ? 'white' : 'var(--muted)',
              }}
            >
              {t.settings.childLocationTypes.school}
            </button>
          </div>
          {/* Color picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{t.settings.childColor}:</span>
            <div className="flex gap-1">
              {CHILD_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => onNewChildChange({ ...newChild, color: color.value })}
                  className="w-6 h-6 rounded-full transition-all"
                  style={{
                    background: color.bg,
                    border: newChild.color === color.value ? `2px solid ${color.text}` : '2px solid transparent',
                    transform: newChild.color === color.value ? 'scale(1.1)' : 'scale(1)',
                  }}
                  title={color.label}
                />
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={saving || !newChild.name}
            className="btn btn-primary ml-auto"
          >
            + {t.common.add}
          </button>
        </div>
      </form>
    </section>
  )
})
