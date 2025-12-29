import { TransitionLink } from '@/components/TransitionLink'
import { getLanguageFromCookieOrBrowser } from '@/lib/i18n/cookie.server'
import { getTranslations } from '@/lib/i18n/translations'

export default async function PrivacyPolicyPage() {
  const language = await getLanguageFromCookieOrBrowser()
  const t = getTranslations(language)

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      {/* Back link */}
      <TransitionLink
        href="/"
        className="inline-flex items-center gap-2 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--muted)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {t.common.back}
      </TransitionLink>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold font-display mb-2" style={{ color: 'var(--foreground)' }}>
          {t.legal.privacyPolicy}
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {t.legal.lastUpdated}: 22. desember 2024
        </p>
      </div>

      {/* Content sections */}
      <div className="space-y-8">
        {/* Who runs the app */}
        <Section title={t.legal.whoRunsTitle}>
          <p>{t.legal.whoRunsContent}</p>
        </Section>

        {/* No guarantees */}
        <Section title={t.legal.noGuaranteesTitle}>
          <p>{t.legal.noGuaranteesContent}</p>
        </Section>

        {/* What data is collected */}
        <Section title={t.legal.dataCollectedTitle}>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>{t.legal.dataAccountLabel}:</strong> {t.legal.dataAccountDesc}</li>
            <li><strong>{t.legal.dataFamilyLabel}:</strong> {t.legal.dataFamilyDesc}</li>
            <li><strong>{t.legal.dataIntegrationsLabel}:</strong> {t.legal.dataIntegrationsDesc}</li>
            <li><strong>{t.legal.dataPhotosLabel}:</strong> {t.legal.dataPhotosDesc}</li>
          </ul>
        </Section>

        {/* Where data is stored */}
        <Section title={t.legal.dataStorageTitle}>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>{t.legal.storageDatabase}:</strong> Supabase (AWS EU, Stockholm)</li>
            <li><strong>{t.legal.storageHosting}:</strong> Vercel (EU region)</li>
            <li><strong>{t.legal.storageAI}:</strong> OpenRouter ({t.legal.storageAINote})</li>
          </ul>
        </Section>

        {/* Who has access */}
        <Section title={t.legal.accessTitle}>
          <p>{t.legal.accessContent}</p>
        </Section>

        {/* Your rights */}
        <Section title={t.legal.rightsTitle}>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>{t.legal.rightsAccessLabel}:</strong> {t.legal.rightsAccessDesc}</li>
            <li><strong>{t.legal.rightsDeletionLabel}:</strong> {t.legal.rightsDeletionDesc}</li>
            <li><strong>{t.legal.rightsExportLabel}:</strong> {t.legal.rightsExportDesc}</li>
          </ul>
        </Section>

        {/* Cookies */}
        <Section title={t.legal.cookiesTitle}>
          <p>{t.legal.cookiesContent}</p>
        </Section>

        {/* Contact */}
        <Section title={t.legal.contactTitle}>
          <p>{t.legal.contactContent}</p>
        </Section>
      </div>

      {/* Footer link to terms */}
      <div className="pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <TransitionLink
          href="/vilkar"
          className="text-sm transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          {t.legal.termsOfService} →
        </TransitionLink>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
        {title}
      </h2>
      <div className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
        {children}
      </div>
    </section>
  )
}
