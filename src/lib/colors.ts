import type { ChildColor, MemberEventType, ChildTaskType } from './types'

// Child color definitions with CSS values
export const CHILD_COLOR_MAP: Record<ChildColor, { bg: string; text: string }> = {
  sky: { bg: 'rgba(126, 182, 196, 0.3)', text: 'var(--color-sky)' },
  coral: { bg: 'rgba(232, 120, 109, 0.3)', text: 'var(--color-coral)' },
  sage: { bg: 'rgba(131, 166, 151, 0.3)', text: 'var(--color-sage)' },
  honey: { bg: 'rgba(229, 185, 94, 0.3)', text: 'var(--color-honey)' },
  lavender: { bg: 'rgba(167, 139, 250, 0.3)', text: '#a78bfa' },
  mint: { bg: 'rgba(52, 211, 153, 0.3)', text: '#34d399' },
}

// Child colors with Norwegian labels (for settings/pickers)
export const CHILD_COLORS: { value: ChildColor; label: string; bg: string; text: string }[] = [
  { value: 'sky', label: 'Himmel', bg: 'rgba(126, 182, 196, 0.3)', text: 'var(--color-sky)' },
  { value: 'coral', label: 'Korall', bg: 'rgba(232, 120, 109, 0.3)', text: 'var(--color-coral)' },
  { value: 'sage', label: 'Salvie', bg: 'rgba(131, 166, 151, 0.3)', text: 'var(--color-sage)' },
  { value: 'honey', label: 'Honning', bg: 'rgba(229, 185, 94, 0.3)', text: 'var(--color-honey)' },
  { value: 'lavender', label: 'Lavendel', bg: 'rgba(167, 139, 250, 0.3)', text: '#a78bfa' },
  { value: 'mint', label: 'Mynte', bg: 'rgba(52, 211, 153, 0.3)', text: '#34d399' },
]

// Event type icons and colors
export const EVENT_TYPE_CONFIG: Record<MemberEventType, { icon: string; bg: string; text: string }> = {
  work: { icon: '💼', bg: 'rgba(126, 182, 196, 0.2)', text: 'var(--color-sky)' },
  travel: { icon: '✈️', bg: 'rgba(167, 139, 250, 0.2)', text: '#a78bfa' },
  family: { icon: '👨‍👩‍👧', bg: 'rgba(232, 120, 109, 0.2)', text: 'var(--color-coral)' },
  other: { icon: '📅', bg: 'rgba(131, 166, 151, 0.2)', text: 'var(--color-sage)' },
}

// Child task type icons and labels
export const TASK_TYPE_CONFIG: Record<ChildTaskType, { icon: string; label: string }> = {
  bring: { icon: '🎒', label: 'Ta med' },
  appointment: { icon: '🩺', label: 'Avtale' },
  activity: { icon: '⚽', label: 'Aktivitet' },
  closure: { icon: '🏫', label: 'Stengt' },
  reminder: { icon: '📝', label: 'Påminnelse' },
  other: { icon: '📌', label: 'Annet' },
}

// Helper functions
export const getChildColor = (color: ChildColor) => CHILD_COLOR_MAP[color] || CHILD_COLOR_MAP.sky
export const getEventConfig = (eventType: MemberEventType) => EVENT_TYPE_CONFIG[eventType] || EVENT_TYPE_CONFIG.other
export const getTaskConfig = (taskType: ChildTaskType) => TASK_TYPE_CONFIG[taskType] || TASK_TYPE_CONFIG.other
