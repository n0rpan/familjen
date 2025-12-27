'use client'

import { useSearchParams } from 'next/navigation'
import { DemoSettingsPage } from '@/components/demo/DemoSettingsPage'
import { SettingsPageContent } from '@/components/settings/SettingsPageContent'

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const isDemo = searchParams.get('demo') === 'true'

  if (isDemo) {
    return <DemoSettingsPage />
  }

  return <SettingsPageContent />
}
