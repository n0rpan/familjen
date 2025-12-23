'use client'

import { useState, memo } from 'react'
import type { Child, HouseholdMember } from '@/lib/types'
import type { TranslationStrings } from '@/lib/i18n/types'
import { CHILD_COLORS } from '@/lib/colors'
import { WishlistSection } from '@/components/wishlist/WishlistSection'

interface WishlistsSectionProps {
  householdId: string
  children: Child[]
  members: HouseholdMember[]
  t: TranslationStrings
}

export const WishlistsSection = memo(function WishlistsSection({
  householdId,
  children,
  members,
  t,
}: WishlistsSectionProps) {
  // Track which person's wishlist is expanded
  const [expandedPersonId, setExpandedPersonId] = useState<string | null>(null)
  const [expandedPersonType, setExpandedPersonType] = useState<'child' | 'member' | null>(null)

  const togglePerson = (id: string, type: 'child' | 'member') => {
    if (expandedPersonId === id && expandedPersonType === type) {
      setExpandedPersonId(null)
      setExpandedPersonType(null)
    } else {
      setExpandedPersonId(id)
      setExpandedPersonType(type)
    }
  }

  // Get parents only (they have wishlists)
  const parents = members.filter(m => m.is_parent)

  return (
    <section
      className="rounded-2xl p-6 md:p-8"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(167, 139, 250, 0.2)' }}
        >
          <span className="text-xl">🎁</span>
        </div>
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
            {t.wishlists.title}
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.wishlists.sectionDesc}
          </p>
        </div>
      </div>

      {/* Children wishlists */}
      {children.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
            {t.settings.children}
          </h3>
          {children.map((child) => {
            const colorConfig = CHILD_COLORS.find(c => c.value === child.color) || CHILD_COLORS[0]
            const isExpanded = expandedPersonId === child.id && expandedPersonType === 'child'

            return (
              <div key={child.id}>
                <button
                  onClick={() => togglePerson(child.id, 'child')}
                  className="w-full flex items-center gap-3 p-4 rounded-xl transition-colors"
                  style={{
                    background: isExpanded ? 'var(--background)' : 'transparent',
                    border: isExpanded ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                    style={{ background: colorConfig.bg, color: colorConfig.text }}
                  >
                    {child.name.charAt(0)}
                  </div>
                  <div className="flex-1 text-left">
                    <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                      {child.name}
                    </span>
                  </div>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--muted)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  >
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                </button>

                {isExpanded && (
                  <div className="mt-3 pl-4 border-l-2" style={{ borderColor: colorConfig.text }}>
                    <WishlistSection
                      personId={child.id}
                      personType="child"
                      personName={child.name}
                      householdId={householdId}
                      showShareLink={true}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Parent wishlists */}
      {parents.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
            {t.settings.members}
          </h3>
          {parents.map((member) => {
            const isExpanded = expandedPersonId === member.id && expandedPersonType === 'member'

            return (
              <div key={member.id}>
                <button
                  onClick={() => togglePerson(member.id, 'member')}
                  className="w-full flex items-center gap-3 p-4 rounded-xl transition-colors"
                  style={{
                    background: isExpanded ? 'var(--background)' : 'transparent',
                    border: isExpanded ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                    style={{ background: 'rgba(232, 120, 109, 0.2)', color: 'var(--color-coral)' }}
                  >
                    {member.name.charAt(0)}
                  </div>
                  <div className="flex-1 text-left">
                    <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                      {member.name}
                    </span>
                  </div>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--muted)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  >
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                </button>

                {isExpanded && (
                  <div className="mt-3 pl-4 border-l-2" style={{ borderColor: 'var(--color-coral)' }}>
                    <WishlistSection
                      personId={member.id}
                      personType="member"
                      personName={member.name}
                      householdId={householdId}
                      showShareLink={true}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {children.length === 0 && parents.length === 0 && (
        <p className="text-center py-8" style={{ color: 'var(--muted)' }}>
          {t.wishlists.noItems}
        </p>
      )}
    </section>
  )
})
