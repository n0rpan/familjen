'use client'

interface SectionGroupLabelProps {
  label: string
}

export function SectionGroupLabel({ label }: SectionGroupLabelProps) {
  return (
    <div className="pt-4 pb-1 first:pt-0">
      <span
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </span>
    </div>
  )
}
