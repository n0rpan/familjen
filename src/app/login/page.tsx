'use client'

import { useState, useEffect, Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTranslation } from '@/lib/i18n/context'

function LoginContent() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const t = useTranslation()

  useEffect(() => {
    const error = searchParams.get('error')
    if (error === 'not_allowed') {
      setMessage({
        type: 'error',
        text: t.login.errorNotAllowed,
      })
    } else if (error === 'auth_failed') {
      setMessage({
        type: 'error',
        text: t.login.errorAuthFailed,
      })
    }
  }, [searchParams, t])

  const handleGoogleLogin = async () => {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setMessage({ type: 'error', text: error.message })
      setLoading(false)
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setLoading(true)
    setMessage(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setLoading(false)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({
        type: 'success',
        text: t.login.checkEmail,
      })
    }
  }

  return (
    <div className="min-h-screen flex flex-col grain" style={{ background: 'var(--background)' }}>
      {/* Decorative elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, var(--color-coral) 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, var(--color-sage) 0%, transparent 70%)' }}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-5 py-12 relative">
        <div className="w-full max-w-md animate-slide-up">
          {/* Logo & Header */}
          <div className="text-center mb-10">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
              style={{ background: 'var(--accent)' }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9,22 9,12 15,12 15,22"/>
              </svg>
            </div>
            <h1
              className="text-4xl font-semibold mb-3 font-display"
              style={{ color: 'var(--foreground)' }}
            >
              Familjen
            </h1>
            <p style={{ color: 'var(--muted)' }} className="text-lg">
              {t.login.subtitle}
            </p>
          </div>

          {/* Login Card */}
          <div
            className="rounded-2xl p-8 shadow-xl stagger-children"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)'
            }}
          >
            {/* Google Login */}
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-5 py-4 rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
              style={{
                background: 'var(--background)',
                border: '1.5px solid var(--border)'
              }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                {t.login.continueWithGoogle}
              </span>
            </button>

            {/* Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full" style={{ borderTop: '1px solid var(--border)' }} />
              </div>
              <div className="relative flex justify-center">
                <span
                  className="px-4 text-sm"
                  style={{ background: 'var(--card)', color: 'var(--muted)' }}
                >
                  {t.common.or}
                </span>
              </div>
            </div>

            {/* Magic Link Form */}
            <form onSubmit={handleMagicLink} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium mb-2"
                  style={{ color: 'var(--foreground)' }}
                >
                  {t.login.emailLabel}
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.login.emailPlaceholder}
                  className="input"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || !email}
                className="btn btn-primary w-full py-4 text-base disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    <span>{t.login.sending}</span>
                  </>
                ) : (
                  t.login.sendMagicLink
                )}
              </button>
            </form>

            {/* Message */}
            {message && (
              <div
                className="mt-6 p-4 rounded-xl text-sm animate-fade-in"
                style={{
                  background: message.type === 'success'
                    ? 'rgba(139, 168, 136, 0.15)'
                    : 'rgba(232, 120, 109, 0.15)',
                  color: message.type === 'success'
                    ? '#5A7A57'
                    : 'var(--color-coral-dark)',
                }}
              >
                {message.type === 'success' && (
                  <span className="inline-block mr-2">✓</span>
                )}
                {message.text}
              </div>
            )}
          </div>

          {/* Footer */}
          <p
            className="text-center mt-8 text-sm"
            style={{ color: 'var(--muted)' }}
          >
            Trygg innlogging • Ingen passord nødvendig
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4" style={{ background: 'var(--sand)' }} />
          <div className="h-6 w-32 rounded mx-auto" style={{ background: 'var(--sand)' }} />
        </div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
