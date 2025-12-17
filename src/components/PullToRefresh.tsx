'use client'

import { usePullToRefresh } from '@/hooks/usePullToRefresh'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
  disabled?: boolean
}

export function PullToRefresh({ onRefresh, children, disabled }: PullToRefreshProps) {
  const { isPulling, isRefreshing, pullDistance, progress } = usePullToRefresh({
    onRefresh,
    disabled,
  })

  return (
    <div className="relative">
      {/* Pull indicator */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center overflow-hidden transition-all duration-200"
        style={{
          top: -60,
          height: 60,
          transform: `translateY(${Math.min(pullDistance, 60)}px)`,
          opacity: isPulling || isRefreshing ? 1 : 0,
        }}
      >
        <div
          className="flex items-center justify-center"
          style={{
            transform: `rotate(${progress * 360}deg)`,
            transition: isRefreshing ? 'none' : 'transform 0.1s ease',
          }}
        >
          {isRefreshing ? (
            <div className="spinner" />
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                opacity: progress,
                transform: `scale(${0.5 + progress * 0.5})`,
              }}
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          transform: isPulling || isRefreshing ? `translateY(${Math.min(pullDistance, 60)}px)` : 'none',
          transition: isPulling ? 'none' : 'transform 0.3s ease',
        }}
      >
        {children}
      </div>
    </div>
  )
}
