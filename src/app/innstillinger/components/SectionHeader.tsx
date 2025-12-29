'use client'

import { ReactNode } from 'react'

interface SectionHeaderProps {
  icon: ReactNode
  title: string
  description?: string
  color: string // CSS color variable like 'var(--color-sky)'
}

export function SectionHeader({ icon, title, description, color }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-6 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `color-mix(in srgb, ${color} 20%, transparent)` }}
      >
        <div style={{ color }}>{icon}</div>
      </div>
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
          {title}
        </h2>
        {description && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
