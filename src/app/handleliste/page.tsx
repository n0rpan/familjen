'use client'

import { useSearchParams } from 'next/navigation'
import { DemoShoppingPage } from '@/components/demo/DemoShoppingPage'
import { ShoppingPageContent } from '@/components/shopping/ShoppingPageContent'

export default function ShoppingListPage() {
  // Check for demo mode
  const searchParams = useSearchParams()
  const isDemo = searchParams.get('demo') === 'true'

  // Demo mode: render demo shopping page
  if (isDemo) {
    return <DemoShoppingPage />
  }

  // Production mode: render full shopping page
  return <ShoppingPageContent />
}
