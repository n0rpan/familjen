/**
 * RecipesDataLoader - Server Component
 *
 * Fetches all recipes page data on the server and passes to RecipesPageContent.
 * Works for both production (Supabase) and demo mode (generated data).
 */

import { fetchRecipesPageData, getDemoRecipesPageData } from '@/lib/data/server'
import { RecipesPageContent } from './RecipesPageContent'

interface RecipesDataLoaderProps {
  householdId: string
  isDemo: boolean
}

export async function RecipesDataLoader({ householdId, isDemo }: RecipesDataLoaderProps) {
  const data = isDemo
    ? getDemoRecipesPageData()
    : await fetchRecipesPageData(householdId)

  return (
    <RecipesPageContent
      initialData={data}
      isDemo={isDemo}
    />
  )
}
