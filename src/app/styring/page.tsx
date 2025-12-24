'use client'

import { useLanguage } from '@/lib/i18n/context'
import { HomeControlPanel } from '@/components/integrations/HomeControlPanel'

export default function StyringPage() {
  const { t } = useLanguage()

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header mb-6">
        <h1 className="page-title">{t.nav.homeControl}</h1>
        <p style={{ color: 'var(--muted)' }}>
          {t.homeControl.connectSomfy.split('.')[0]}
        </p>
      </div>

      <HomeControlPanel />
    </div>
  )
}
