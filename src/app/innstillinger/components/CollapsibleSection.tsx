'use client'

import { useState, useId, ReactNode } from 'react'

interface CollapsibleSectionProps {
  icon: ReactNode
  title: string
  description?: string
  color: string
  defaultOpen?: boolean
  children: ReactNode
}

export function CollapsibleSection({
  icon,
  title,
  description,
  color,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 sm:p-6 flex items-center gap-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors rounded-t-2xl"
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 20%, transparent)` }}
        >
          <div style={{ color }}>{icon}</div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
            {title}
          </h3>
          {description && (
            <p className="text-sm truncate" style={{ color: 'var(--muted)' }}>
              {description}
            </p>
          )}
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div
        id={contentId}
        className={`transition-all duration-200 ease-in-out overflow-hidden ${
          isOpen ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 sm:px-6 pb-6 pt-2 border-t relative" style={{ borderColor: 'var(--border)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
