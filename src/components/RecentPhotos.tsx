'use client'

import Link from 'next/link'
import { useLanguage } from '@/lib/i18n/context'

interface Photo {
  id: string
  title: string | null
  taken_at: string | null
  storage_path: string
  thumbnail_path: string | null
  child_name?: string | null
  image_url?: string | null
}

interface Props {
  photos: Photo[]
}

export function RecentPhotos({ photos }: Props) {
  const { t } = useLanguage()

  if (photos.length === 0) {
    return null
  }

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          Siste bilder
        </h2>
        <Link
          href="/feed?filter=photos"
          className="text-sm font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--accent)' }}
        >
          Se alle →
        </Link>
      </div>

      {/* Horizontal scroll container */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {photos.slice(0, 4).map((photo) => (
          <Link
            key={photo.id}
            href="/feed?filter=photos"
            className="flex-shrink-0 w-32 sm:w-40 group"
          >
            <div
              className="relative aspect-square rounded-xl overflow-hidden transition-transform group-hover:scale-[1.02]"
              style={{ background: 'var(--sand)' }}
            >
              {/* Photo or placeholder */}
              {photo.image_url ? (
                <img
                  src={photo.image_url}
                  alt={photo.title || 'Bilde'}
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    style={{ color: 'var(--muted)' }}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
              )}

              {/* Overlay */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 50%)' }}
              />
            </div>

            {/* Caption */}
            <div className="mt-2">
              {photo.title && (
                <p
                  className="text-xs font-medium truncate"
                  style={{ color: 'var(--foreground)' }}
                >
                  {photo.title}
                </p>
              )}
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {photo.child_name || formatDate(photo.taken_at) || 'Bilde'}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
