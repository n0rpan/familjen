'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import { TransitionLink } from '@/components/TransitionLink'
import { getAccountDisplayName } from '@/lib/integrations/somfy/utils'
import {
  TEMPERATURE,
  FAN_SPEEDS,
  OPERATION_MODES,
  type ToshibaOperationMode,
  type ToshibaFanSpeed,
  type ToshibaPowerState,
} from '@/lib/integrations/toshiba'

interface ToshibaACDevice {
  id: string
  account_id: string
  ac_id: string
  name: string
  model: string | null
  power_state: ToshibaPowerState | null
  operation_mode: ToshibaOperationMode | null
  target_temperature: number | null
  current_temperature: number | null
  outdoor_temperature: number | null
  fan_speed: ToshibaFanSpeed | null
  swing_mode: string | null
  pure_state: string | null
  custom_name: string | null
  favorite: boolean
  is_hidden: boolean
}

interface ToshibaAccount {
  id: string
  display_name: string
  account_email: string | null
}

interface ToshibaACPanelProps {
  compact?: boolean
}

const MODE_ICONS: Record<ToshibaOperationMode, React.ReactNode> = {
  AUTO: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  ),
  COOL: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07"/>
    </svg>
  ),
  HEAT: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  ),
  DRY: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
    </svg>
  ),
  FAN: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 12c-1.5-2.5-1-5 1-7s4.5-2.5 6 0-1 6-3 7"/>
      <path d="M12 12c2.5-1.5 5-1 7 1s2.5 4.5 0 6-6-1-7-3"/>
      <path d="M12 12c1.5 2.5 1 5-1 7s-4.5 2.5-6 0 1-6 3-7"/>
      <path d="M12 12c-2.5 1.5-5 1-7-1s-2.5-4.5 0-6 6 1 7 3"/>
      <circle cx="12" cy="12" r="1"/>
    </svg>
  ),
}

const MODE_COLORS: Record<ToshibaOperationMode, string> = {
  AUTO: 'var(--color-sage)',
  COOL: 'var(--color-sky)',
  HEAT: 'var(--color-coral)',
  DRY: 'var(--color-honey)',
  FAN: 'var(--color-lavender)',
}

export function ToshibaACPanel({ compact = false }: ToshibaACPanelProps) {
  const { t } = useLanguage()
  const [devices, setDevices] = useState<ToshibaACDevice[]>([])
  const [accounts, setAccounts] = useState<ToshibaAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [controllingDevice, setControllingDevice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmedDevice, setConfirmedDevice] = useState<string | null>(null)
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(new Set())

  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const confirmTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    }
  }, [])

  const showError = useCallback((message: string) => {
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
    setError(message)
    errorTimeoutRef.current = setTimeout(() => setError(null), 4000)
  }, [])

  const showConfirmation = useCallback((deviceId: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmedDevice(deviceId)
    confirmTimeoutRef.current = setTimeout(() => setConfirmedDevice(null), 2000)
  }, [])

  const loadData = useCallback(async () => {
    try {
      // Get Toshiba accounts
      const { data: accountData } = await supabase
        .from('home_control_accounts')
        .select('id, display_name, account_email')
        .eq('service', 'toshiba')

      if (accountData && accountData.length > 0) {
        setAccounts(accountData)

        // Get IDs of devices that are already in groups (to filter them out)
        const { data: groupedDevices } = await supabase
          .from('home_control_group_toshiba_devices')
          .select('toshiba_device_id')

        const groupedDeviceIds = new Set(groupedDevices?.map(d => d.toshiba_device_id) || [])

        // Get Toshiba AC devices (excluding ones already in groups)
        const { data: deviceData } = await supabase
          .from('toshiba_ac_devices')
          .select('*')
          .in('account_id', accountData.map(a => a.id))
          .eq('is_hidden', false)
          .order('favorite', { ascending: false })
          .order('name')

        // Filter out devices that are in groups
        const ungroupedDevices = (deviceData || []).filter(d => !groupedDeviceIds.has(d.id))
        setDevices(ungroupedDevices)
      }
    } catch (err) {
      console.error('Failed to load Toshiba AC data:', err)
      showError(t.homeControl?.syncFailed || 'Failed to load devices')
    } finally {
      setLoading(false)
    }
  }, [supabase, showError, t.homeControl?.syncFailed])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Haptic feedback for touch devices
  const triggerHaptic = useCallback(() => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(10)
    }
  }, [])

  const controlDevice = async (
    accountId: string,
    acId: string,
    deviceId: string,
    command: string,
    value?: string | number
  ) => {
    triggerHaptic()
    setControllingDevice(deviceId)
    try {
      const response = await fetch('/api/home-control/toshiba/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, acId, command, value }),
      })
      const data = await response.json()

      if (data.success) {
        // Update local state
        setDevices(prev =>
          prev.map(d => {
            if (d.id !== deviceId) return d
            switch (command) {
              case 'power':
                return { ...d, power_state: value as ToshibaPowerState }
              case 'temperature':
                return { ...d, target_temperature: value as number }
              case 'mode':
                return { ...d, operation_mode: value as ToshibaOperationMode }
              case 'fanSpeed':
                return { ...d, fan_speed: value as ToshibaFanSpeed }
              case 'turnOn':
                return { ...d, power_state: 'ON' }
              case 'turnOff':
                return { ...d, power_state: 'OFF' }
              default:
                return d
            }
          })
        )
        showConfirmation(deviceId)
      } else {
        showError(data.error || t.homeControl?.commandFailed || 'Command failed')
      }
    } catch (err) {
      console.error('Toshiba control failed:', err)
      showError(t.homeControl?.commandFailed || 'Command failed')
    } finally {
      setControllingDevice(null)
    }
  }

  const getAccountName = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId)
    return getAccountDisplayName(account)
  }

  const toggleAccountCollapse = (accountId: string) => {
    setCollapsedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(accountId)) {
        next.delete(accountId)
      } else {
        next.add(accountId)
      }
      return next
    })
  }

  const devicesByAccount = useMemo(() => {
    const grouped: Record<string, ToshibaACDevice[]> = {}
    devices.forEach(device => {
      if (!grouped[device.account_id]) {
        grouped[device.account_id] = []
      }
      grouped[device.account_id].push(device)
    })
    return grouped
  }, [devices])

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        {/* Skeleton for account section */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          {/* Account header skeleton */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl" style={{ background: 'rgba(232, 120, 109, 0.2)' }} />
            <div className="flex-1">
              <div className="h-4 w-32 rounded mb-1" style={{ background: 'var(--border)' }} />
              <div className="h-3 w-16 rounded" style={{ background: 'var(--border)' }} />
            </div>
          </div>
          {/* Device card skeleton */}
          <div className="rounded-xl p-4" style={{ background: 'var(--background)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg" style={{ background: 'var(--border)' }} />
                <div>
                  <div className="h-4 w-24 rounded mb-1" style={{ background: 'var(--border)' }} />
                  <div className="h-3 w-16 rounded" style={{ background: 'var(--border)' }} />
                </div>
              </div>
              <div className="w-12 h-7 rounded-full" style={{ background: 'var(--border)' }} />
            </div>
            {/* Temperature slider skeleton */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="h-3 w-16 rounded" style={{ background: 'var(--border)' }} />
                <div className="h-5 w-12 rounded" style={{ background: 'var(--border)' }} />
              </div>
              <div className="flex items-center gap-2">
                <div className="w-11 h-11 rounded-lg" style={{ background: 'var(--border)' }} />
                <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--border)' }} />
                <div className="w-11 h-11 rounded-lg" style={{ background: 'var(--border)' }} />
              </div>
            </div>
            {/* Mode buttons skeleton */}
            <div className="grid grid-cols-5 gap-1 mb-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 rounded-lg" style={{ background: 'var(--border)' }} />
              ))}
            </div>
            {/* Fan speed skeleton */}
            <div className="flex flex-wrap gap-1">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="h-11 flex-1 min-w-[calc(25%-3px)] rounded" style={{ background: 'var(--border)' }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (devices.length === 0) {
    return (
      <div
        className="rounded-2xl p-6 text-center"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'rgba(232, 120, 109, 0.2)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/>
            <path d="M12 6v6l4 2"/>
            <path d="M8 14h8"/>
            <path d="M8 18h8"/>
          </svg>
        </div>
        <h3 className="font-medium mb-1" style={{ color: 'var(--foreground)' }}>
          {t.homeControl.noACUnits}
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
          {t.homeControl.noACUnitsDesc}
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
          className="fixed z-50 px-4 py-3 rounded-xl shadow-lg animate-slide-up left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm flex items-center justify-between gap-3"
          style={{
            top: 'max(1rem, env(safe-area-inset-top, 0px) + 0.5rem)',
            background: 'var(--color-coral)',
            color: 'white',
          }}
          role="alert"
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="shrink-0 p-1 rounded hover:bg-white/20 transition-colors"
            aria-label={t.common.close}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {/* AC Units grouped by Account */}
      {Object.entries(devicesByAccount).map(([accountId, accountDevices]) => {
        const accountName = getAccountName(accountId)
        const isCollapsed = collapsedAccounts.has(accountId)

        return (
          <div
            key={accountId}
            className="rounded-2xl p-4"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            {/* Account Header */}
            <button
              type="button"
              onClick={() => toggleAccountCollapse(accountId)}
              className="flex items-center gap-3 mb-3 w-full text-left"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(232, 120, 109, 0.2)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {accountName}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {accountDevices.length} {accountDevices.length === 1 ? t.homeControl.acUnit : t.homeControl.acUnits}
                </p>
              </div>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--muted)"
                strokeWidth="2"
                className={`shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {/* AC Units */}
            {!isCollapsed && (
              <div className={compact ? 'space-y-3' : 'grid gap-3 grid-cols-1 md:grid-cols-2'}>
                {accountDevices.map(device => {
                  const isControlling = controllingDevice === device.id
                  const isConfirmed = confirmedDevice === device.id
                  const isOffline = device.power_state === null
                  const isPoweredOn = device.power_state === 'ON'
                  const currentMode = device.operation_mode ?? 'AUTO'
                  const modeColor = MODE_COLORS[currentMode]

                  return (
                    <div
                      key={device.id}
                      className="rounded-xl p-4 transition-all relative"
                      style={{
                        background: isOffline
                          ? 'var(--background)'
                          : isPoweredOn
                            ? `color-mix(in srgb, ${modeColor} 10%, var(--background))`
                            : 'var(--background)',
                        border: isConfirmed
                          ? '2px solid var(--color-sage)'
                          : '1px solid var(--border)',
                        opacity: isOffline ? 0.7 : 1,
                      }}
                    >
                      {/* Loading overlay */}
                      {isControlling && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-xl z-10" style={{ background: 'rgba(var(--card-rgb, 255, 255, 255), 0.7)' }}>
                          <span className="loading-spinner" style={{ width: 24, height: 24, borderWidth: 3, color: 'var(--color-coral)' }} />
                        </div>
                      )}

                      {/* Device Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                              background: isOffline
                                ? 'rgba(var(--muted-rgb), 0.1)'
                                : isPoweredOn
                                  ? `color-mix(in srgb, ${modeColor} 20%, transparent)`
                                  : 'rgba(var(--muted-rgb), 0.1)',
                              color: isOffline ? 'var(--muted)' : isPoweredOn ? modeColor : 'var(--muted)',
                            }}
                          >
                            {MODE_ICONS[currentMode]}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate" style={{ color: 'var(--foreground)' }}>
                              {device.custom_name || device.name}
                            </p>
                            <p className="text-xs" style={{ color: isOffline ? 'var(--color-coral)' : isPoweredOn ? modeColor : 'var(--muted)' }}>
                              {isOffline
                                ? t.homeControl.offline
                                : isPoweredOn
                                  ? t.homeControl.acModes[currentMode]
                                  : t.homeControl.powerOff}
                            </p>
                          </div>
                        </div>

                        {/* Current/Outdoor Temps + Power Toggle */}
                        <div className="flex items-center gap-3 shrink-0">
                          {!isOffline && isPoweredOn && (device.current_temperature || device.outdoor_temperature) && (
                            <div className="text-right">
                              {device.current_temperature && (
                                <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                                  {device.current_temperature}°C
                                  <span className="text-xs font-normal ml-1" style={{ color: 'var(--muted)' }}>
                                    {t.homeControl.currentTemp}
                                  </span>
                                </p>
                              )}
                              {device.outdoor_temperature && (
                                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                                  {t.homeControl.outdoorTemp}: {device.outdoor_temperature}°C
                                </p>
                              )}
                            </div>
                          )}
                          {/* Power Toggle - disabled when offline */}
                          {!isOffline && (
                            <button
                              onClick={() => controlDevice(device.account_id, device.ac_id, device.id, isPoweredOn ? 'turnOff' : 'turnOn')}
                              disabled={isControlling}
                              className="w-12 h-7 rounded-full transition-all relative"
                              style={{
                                background: isPoweredOn ? modeColor : 'var(--border)',
                              }}
                              aria-label={isPoweredOn ? t.homeControl.powerOff : t.homeControl.powerOn}
                            >
                              <div
                                className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform"
                                style={{
                                  left: isPoweredOn ? 'calc(100% - 1.625rem)' : '0.125rem',
                                }}
                              />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Controls (only when powered on and state is known) */}
                      {isPoweredOn && !isOffline && (
                        <>
                          {/* Temperature Control */}
                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                                {t.homeControl.temperature}
                              </span>
                              <span className="text-lg font-semibold" style={{ color: modeColor }}>
                                {device.target_temperature ?? '--'}°C
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => controlDevice(device.account_id, device.ac_id, device.id, 'temperature', Math.max(TEMPERATURE.MIN, (device.target_temperature ?? 22) - 1))}
                                disabled={isControlling || device.target_temperature === null || device.target_temperature <= TEMPERATURE.MIN}
                                className="w-11 h-11 rounded-lg flex items-center justify-center disabled:opacity-40"
                                style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                                aria-label={t.homeControl.decreaseTemp}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                              </button>
                              <div className="flex-1 h-2 rounded-full relative" style={{ background: 'var(--border)' }}>
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full transition-all"
                                  style={{
                                    width: device.target_temperature !== null
                                      ? `${((device.target_temperature - TEMPERATURE.MIN) / (TEMPERATURE.MAX - TEMPERATURE.MIN)) * 100}%`
                                      : '0%',
                                    background: modeColor,
                                  }}
                                />
                              </div>
                              <button
                                onClick={() => controlDevice(device.account_id, device.ac_id, device.id, 'temperature', Math.min(TEMPERATURE.MAX, (device.target_temperature ?? 22) + 1))}
                                disabled={isControlling || device.target_temperature === null || device.target_temperature >= TEMPERATURE.MAX}
                                className="w-11 h-11 rounded-lg flex items-center justify-center disabled:opacity-40"
                                style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                                aria-label={t.homeControl.increaseTemp}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <line x1="12" y1="5" x2="12" y2="19"/>
                                  <line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* Mode Selection */}
                          <div className="mb-3">
                            <span className="text-xs block mb-2" style={{ color: 'var(--muted)' }}>
                              {t.homeControl.mode}
                            </span>
                            <div className="grid grid-cols-5 gap-1">
                              {OPERATION_MODES.map(mode => (
                                <button
                                  key={mode}
                                  onClick={() => controlDevice(device.account_id, device.ac_id, device.id, 'mode', mode)}
                                  disabled={isControlling}
                                  className="p-2 rounded-lg flex flex-col items-center gap-1 transition-all"
                                  style={{
                                    background: device.operation_mode === mode
                                      ? `color-mix(in srgb, ${MODE_COLORS[mode]} 20%, transparent)`
                                      : 'transparent',
                                    border: device.operation_mode === mode
                                      ? `1px solid ${MODE_COLORS[mode]}`
                                      : '1px solid transparent',
                                    color: device.operation_mode === mode ? MODE_COLORS[mode] : 'var(--muted)',
                                  }}
                                  aria-label={t.homeControl.acModes[mode]}
                                  title={t.homeControl.acModes[mode]}
                                >
                                  {MODE_ICONS[mode]}
                                  <span className="text-[10px]">{t.homeControl.acModes[mode]}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Fan Speed */}
                          <div>
                            <span className="text-xs block mb-2" style={{ color: 'var(--muted)' }}>
                              {t.homeControl.fanSpeed}
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {FAN_SPEEDS.map(speed => (
                                <button
                                  key={speed}
                                  onClick={() => controlDevice(device.account_id, device.ac_id, device.id, 'fanSpeed', speed)}
                                  disabled={isControlling}
                                  className="px-2.5 py-2 rounded text-[11px] transition-all text-center min-h-[44px] flex-1 min-w-[calc(25%-3px)]"
                                  style={{
                                    background: device.fan_speed === speed
                                      ? `color-mix(in srgb, ${modeColor} 20%, transparent)`
                                      : 'var(--background)',
                                    border: device.fan_speed === speed
                                      ? `1px solid ${modeColor}`
                                      : '1px solid var(--border)',
                                    color: device.fan_speed === speed ? modeColor : 'var(--muted)',
                                  }}
                                  aria-label={t.homeControl.fanSpeeds[speed]}
                                >
                                  {t.homeControl.fanSpeeds[speed]}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

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
            {t.settings?.title || 'Settings'}
          </TransitionLink>
        </div>
      )}
    </div>
  )
}
