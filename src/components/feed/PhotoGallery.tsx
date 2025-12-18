'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface FeedPhoto {
  id: string
  integration_id: string
  child_id: string | null
  external_id: string
  title: string | null
  taken_at: string | null
  storage_path: string
  thumbnail_path: string | null
  child_name?: string | null
  integration_name?: string | null
  image_url?: string | null // Signed URL for display
}

interface Props {
  photos: FeedPhoto[]
  onPhotoClick?: (photo: FeedPhoto, index: number) => void
}

export function PhotoGallery({ photos, onPhotoClick }: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)

  // For portal to work on client side
  useEffect(() => {
    setMounted(true)
  }, [])

  if (photos.length === 0) {
    return null
  }

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
  }

  const handlePhotoClick = (index: number) => {
    setSelectedIndex(index)
    onPhotoClick?.(photos[index], index)
  }

  const handleClose = () => {
    setSelectedIndex(null)
  }

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (selectedIndex !== null && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1)
    }
  }

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (selectedIndex !== null && selectedIndex < photos.length - 1) {
      setSelectedIndex(selectedIndex + 1)
    }
  }

  return (
    <>
      {/* Photo Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            onClick={() => handlePhotoClick(index)}
            className="relative aspect-square rounded-xl overflow-hidden group"
            style={{ background: 'var(--background)' }}
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
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ background: 'var(--sand)' }}
              >
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

            {/* Overlay on hover */}
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%)' }}
            >
              <div className="p-2 w-full">
                {photo.title && (
                  <p className="text-xs text-white truncate">{photo.title}</p>
                )}
                {photo.taken_at && (
                  <p className="text-xs text-white/70">{formatDate(photo.taken_at)}</p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Lightbox - rendered via portal to escape transform context */}
      {mounted && selectedIndex !== null && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.9)' }}
          onClick={handleClose}
        >
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-2 text-white hover:bg-white/10 rounded-full z-10"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Navigation */}
          {selectedIndex > 0 && (
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-white hover:bg-white/10 rounded-full z-10"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          {selectedIndex < photos.length - 1 && (
            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-white hover:bg-white/10 rounded-full z-10"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}

          {/* Photo */}
          <div
            className="max-w-4xl max-h-[80vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {photos[selectedIndex].image_url ? (
              <img
                src={photos[selectedIndex].image_url}
                alt={photos[selectedIndex].title || 'Bilde'}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
            ) : (
              <div
                className="w-96 h-96 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--card)' }}
              >
                <div className="text-center">
                  <svg
                    width="64"
                    height="64"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    style={{ color: 'var(--muted)', margin: '0 auto' }}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <p className="mt-4 text-sm" style={{ color: 'var(--muted)' }}>
                    {photos[selectedIndex].title || 'Bilde'}
                  </p>
                  {photos[selectedIndex].taken_at && (
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                      {formatDate(photos[selectedIndex].taken_at)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Counter */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm">
            {selectedIndex + 1} / {photos.length}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
