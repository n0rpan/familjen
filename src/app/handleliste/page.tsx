'use client'

import { ShoppingPageContent } from '@/components/shopping/ShoppingPageContent'

/**
 * Shopping List Page
 *
 * Uses ShoppingPageContent which internally handles both demo and production modes.
 * Demo mode is detected via ?demo=true URL parameter.
 */
export default function ShoppingListPage() {
  return <ShoppingPageContent />
}
