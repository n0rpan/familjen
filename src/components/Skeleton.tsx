'use client'

import { CSSProperties } from 'react'

interface SkeletonProps {
  className?: string
  style?: CSSProperties
  width?: string | number
  height?: string | number
  borderRadius?: string | number
}

// Base skeleton with shimmer animation
export function Skeleton({ className = '', style, width, height, borderRadius }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  )
}

// Text line skeleton
export function SkeletonText({ lines = 1, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={16}
          borderRadius={8}
          style={{ width: i === lines - 1 && lines > 1 ? '70%' : '100%' }}
        />
      ))}
    </div>
  )
}

// Circle skeleton (for avatars)
export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return <Skeleton width={size} height={size} borderRadius="50%" />
}

// Card skeleton
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl p-6 ${className}`}
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-3 mb-4">
        <SkeletonCircle size={40} />
        <div className="flex-1">
          <Skeleton height={18} width="60%" borderRadius={8} className="mb-2" />
          <Skeleton height={14} width="40%" borderRadius={6} />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  )
}

// Home page skeleton
// Note: Skeletons appear instantly (no animate-fade-in) so content can smoothly fade in over them
export function HomePageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex justify-between items-center">
        <div>
          <Skeleton height={32} width={200} borderRadius={12} className="mb-2" />
          <Skeleton height={20} width={140} borderRadius={8} />
        </div>
        <Skeleton height={40} width={100} borderRadius={12} />
      </div>

      {/* AI input skeleton */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <Skeleton height={24} width={24} borderRadius={8} />
          <Skeleton height={20} width="70%" borderRadius={8} />
        </div>
      </div>

      {/* Today overview skeleton */}
      <div
        className="rounded-2xl p-6"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <Skeleton height={24} width={120} borderRadius={8} className="mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 rounded-xl" style={{ background: 'var(--card-alt)' }}>
              <Skeleton height={16} width="50%" borderRadius={6} className="mb-3" />
              <div className="flex items-center gap-2">
                <SkeletonCircle size={32} />
                <Skeleton height={18} width="60%" borderRadius={8} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Week preview skeleton */}
      <div
        className="rounded-2xl p-6"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <Skeleton height={24} width={150} borderRadius={8} className="mb-4" />
        <div className="flex gap-2 overflow-hidden">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div
              key={i}
              className="flex-1 min-w-[100px] p-3 rounded-xl"
              style={{ background: 'var(--card-alt)' }}
            >
              <Skeleton height={14} width="70%" borderRadius={6} className="mb-2" />
              <Skeleton height={20} width="90%" borderRadius={8} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Week page skeleton - matches /uke layout
export function WeekPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header with week navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Skeleton height={32} width={160} borderRadius={12} className="mb-2" />
          <Skeleton height={18} width={140} borderRadius={8} />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton height={40} width={40} borderRadius={12} />
          <Skeleton height={40} width={120} borderRadius={12} />
          <Skeleton height={40} width={40} borderRadius={12} />
        </div>
      </div>

      {/* Week context + Action buttons row */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <Skeleton height={20} width={180} borderRadius={8} className="flex-1" />
        <div className="flex items-center gap-2 shrink-0">
          <Skeleton height={42} width={42} borderRadius={12} />
          <Skeleton height={42} width={42} borderRadius={12} />
          <Skeleton height={42} width={42} borderRadius={12} />
          <Skeleton height={42} width={160} borderRadius={12} />
        </div>
      </div>

      {/* Add event button */}
      <div className="flex items-center gap-3">
        <Skeleton height={42} width={160} borderRadius={12} />
        <Skeleton height={18} width={80} borderRadius={8} />
      </div>

      {/* Week grid table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {/* Table header */}
        <div className="px-4 md:px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <Skeleton height={20} width={120} borderRadius={8} />
        </div>

        {/* Table content - horizontal scroll container */}
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* Day headers row */}
            <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="w-24 p-3 shrink-0" />
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex-1 min-w-[80px] p-3 flex flex-col items-center gap-1">
                  <Skeleton height={14} width={32} borderRadius={6} />
                  <Skeleton height={12} width={20} borderRadius={4} />
                </div>
              ))}
            </div>

            {/* Child rows */}
            {[0, 1].map((childIndex) => (
              <div key={childIndex} className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="w-24 p-3 shrink-0 flex items-center gap-2">
                  <Skeleton height={28} width={28} borderRadius="50%" />
                  <Skeleton height={14} width={50} borderRadius={6} />
                </div>
                {[0, 1, 2, 3, 4, 5, 6].map((dayIndex) => (
                  <div key={dayIndex} className="flex-1 min-w-[80px] p-2">
                    <Skeleton height={36} borderRadius={8} className="mb-1" />
                    <Skeleton height={20} width="80%" borderRadius={6} />
                  </div>
                ))}
              </div>
            ))}

            {/* Meal row */}
            <div className="flex">
              <div className="w-24 p-3 shrink-0 flex items-center gap-2">
                <Skeleton height={28} width={28} borderRadius={8} />
                <Skeleton height={14} width={50} borderRadius={6} />
              </div>
              {[0, 1, 2, 3, 4, 5, 6].map((dayIndex) => (
                <div key={dayIndex} className="flex-1 min-w-[80px] p-2">
                  <Skeleton height={36} borderRadius={8} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tips section */}
      <div
        className="flex items-start gap-3 p-4 rounded-xl"
        style={{ background: 'rgba(126, 182, 196, 0.15)' }}
      >
        <Skeleton height={32} width={32} borderRadius={8} />
        <div className="flex-1">
          <Skeleton height={16} width="40%" borderRadius={6} className="mb-2" />
          <Skeleton height={14} width="70%" borderRadius={6} />
        </div>
      </div>
    </div>
  )
}

// Settings page skeleton
export function SettingsPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Skeleton height={32} width={180} borderRadius={12} className="mb-2" />
        <Skeleton height={20} width={220} borderRadius={8} />
      </div>

      {/* Profile section */}
      <SkeletonCard />

      {/* Other sections */}
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-2xl p-6"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3 mb-4">
            <Skeleton height={40} width={40} borderRadius={12} />
            <div>
              <Skeleton height={20} width={150} borderRadius={8} className="mb-1" />
              <Skeleton height={14} width={200} borderRadius={6} />
            </div>
          </div>
          <div className="space-y-3">
            {[1, 2].map((j) => (
              <div key={j} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--card-alt)' }}>
                <div className="flex items-center gap-3">
                  <SkeletonCircle size={36} />
                  <Skeleton height={16} width={120} borderRadius={8} />
                </div>
                <Skeleton height={24} width={60} borderRadius={8} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Recipes page skeleton
export function RecipesPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <Skeleton height={32} width={150} borderRadius={12} />
        <Skeleton height={40} width={120} borderRadius={12} />
      </div>

      {/* Search */}
      <Skeleton height={48} borderRadius={12} />

      {/* Recipe grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="rounded-xl p-4"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <Skeleton height={24} width="70%" borderRadius={8} className="mb-3" />
            <SkeletonText lines={2} />
            <div className="flex gap-2 mt-3">
              <Skeleton height={24} width={60} borderRadius={12} />
              <Skeleton height={24} width={80} borderRadius={12} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Admin page skeleton
export function AdminPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Skeleton height={32} width={200} borderRadius={12} className="mb-2" />
        <Skeleton height={20} width={280} borderRadius={8} />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl p-4"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <Skeleton height={14} width="50%" borderRadius={6} className="mb-2" />
            <Skeleton height={28} width="40%" borderRadius={8} />
          </div>
        ))}
      </div>

      {/* Sections */}
      {[1, 2, 3].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

// List skeleton (for shopping list, etc.)
// Deterministic widths for consistent visual appearance
const LIST_ITEM_WIDTHS = ['65%', '80%', '55%', '70%', '60%', '75%', '50%', '85%']

export function ListPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <Skeleton height={32} width={180} borderRadius={12} />
        <Skeleton height={40} width={100} borderRadius={12} />
      </div>

      {/* Add item input */}
      <div className="flex gap-2">
        <Skeleton height={48} className="flex-1" borderRadius={12} />
        <Skeleton height={48} width={80} borderRadius={12} />
      </div>

      {/* Section title */}
      <Skeleton height={18} width={100} borderRadius={8} />

      {/* List items */}
      <div className="space-y-2">
        {LIST_ITEM_WIDTHS.map((width, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-4 rounded-xl"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <Skeleton height={24} width={24} borderRadius={6} />
            <Skeleton height={18} width={width} borderRadius={8} />
          </div>
        ))}
      </div>
    </div>
  )
}

// Wizard skeleton (for multi-step forms)
export function WizardSkeleton() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center py-8">
      <div className="w-full max-w-lg">
        {/* Progress bar */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={6} width={64} borderRadius={99} />
          ))}
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          {/* Icon and header */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <Skeleton height={64} width={64} borderRadius={16} />
            </div>
            <Skeleton height={28} width="60%" borderRadius={12} className="mx-auto mb-3" />
            <Skeleton height={18} width="80%" borderRadius={8} className="mx-auto" />
          </div>

          {/* Form fields */}
          <div className="space-y-5">
            <div>
              <Skeleton height={14} width={120} borderRadius={6} className="mb-2" />
              <Skeleton height={48} borderRadius={12} />
            </div>
            <div>
              <Skeleton height={14} width={100} borderRadius={6} className="mb-2" />
              <Skeleton height={48} borderRadius={12} />
            </div>
            <div>
              <Skeleton height={14} width={140} borderRadius={6} className="mb-2" />
              <Skeleton height={48} borderRadius={12} />
            </div>
          </div>

          {/* Button */}
          <Skeleton height={48} borderRadius={12} className="mt-6" />
        </div>
      </div>
    </div>
  )
}
