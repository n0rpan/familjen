import Link from 'next/link'
import { connection } from 'next/server'

/**
 * Custom 404 Page
 *
 * Uses default Norwegian text for simplicity.
 * Must call connection() to opt out of static prerendering since
 * the root layout uses cookies() for language detection.
 */
export default async function NotFound() {
  // Opt into dynamic rendering - required for Next.js 16 with cacheComponents
  // because the root layout accesses cookies()
  await connection()
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-4">
        <div
          className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6"
          style={{ background: 'rgba(126, 182, 196, 0.2)' }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-sky)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </div>
        <h1
          className="text-3xl font-semibold font-display mb-3"
          style={{ color: 'var(--foreground)' }}
        >
          Siden finnes ikke
        </h1>
        <p className="mb-8" style={{ color: 'var(--muted)' }}>
          Vi fant ikke siden du leter etter. Den kan ha blitt flyttet eller slettet.
        </p>
        <Link
          href="/"
          className="btn btn-primary"
        >
          Gå til forsiden
        </Link>
      </div>
    </div>
  )
}
