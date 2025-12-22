'use client'

import { CSSProperties } from 'react'
import type { TranslationStrings } from '@/lib/i18n/types'

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

// Feed page skeleton - matches /feed layout
export function FeedPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Skeleton height={32} width={100} borderRadius={12} className="mb-2" />
        <Skeleton height={18} width={320} borderRadius={8} />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-hidden">
        {['Alt', 'Spond', 'Skole', 'Barnehage', 'Bilder'].map((_, i) => (
          <Skeleton key={i} height={36} width={80 + i * 10} borderRadius={18} />
        ))}
      </div>

      {/* Feed items */}
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl p-5"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            {/* Source badge and date */}
            <div className="flex items-center justify-between mb-3">
              <Skeleton height={24} width={80} borderRadius={12} />
              <Skeleton height={14} width={60} borderRadius={6} />
            </div>
            {/* Title */}
            <Skeleton height={20} width="70%" borderRadius={8} className="mb-2" />
            {/* Content */}
            <SkeletonText lines={2} />
            {/* Child badge */}
            <div className="mt-3 flex items-center gap-2">
              <SkeletonCircle size={24} />
              <Skeleton height={14} width={60} borderRadius={6} />
            </div>
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

// =============================================================================
// PARTIAL SKELETONS - Show real UI, shimmer only for dynamic data
// These are used when we have no cached data yet (first visit)
// =============================================================================

// Week page partial skeleton - real title + shimmer for grid
export function WeekPagePartialSkeleton({ t }: { t: TranslationStrings }) {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* REAL header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.week.title}
          </h1>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            {t.week.editPickup}
          </p>
        </div>

        {/* REAL navigation buttons (disabled) */}
        <div className="flex items-center gap-2">
          <button
            disabled
            className="p-2 rounded-xl opacity-50"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div
            className="px-4 py-2 text-sm font-medium rounded-xl"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)' }}
          >
            {t.common.loading}...
          </div>
          <button
            disabled
            className="p-2 rounded-xl opacity-50"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      </div>

      {/* SHIMMER skeleton for week grid */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {/* Table header */}
        <div className="px-4 md:px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <Skeleton height={20} width={120} borderRadius={8} />
        </div>

        {/* Table content */}
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
    </div>
  )
}

// Shopping page partial skeleton - real title + shimmer for list
export function ShoppingPagePartialSkeleton({ t }: { t: TranslationStrings }) {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* REAL header */}
      <div>
        <h1 className="text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          {t.shopping.title}
        </h1>
      </div>

      {/* SHIMMER for input + list */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {/* Add item input skeleton */}
        <div className="flex gap-2 mb-4">
          <Skeleton height={48} className="flex-1" borderRadius={12} />
          <Skeleton height={48} width={48} borderRadius={12} />
        </div>

        {/* List items skeleton */}
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--card-alt)' }}>
              <Skeleton width={24} height={24} borderRadius={6} />
              <Skeleton height={18} style={{ width: `${50 + (i * 10) % 40}%` }} borderRadius={8} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Feed page partial skeleton - real title + shimmer for feed items
export function FeedPagePartialSkeleton({ t }: { t: TranslationStrings }) {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* REAL header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          {t.nav.feed}
        </h1>
        <p className="mt-1" style={{ color: 'var(--muted)' }}>
          Meldinger, bilder og varsler fra Spond, barnehage og skole
        </p>
      </div>

      {/* REAL filter tabs (disabled) */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mb-2">
        {['Alt', 'Spond', 'Skole', 'Barnehage', 'Bilder'].map((label, i) => (
          <button
            key={i}
            disabled
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${i === 0 ? 'opacity-100' : 'opacity-50'}`}
            style={{
              background: i === 0 ? 'var(--accent)' : 'var(--card)',
              color: i === 0 ? 'white' : 'var(--muted)',
              border: '1px solid var(--border)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* SHIMMER for feed items */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl p-5"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <Skeleton height={24} width={80} borderRadius={12} />
              <Skeleton height={14} width={60} borderRadius={6} />
            </div>
            <Skeleton height={20} width="70%" borderRadius={8} className="mb-2" />
            <SkeletonText lines={2} />
            <div className="mt-3 flex items-center gap-2">
              <SkeletonCircle size={24} />
              <Skeleton height={14} width={60} borderRadius={6} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Recipes page partial skeleton - real title + shimmer for grid
export function RecipesPagePartialSkeleton({ t }: { t: TranslationStrings }) {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* REAL header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl md:text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          {t.recipes.title}
        </h1>
        <button
          disabled
          className="btn btn-primary opacity-50"
        >
          + {t.recipes.addRecipe}
        </button>
      </div>

      {/* REAL search input (disabled) */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <span style={{ color: 'var(--muted)' }}>{t.recipes.searchPlaceholder}</span>
      </div>

      {/* SHIMMER for recipe grid */}
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

// Home page partial skeleton - real title + shimmer for content
export function HomePagePartialSkeleton({ t }: { t: TranslationStrings }) {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* REAL header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
            {t.home.welcome}
          </h1>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            {t.home.todayOverview}
          </p>
        </div>
      </div>

      {/* AI input - real shell */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <span style={{ color: 'var(--muted)' }}>{t.common.loading}...</span>
        </div>
      </div>

      {/* SHIMMER for today overview */}
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

      {/* SHIMMER for week preview */}
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
