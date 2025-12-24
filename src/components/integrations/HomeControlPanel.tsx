'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import { TransitionLink } from '@/components/TransitionLink'

interface HomeControlDevice {
  id: string
  account_id: string
  device_url: string
  label: string
  ui_class: string
  controllable_name: string | null
  available: boolean
  position: number | null
  commands: string[] | null
  custom_name: string | null
  favorite: boolean
  is_hidden: boolean
}

interface HomeControlGroup {
  id: string
  household_id: string
  name: string
  icon: string | null
  sort_order: number
  device_ids: string[]
}

interface HomeControlPanelProps {
  compact?: boolean
}

const UI_CLASS_ICONS: Record<string, React.ReactNode> = {
  ExteriorScreen: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
    </svg>
  ),
  Screen: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
    </svg>
  ),
  RollerShutter: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="2" width="16" height="20" rx="2"/>
      <line x1="4" y1="6" x2="20" y2="6"/>
      <line x1="4" y1="10" x2="20" y2="10"/>
      <line x1="4" y1="14" x2="20" y2="14"/>
    </svg>
  ),
  Awning: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h18v6H3z"/>
      <path d="M3 9l9 9"/>
      <path d="M21 9l-9 9"/>
    </svg>
  ),
  Pergola: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8h18"/>
      <path d="M5 8v12"/>
      <path d="M19 8v12"/>
      <path d="M3 4h18"/>
    </svg>
  ),
}

const getDeviceIcon = (uiClass: string) => {
  return UI_CLASS_ICONS[uiClass] || UI_CLASS_ICONS.Screen
}

export function HomeControlPanel({ compact = false }: HomeControlPanelProps) {
  const { t } = useLanguage()
  const [devices, setDevices] = useState<HomeControlDevice[]>([])
  const [groups, setGroups] = useState<HomeControlGroup[]>([])
  const [loading, setLoading] = useState(true)

  // Control state
  const [controllingDevice, setControllingDevice] = useState<string | null>(null)
  const [controllingGroup, setControllingGroup] = useState<string | null>(null)
  const [activeSlider, setActiveSlider] = useState<string | null>(null)
  const [sliderValue, setSliderValue] = useState(0)
  const [confirmedDevice, setConfirmedDevice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Refs
  const sliderTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const confirmTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const sliderValueRef = useRef(0) // Use ref to avoid stale closure

  const supabase = useMemo(() => createClient(), [])

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      if (sliderTimeoutRef.current) clearTimeout(sliderTimeoutRef.current)
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    }
  }, [])

  const showError = useCallback((message: string) => {
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
    setError(message)
    errorTimeoutRef.current = setTimeout(() => setError(null), 4000)
  }, [])

  const showConfirmation = useCallback((deviceUrl: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmedDevice(deviceUrl)
    confirmTimeoutRef.current = setTimeout(() => setConfirmedDevice(null), 2000)
  }, [])

  const loadData = useCallback(async () => {
    try {
      const { data: accountData } = await supabase.rpc('get_household_home_control_accounts')

      if (accountData && accountData.length > 0) {
        const accountIds = accountData.map((a: { id: string }) => a.id)
        const { data: deviceData } = await supabase
          .from('home_control_devices')
          .select('*')
          .in('account_id', accountIds)
          .eq('is_hidden', false)
          .order('favorite', { ascending: false })
          .order('label')
        setDevices(deviceData || [])
      }

      const { data: groupData } = await supabase
        .from('home_control_groups')
        .select(`id, household_id, name, icon, sort_order, home_control_group_devices (device_id)`)
        .order('sort_order')
        .order('name')

      if (groupData) {
        setGroups(groupData.map(g => ({
          ...g,
          device_ids: g.home_control_group_devices?.map((d: { device_id: string }) => d.device_id) || [],
        })))
      }
    } catch (err) {
      console.error('Failed to load home control data:', err)
      showError(t.homeControl.syncFailed)
    } finally {
      setLoading(false)
    }
  }, [supabase, showError, t.homeControl.syncFailed])

  useEffect(() => {
    loadData()
  }, [loadData])

  const controlDevice = async (
    accountId: string,
    deviceUrl: string,
    command: 'open' | 'close' | 'stop' | 'my'
  ) => {
    setControllingDevice(deviceUrl)
    try {
      const response = await fetch('/api/home-control/somfy/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, deviceUrl, command }),
      })
      const data = await response.json()

      if (data.success) {
        if (command === 'open' || command === 'close') {
          const newPosition = command === 'open' ? 0 : 100
          setDevices(prev =>
            prev.map(d => d.device_url === deviceUrl ? { ...d, position: newPosition } : d)
          )
        }
        showConfirmation(deviceUrl)
      } else {
        showError(data.error || t.homeControl.commandFailed)
      }
    } catch (err) {
      console.error('Control failed:', err)
      showError(t.homeControl.commandFailed)
    } finally {
      setControllingDevice(null)
    }
  }

  const setDevicePosition = async (accountId: string, deviceUrl: string, position: number) => {
    setControllingDevice(deviceUrl)
    try {
      const response = await fetch('/api/home-control/somfy/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, deviceUrl, command: 'setPosition', position }),
      })
      const data = await response.json()

      if (data.success) {
        setDevices(prev =>
          prev.map(d => d.device_url === deviceUrl ? { ...d, position } : d)
        )
        showConfirmation(deviceUrl)
      } else {
        showError(data.error || t.homeControl.commandFailed)
      }
    } catch (err) {
      console.error('Position control failed:', err)
      showError(t.homeControl.commandFailed)
    } finally {
      setControllingDevice(null)
      setActiveSlider(null)
    }
  }

  const controlGroup = async (groupId: string, command: 'open' | 'close' | 'stop') => {
    const group = groups.find(g => g.id === groupId)
    if (!group || group.device_ids.length === 0) return

    setControllingGroup(groupId)
    const groupDevices = devices.filter(d => group.device_ids.includes(d.id) && d.available)

    if (groupDevices.length === 0) {
      setControllingGroup(null)
      return
    }

    const devicesByAccount = groupDevices.reduce((acc, device) => {
      if (!acc[device.account_id]) acc[device.account_id] = []
      acc[device.account_id].push({ deviceUrl: device.device_url, command })
      return acc
    }, {} as Record<string, { deviceUrl: string; command: string }[]>)

    try {
      const results = await Promise.allSettled(
        Object.entries(devicesByAccount).map(async ([accountId, devs]) => {
          const response = await fetch('/api/home-control/somfy/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId, devices: devs }),
          })
          return response.json()
        })
      )

      const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))

      if (failures.length > 0) {
        showError(t.homeControl.partialFailure.replace('{failed}', String(failures.length)).replace('{total}', String(results.length)))
      }

      // Update positions for successful controls
      if (command === 'open' || command === 'close') {
        const newPosition = command === 'open' ? 0 : 100
        setDevices(prev =>
          prev.map(d =>
            group.device_ids.includes(d.id) ? { ...d, position: newPosition } : d
          )
        )
      }
    } catch (err) {
      console.error('Group control failed:', err)
      showError(t.homeControl.commandFailed)
    } finally {
      setControllingGroup(null)
    }
  }

  // Handle slider interaction - use ref to avoid stale closure
  const handleSliderChange = (deviceUrl: string, value: number) => {
    setActiveSlider(deviceUrl)
    setSliderValue(value)
    sliderValueRef.current = value

    if (sliderTimeoutRef.current) {
      clearTimeout(sliderTimeoutRef.current)
    }
  }

  const handleSliderEnd = (accountId: string, deviceUrl: string) => {
    if (activeSlider === deviceUrl) {
      setDevicePosition(accountId, deviceUrl, sliderValueRef.current)
    }
  }

  // Get visible devices (favorites first)
  const visibleDevices = useMemo(() => {
    const favorites = devices.filter(d => d.favorite)
    const nonFavorites = devices.filter(d => !d.favorite)
    return [...favorites, ...nonFavorites]
  }, [devices])

  const hasDevices = devices.length > 0 || groups.length > 0

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-24 rounded-2xl" style={{ background: 'var(--card)' }} />
        <div className="h-24 rounded-2xl" style={{ background: 'var(--card)' }} />
      </div>
    )
  }

  if (!hasDevices) {
    return (
      <div
        className="rounded-2xl p-6 text-center"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'rgba(213, 186, 124, 0.2)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </div>
        <h3 className="font-medium mb-1" style={{ color: 'var(--foreground)' }}>
          {t.homeControl.noDevices}
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
          {t.homeControl.noDevicesDesc}
        </p>
        <TransitionLink
          href="/innstillinger"
          className="btn btn-primary text-sm"
        >
          {t.homeControl.goToSettings}
        </TransitionLink>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Error Toast */}
      {error && (
        <div
          className="fixed z-50 px-4 py-3 rounded-xl shadow-lg animate-slide-up left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm"
          style={{
            top: 'max(1rem, env(safe-area-inset-top, 0px) + 0.5rem)',
            background: 'var(--color-coral)',
            color: 'white',
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Groups - Quick Controls */}
      {groups.length > 0 && (
        <div className="space-y-2">
          {groups.map(group => {
            const isControlling = controllingGroup === group.id
            return (
              <div
                key={group.id}
                className="rounded-2xl p-4"
                style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(213, 186, 124, 0.2)' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7"/>
                      <rect x="14" y="3" width="7" height="7"/>
                      <rect x="14" y="14" width="7" height="7"/>
                      <rect x="3" y="14" width="7" height="7"/>
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      {group.name}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {t.homeControl.deviceCount.replace('{count}', String(group.device_ids.length))}
                    </p>
                  </div>
                </div>

                {/* Group Control Buttons */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => controlGroup(group.id, 'open')}
                    disabled={isControlling}
                    className="control-btn control-btn-open"
                    aria-label={`${t.homeControl.allUp} ${group.name}`}
                  >
                    {isControlling ? (
                      <span className="loading-spinner" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="18 15 12 9 6 15"/>
                      </svg>
                    )}
                    <span>{t.homeControl.allUp}</span>
                  </button>
                  <button
                    onClick={() => controlGroup(group.id, 'stop')}
                    disabled={isControlling}
                    className="control-btn control-btn-stop"
                    aria-label={`${t.homeControl.stop} ${group.name}`}
                  >
                    {isControlling ? (
                      <span className="loading-spinner" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="6" y="6" width="12" height="12"/>
                      </svg>
                    )}
                    <span>{t.homeControl.stop}</span>
                  </button>
                  <button
                    onClick={() => controlGroup(group.id, 'close')}
                    disabled={isControlling}
                    className="control-btn control-btn-close"
                    aria-label={`${t.homeControl.allDown} ${group.name}`}
                  >
                    {isControlling ? (
                      <span className="loading-spinner" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    )}
                    <span>{t.homeControl.allDown}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Individual Devices */}
      <div className={compact ? 'space-y-2' : 'grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}>
        {visibleDevices.map(device => {
          const isControlling = controllingDevice === device.device_url
          const isConfirmed = confirmedDevice === device.device_url
          const isSliding = activeSlider === device.device_url
          const currentPosition = isSliding ? sliderValue : (device.position ?? 0)

          return (
            <div
              key={device.id}
              className="rounded-2xl p-4 transition-all relative"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                boxShadow: isConfirmed ? '0 0 0 2px var(--color-sage)' : 'none',
              }}
            >
              {/* Loading overlay */}
              {isControlling && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl z-10" style={{ background: 'rgba(var(--card-rgb, 255, 255, 255), 0.7)' }}>
                  <span className="loading-spinner" style={{ width: 24, height: 24, borderWidth: 3, color: 'var(--color-sky)' }} />
                </div>
              )}
              {/* Device Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(126, 182, 196, 0.2)', color: 'var(--color-sky)' }}
                  >
                    {getDeviceIcon(device.ui_class)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--foreground)' }}>
                      {device.custom_name || device.label}
                    </p>
                    <p className="text-xs" style={{ color: isConfirmed ? 'var(--color-sage)' : 'var(--muted)' }}>
                      {isConfirmed && '✓ '}
                      {currentPosition === 0 ? t.homeControl.open : currentPosition === 100 ? t.homeControl.closed : `${currentPosition}%`}
                    </p>
                  </div>
                </div>
                {device.favorite && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--color-honey)" stroke="var(--color-honey)" strokeWidth="2" aria-label={t.homeControl.favoritePosition}>
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                )}
              </div>

              {device.available ? (
                <>
                  {/* Quick Action Buttons - 2x2 on mobile, 4 cols on larger */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    <button
                      onClick={() => controlDevice(device.account_id, device.device_url, 'open')}
                      disabled={isControlling}
                      className="control-btn control-btn-open"
                      aria-label={`${t.homeControl.openAction} ${device.custom_name || device.label}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="18 15 12 9 6 15"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => controlDevice(device.account_id, device.device_url, 'stop')}
                      disabled={isControlling}
                      className="control-btn control-btn-stop"
                      aria-label={`${t.homeControl.stop} ${device.custom_name || device.label}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="6" y="6" width="12" height="12"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => controlDevice(device.account_id, device.device_url, 'close')}
                      disabled={isControlling}
                      className="control-btn control-btn-close"
                      aria-label={`${t.homeControl.closeAction} ${device.custom_name || device.label}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => controlDevice(device.account_id, device.device_url, 'my')}
                      disabled={isControlling}
                      className="control-btn control-btn-fav"
                      aria-label={`${t.homeControl.favoritePosition} ${device.custom_name || device.label}`}
                      title={t.homeControl.favoritePosition}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                    </button>
                  </div>

                  {/* Position Slider with improved touch area */}
                  <div className="slider-container">
                    <div className="slider-track">
                      <div
                        className="slider-fill"
                        style={{ width: `${currentPosition}%` }}
                      />
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={currentPosition}
                      onChange={e => handleSliderChange(device.device_url, Number(e.target.value))}
                      onMouseUp={() => handleSliderEnd(device.account_id, device.device_url)}
                      onTouchEnd={() => handleSliderEnd(device.account_id, device.device_url)}
                      disabled={isControlling}
                      className="slider-input"
                      aria-label={`${t.homeControl.position} ${device.custom_name || device.label}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={currentPosition}
                      aria-valuetext={currentPosition === 0 ? t.homeControl.open : currentPosition === 100 ? t.homeControl.closed : `${currentPosition}%`}
                    />
                  </div>

                  {/* Position labels - semantic */}
                  <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    <span>{t.homeControl.open}</span>
                    <span>{t.homeControl.closed}</span>
                  </div>
                </>
              ) : (
                <p className="text-sm py-2" style={{ color: 'var(--color-coral)' }}>
                  {t.homeControl.unavailable}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Settings link */}
      {!compact && (
        <div className="text-center pt-2">
          <TransitionLink
            href="/innstillinger"
            className="text-sm inline-flex items-center gap-1"
            style={{ color: 'var(--muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            {t.settings.title}
          </TransitionLink>
        </div>
      )}
    </div>
  )
}
