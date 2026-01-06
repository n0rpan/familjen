'use client'

/**
 * HomePageContent Component
 *
 * Shared UI component for the home page.
 * Used by both production (with SSR data) and demo mode (with hook data).
 * This ensures visual consistency between demo and production.
 */

import { TodaySection } from '@/components/TodaySection'
import { AIHeadsUpSection } from '@/components/AIHeadsUpSection'
import { WeekSection } from '@/components/WeekSection'
import { UniversalAIInput } from '@/components/ai'
import { SuggestionBanner } from '@/components/integrations/SuggestionReview'
import { RecentPhotos } from '@/components/RecentPhotos'
import { HomeRefreshWrapper } from '@/components/HomeRefreshWrapper'
import { TransitionLink } from '@/components/TransitionLink'
import { useLanguage } from '@/lib/i18n/context'
import type {
  Child,
  HouseholdMember,
  PickupWithDetails,
  MealWithRecipe,
  MemberEvent,
  HouseholdEvent,
  ExternalEvent,
  ChildTask,
  AIHeadsUp,
  DaySummary,
} from '@/lib/types'
import type { Holiday } from '@/lib/utils'

// Photo type for RecentPhotos component
interface Photo {
  id: string
  title: string | null
  taken_at: string | null
  storage_path: string
  thumbnail_path: string | null
  child_name?: string | null
  image_url?: string | null
}

export interface HomePageContentProps {
  // Core data
  householdId: string
  currentUserId?: string
  children: Child[]
  members: HouseholdMember[]

  // Today's data
  todaySummary: DaySummary

  // Week data
  pickups: PickupWithDetails[]
  meals: MealWithRecipe[]
  memberEvents: MemberEvent[]
  householdEvents: HouseholdEvent[]
  externalEvents: ExternalEvent[]
  childTasks: ChildTask[]
  holidays: Holiday[]
  weekStart: Date

  // Additional features
  aiHeadsUps: AIHeadsUp[]
  recentPhotos: Photo[]

  // Status
  childrenWithoutPickup: Child[]
  noMeal: boolean
  isAllReady: boolean

  // Demo mode flag (to adjust links)
  isDemo?: boolean

  // Data freshness timestamp
  dataTimestamp?: number
}

export function HomePageContent({
  householdId,
  currentUserId,
  children,
  members,
  todaySummary,
  pickups,
  meals,
  memberEvents,
  householdEvents,
  externalEvents,
  childTasks,
  holidays,
  weekStart,
  aiHeadsUps,
  recentPhotos,
  childrenWithoutPickup,
  noMeal,
  isAllReady,
  isDemo = false,
  dataTimestamp,
}: HomePageContentProps) {
  const { t } = useLanguage()

  // Helper to create links that preserve demo mode
  const getHref = (path: string) => isDemo ? `${path}?demo=true` : path

  // Build descriptive attention message
  const getAttentionMessage = () => {
    const hasPickupIssue = childrenWithoutPickup.length > 0
    const hasMealIssue = noMeal

    if (hasPickupIssue && hasMealIssue) {
      if (childrenWithoutPickup.length === 1) {
        return t.home.missingPickupForAndDinner.replace('{name}', childrenWithoutPickup[0].name)
      }
      return t.home.missingPickupAndDinner
    } else if (hasPickupIssue) {
      if (childrenWithoutPickup.length === 1) {
        return t.home.missingPickupFor.replace('{name}', childrenWithoutPickup[0].name)
      }
      return t.home.missingPickup
    } else if (hasMealIssue) {
      return t.home.missingDinner
    }
    return ''
  }

  const content = (
    <div className="space-y-8 animate-fade-in">
      {/* Today's Status Summary */}
      {isAllReady ? (
        <div
          className="flex items-center justify-between px-4 py-3 rounded-xl"
          style={{
            background: 'rgba(139, 168, 136, 0.15)',
            border: '1px solid rgba(139, 168, 136, 0.3)',
          }}
        >
          <div className="flex items-center gap-3">
            {/* Pulsing indicator dot */}
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{
                background: 'var(--color-sage)',
                boxShadow: '0 0 8px var(--color-sage)',
              }}
            />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-sage)' }}>
              {t.home.allReadyForToday}
            </span>
          </div>
          <span
            className="text-xs px-2 py-1 rounded-full"
            style={{ background: 'var(--card)', color: 'var(--color-sage)' }}
          >
            {t.common.justNow}
          </span>
        </div>
      ) : (
        <TransitionLink
          href={getHref('/uke')}
          className="flex items-center justify-between px-4 py-3 rounded-xl transition-opacity hover:opacity-80"
          style={{
            background: 'rgba(229, 185, 94, 0.15)',
            border: '1px solid rgba(229, 185, 94, 0.3)',
          }}
        >
          <div className="flex items-center gap-3">
            {/* Pulsing indicator dot */}
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{
                background: 'var(--color-honey)',
                boxShadow: '0 0 8px var(--color-honey)',
              }}
            />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-honey)' }}>
              {getAttentionMessage()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-xs px-2 py-1 rounded-full"
              style={{ background: 'var(--card)', color: 'var(--color-honey)' }}
            >
              {t.common.justNow}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </TransitionLink>
      )}

      {/* Universal AI Input */}
      {!isDemo && currentUserId && (
        <UniversalAIInput
          householdId={householdId}
          children={children}
          members={members}
          currentUserId={currentUserId}
        />
      )}

      {/* Demo AI Input Placeholder */}
      {isDemo && (
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(126, 182, 196, 0.2)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2">
                <path d="M12 2a10 10 0 1 0 10 10H12V2Z" />
                <path d="M12 2a10 10 0 0 1 10 10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <input
              type="text"
              placeholder={t.home.askAI}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--muted)' }}
              disabled
            />
          </div>
        </div>
      )}

      {/* Suggestion Banner - only in production */}
      {!isDemo && (
        <SuggestionBanner
          householdId={householdId}
          children={children}
          members={members}
        />
      )}

      {/* Today's Overview */}
      <TodaySection
        summary={todaySummary}
        holidays={holidays}
        members={members}
        children={children}
        householdId={householdId}
      />

      {/* AI Heads Up - Week lookahead */}
      <AIHeadsUpSection items={aiHeadsUps} />

      {/* Recent Photos */}
      {recentPhotos.length > 0 && <RecentPhotos photos={recentPhotos} />}

      {/* Upcoming Days */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.common.upcomingDays}
          </h2>
          <TransitionLink
            href={getHref('/uke')}
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            {t.common.edit} →
          </TransitionLink>
        </div>
        <WeekSection
          children={children}
          members={members}
          pickups={pickups}
          meals={meals}
          memberEvents={memberEvents}
          householdEvents={householdEvents}
          externalEvents={externalEvents}
          childTasks={childTasks}
          holidays={holidays}
          weekStart={weekStart}
          showFromToday={true}
        />
      </div>
    </div>
  )

  // Wrap in HomeRefreshWrapper for production, or return directly for demo
  if (isDemo) {
    return content
  }

  return <HomeRefreshWrapper>{content}</HomeRefreshWrapper>
}
