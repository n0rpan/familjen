import { TransitionLink } from '@/components/TransitionLink'
import { getLanguageFromCookieOrBrowser } from '@/lib/i18n/cookie.server'
import { getTranslations } from '@/lib/i18n/translations'

export default async function TermsOfServicePage() {
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
          {t.legal.termsOfService}
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {t.legal.lastUpdated}: 22. desember 2024
        </p>
      </div>

      {/* Content sections */}
      <div className="space-y-8">
        {/* Acceptance */}
        <Section title={t.legal.termsAcceptanceTitle}>
          <p>{t.legal.termsAcceptanceContent}</p>
        </Section>

        {/* The service */}
        <Section title={t.legal.termsServiceTitle}>
          <p>{t.legal.termsServiceContent}</p>
        </Section>

        {/* No guarantees */}
        <Section title={t.legal.termsNoGuaranteesTitle}>
          <p>{t.legal.termsNoGuaranteesContent}</p>
        </Section>

        {/* Your responsibility */}
        <Section title={t.legal.termsResponsibilityTitle}>
          <ul className="list-disc pl-5 space-y-2">
            <li>{t.legal.termsResponsibility1}</li>
            <li>{t.legal.termsResponsibility2}</li>
            <li>{t.legal.termsResponsibility3}</li>
          </ul>
        </Section>

        {/* Your content */}
        <Section title={t.legal.termsContentTitle}>
          <p>{t.legal.termsContentContent}</p>
        </Section>

        {/* Termination */}
        <Section title={t.legal.termsTerminationTitle}>
          <p>{t.legal.termsTerminationContent}</p>
        </Section>

        {/* Changes */}
        <Section title={t.legal.termsChangesTitle}>
          <p>{t.legal.termsChangesContent}</p>
        </Section>
      </div>

      {/* Footer link to privacy */}
      <div className="pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <TransitionLink
          href="/personvern"
          className="text-sm transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          {t.legal.privacyPolicy} →
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
