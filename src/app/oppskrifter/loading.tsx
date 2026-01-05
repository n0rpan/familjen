'use client'

import { RecipesPageSkeleton } from '@/components/Skeleton'
import { SmartLoading } from '@/components/SmartLoading'
import { RecipesPageContent } from '@/components/recipes/RecipesPageContent'
import type { CachedRecipesData } from '@/components/recipes/RecipesDataCache'

/**
 * Recipes page loading state
 *
 * Uses SmartLoading to show cached data instead of skeleton during navigation.
 * Falls back to skeleton only when no cache is available.
 */
export default function RecipesLoading() {
  return (
    <SmartLoading page="recipes" skeleton={<RecipesPageSkeleton />}>
      {(rawData) => {
        const data = rawData as CachedRecipesData
        return (
          <RecipesPageContent
            initialData={data}
            isDemo={false}
          />
        )
      }}
    </SmartLoading>
  )
}
