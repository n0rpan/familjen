'use client'

import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type { Child, HouseholdMember } from '@/lib/types'
import { WishlistSection } from './WishlistSection'
import type { WishlistPrefillData } from './AddWishlistItemModal'

// Key for localStorage prefill data (set by AI navigation)
const PREFILL_STORAGE_KEY = 'wishlist-prefill'

// Extended prefill data structure (includes person selection)
interface StoredPrefillData extends WishlistPrefillData {
  childId?: string | null
  memberId?: string | null
}

interface WishlistOverviewProps {
  householdId: string
}

interface PersonWithWishlist {
  id: string
  name: string
  type: 'child' | 'member'
  itemCount: number
}

export const WishlistOverview = memo(function WishlistOverview({
  householdId,
}: WishlistOverviewProps) {
  const { t } = useLanguage()
  const supabase = useMemo(() => createClient(), [])
  const searchParams = useSearchParams()

  const [children, setChildren] = useState<Child[]>([])
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({})
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [prefillData, setPrefillData] = useState<StoredPrefillData | null>(null)
  const [shouldAutoOpen, setShouldAutoOpen] = useState(false)

  // Fetch children, members, and item counts
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      try {
        // Fetch children
        const { data: childrenData } = await supabase
          .from('children')
          .select('*')
          .eq('household_id', householdId)
          .order('sort_order')

        // Fetch members
        const { data: membersData } = await supabase
          .from('household_members')
          .select('*')
          .eq('household_id', householdId)

        // Fetch item counts grouped by person
        const { data: itemsData } = await supabase
          .from('wishlist_items')
          .select('id, child_id, member_id')
          .eq('household_id', householdId)

        setChildren(childrenData || [])
        setMembers(membersData || [])

        // Count items per person
        const counts: Record<string, number> = {}
        if (itemsData) {
          itemsData.forEach(item => {
            const key = item.child_id || item.member_id
            if (key) {
              counts[key] = (counts[key] || 0) + 1
            }
          })
        }
        setItemCounts(counts)
      } catch (err) {
        console.error('Failed to fetch wishlist overview:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase, householdId])

  // Check for addWishlist query param and localStorage prefill data
  useEffect(() => {
    const addWishlist = searchParams.get('addWishlist') === 'true'
    if (!addWishlist) return

    // Clear the query param immediately to prevent re-triggering
    const url = new URL(window.location.href)
    url.searchParams.delete('addWishlist')
    window.history.replaceState({}, '', url.toString())

    // Read prefill data from localStorage
    try {
      const stored = localStorage.getItem(PREFILL_STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored) as StoredPrefillData
        setPrefillData(data)
        setShouldAutoOpen(true)

        // Determine which person to expand based on prefill data
        const personId = data.childId || data.memberId
        if (personId) {
          setExpandedPerson(personId)
        }
      }
    } catch (err) {
      console.error('Failed to read wishlist prefill data:', err)
    }
  }, [searchParams])

  // Clear prefill data from localStorage after it's been consumed
  const handlePrefillConsumed = useCallback(() => {
    setPrefillData(null)
    setShouldAutoOpen(false)
    try {
      localStorage.removeItem(PREFILL_STORAGE_KEY)
    } catch (err) {
      console.error('Failed to clear wishlist prefill data:', err)
    }
    // Note: Query param already cleared immediately in useEffect above
  }, [])

  // Combined list of people with wishlists (children first, then members)
  const people = useMemo(() => {
    const list: PersonWithWishlist[] = [
      ...children.map(c => ({
        id: c.id,
        name: c.name,
        type: 'child' as const,
        itemCount: itemCounts[c.id] || 0,
      })),
      ...members.map(m => ({
        id: m.id,
        name: m.name,
        type: 'member' as const,
        itemCount: itemCounts[m.id] || 0,
      })),
    ]
    return list
  }, [children, members, itemCounts])

  const totalItems = useMemo(() =>
    Object.values(itemCounts).reduce((sum, count) => sum + count, 0),
    [itemCounts]
  )

  const handleToggle = useCallback((personId: string) => {
    setExpandedPerson(prev => prev === personId ? null : personId)
  }, [])

  const handleItemCountChange = useCallback((personId: string, delta: number) => {
    setItemCounts(prev => ({
      ...prev,
      [personId]: Math.max(0, (prev[personId] || 0) + delta),
    }))
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-32 rounded-lg" style={{ background: 'var(--sand)' }} />
        <div className="h-24 rounded-xl" style={{ background: 'var(--sand)' }} />
      </div>
    )
  }

  if (people.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(174, 156, 200, 0.2)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-lavender)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
              {t.wishlists.title}
            </h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {totalItems} {totalItems === 1 ? t.wishlists.item : t.wishlists.items}
            </p>
          </div>
        </div>
      </div>

      {/* Person cards */}
      <div className="space-y-3">
        {people.map(person => (
          <div
            key={person.id}
            className="rounded-xl overflow-hidden"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            {/* Collapsed header - always visible */}
            <button
              onClick={() => handleToggle(person.id)}
              className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-[var(--sand)]"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">
                  {person.type === 'child' ? '👶' : '👤'}
                </span>
                <div>
                  <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {person.name}
                  </span>
                  <span className="ml-2 text-sm" style={{ color: 'var(--muted)' }}>
                    ({person.itemCount} {person.itemCount === 1 ? t.wishlists.item : t.wishlists.items})
                  </span>
                </div>
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
                className="transition-transform"
                style={{ transform: expandedPerson === person.id ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* Expanded content */}
            {expandedPerson === person.id && (
              <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="p-4">
                  <WishlistSection
                    personId={person.id}
                    personType={person.type}
                    personName={person.name}
                    householdId={householdId}
                    showShareLink={true}
                    onItemCountChange={(delta) => handleItemCountChange(person.id, delta)}
                    // Pass prefill data only to the correct person
                    prefillData={
                      shouldAutoOpen &&
                      ((person.type === 'child' && prefillData?.childId === person.id) ||
                       (person.type === 'member' && prefillData?.memberId === person.id))
                        ? prefillData
                        : null
                    }
                    autoOpenModal={
                      shouldAutoOpen &&
                      ((person.type === 'child' && prefillData?.childId === person.id) ||
                       (person.type === 'member' && prefillData?.memberId === person.id))
                    }
                    onPrefillConsumed={handlePrefillConsumed}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})
