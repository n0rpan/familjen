'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import { TransitionLink } from '@/components/TransitionLink'
import { SOMFY_UI } from '@/lib/integrations/somfy/constants'

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

export default function StyringPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const [devices, setDevices] = useState<HomeControlDevice[]>([])
  const [groups, setGroups] = useState<HomeControlGroup[]>([])
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [controllingDevice, setControllingDevice] = useState<string | null>(null)
  const [controllingGroup, setControllingGroup] = useState<string | null>(null)
  const [sliderDevice, setSliderDevice] = useState<string | null>(null)
  const [sliderPosition, setSliderPosition] = useState(50)
  const [confirmedDevice, setConfirmedDevice] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Refs for timeout cleanup and stable function references
  const messageTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const confirmedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const sliderDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const setDevicePositionRef = useRef<((accountId: string, deviceUrl: string, position: number) => Promise<void>) | null>(null)

  const supabase = useMemo(() => createClient(), [])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current)
      if (confirmedTimeoutRef.current) clearTimeout(confirmedTimeoutRef.current)
      if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current)
    }
  }, [])

  const showMessage = (type: 'success' | 'error', text: string) => {
    if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current)
    setMessage({ type, text })
    messageTimeoutRef.current = setTimeout(() => setMessage(null), SOMFY_UI.MESSAGE_DURATION_MS)
  }

  const loadData = useCallback(async () => {
    try {
      // Get accounts first
      const { data: accounts, error: accountsError } = await supabase
        .rpc('get_household_home_control_accounts')

      if (accountsError) throw accountsError

      if (!accounts || accounts.length === 0) {
        // No home control accounts, redirect to settings
        router.push('/innstillinger')
        return
      }

      const ids = accounts.map((a: { id: string }) => a.id)
      setAccountIds(ids)

      // Load devices
      const { data: deviceData } = await supabase
        .from('home_control_devices')
        .select('*')
        .in('account_id', ids)
        .eq('is_hidden', false)
        .order('favorite', { ascending: false })
        .order('label')

      setDevices(deviceData || [])

      // Load groups
      const { data: groupData } = await supabase
        .from('home_control_groups')
        .select(`
          id,
          household_id,
          name,
          icon,
          sort_order,
          home_control_group_devices (device_id)
        `)
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
    } finally {
      setLoading(false)
    }
  }, [supabase, router])

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

      if (!data.success) {
        showMessage('error', data.error || t.homeControl.commandFailed)
      }
    } catch (err) {
      console.error('Control failed:', err)
      showMessage('error', t.homeControl.commandFailed)
    } finally {
      setControllingDevice(null)
    }
  }

  const setDevicePosition = async (
    accountId: string,
    deviceUrl: string,
    position: number
  ) => {
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
          prev.map(d =>
            d.device_url === deviceUrl ? { ...d, position } : d
          )
        )
        setSliderDevice(null)
        if (confirmedTimeoutRef.current) clearTimeout(confirmedTimeoutRef.current)
        setConfirmedDevice(deviceUrl)
        confirmedTimeoutRef.current = setTimeout(() => setConfirmedDevice(null), SOMFY_UI.CONFIRMATION_DURATION_MS)
      } else {
        showMessage('error', data.error || t.homeControl.commandFailed)
      }
    } catch (err) {
      console.error('Position control failed:', err)
      showMessage('error', t.homeControl.commandFailed)
    } finally {
      setControllingDevice(null)
    }
  }

  // Keep ref updated with latest setDevicePosition
  setDevicePositionRef.current = setDevicePosition

  // Debounced slider submit - prevents rapid API calls when user adjusts quickly
  // Uses ref to avoid stale closure issues with setDevicePosition
  const handleSliderSubmit = useCallback((
    accountId: string,
    deviceUrl: string,
    position: number
  ) => {
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current)
    sliderDebounceRef.current = setTimeout(() => {
      setDevicePositionRef.current?.(accountId, deviceUrl, position)
    }, SOMFY_UI.SLIDER_DEBOUNCE_MS)
  }, [])

  const controlGroup = async (
    groupId: string,
    command: 'open' | 'close' | 'stop'
  ) => {
    const group = groups.find(g => g.id === groupId)
    if (!group || group.device_ids.length === 0) return

    setControllingGroup(groupId)

    // Only control available devices
    const groupDevices = devices.filter(d => group.device_ids.includes(d.id) && d.available)
    if (groupDevices.length === 0) {
      setControllingGroup(null)
      return
    }

    const devicesByAccount = groupDevices.reduce((acc, device) => {
      if (!acc[device.account_id]) {
        acc[device.account_id] = []
      }
      acc[device.account_id].push({
        deviceUrl: device.device_url,
        command,
      })
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

          const data = await response.json()
          if (!data.success) {
            throw new Error(data.error || t.homeControl.commandFailed)
          }
          return devs.length // Return device count for success tracking
        })
      )

      // Check for partial failures
      const failures = results.filter(r => r.status === 'rejected')
      const successes = results.filter(r => r.status === 'fulfilled')

      if (failures.length > 0 && successes.length > 0) {
        // Partial success
        showMessage('error', t.homeControl.partialFailure.replace('{failed}', String(failures.length)).replace('{total}', String(results.length)))
      } else if (failures.length > 0) {
        // All failed
        showMessage('error', t.homeControl.commandFailed)
      }
      // If all succeeded, no message needed
    } catch (err) {
      console.error('Group control failed:', err)
      showMessage('error', t.homeControl.commandFailed)
    } finally {
      setControllingGroup(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="h-8 w-32 rounded-lg animate-pulse" style={{ background: 'var(--background)' }} />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--background)' }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold font-display" style={{ color: 'var(--foreground)' }}>
          {t.nav.homeControl}
        </h1>
        <TransitionLink
          href="/innstillinger"
          className="text-sm"
          style={{ color: 'var(--muted)' }}
        >
          {t.nav.settings}
        </TransitionLink>
      </div>

      {/* Toast message */}
      {message && (
        <div
          className="fixed z-50 px-5 py-3 rounded-xl shadow-lg animate-slide-up left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm"
          style={{
            top: 'max(1rem, env(safe-area-inset-top, 0px) + 0.5rem)',
            background: message.type === 'success' ? 'var(--color-sage)' : 'var(--color-coral)',
            color: 'white',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Groups */}
      {groups.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
            {t.homeControl.groups}
          </h2>
          {groups.map(group => (
            <div
              key={group.id}
              className="rounded-xl p-4"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(213, 186, 124, 0.2)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"/>
                    <rect x="14" y="3" width="7" height="7"/>
                    <rect x="14" y="14" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/>
                  </svg>
                </div>
                <div>
                  <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {group.name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {t.homeControl.deviceCount.replace('{count}', String(group.device_ids.length))}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => controlGroup(group.id, 'open')}
                  disabled={controllingGroup === group.id}
                  className="flex-1 btn btn-secondary text-sm py-2"
                >
                  {controllingGroup === group.id ? '...' : t.homeControl.allUp}
                </button>
                <button
                  onClick={() => controlGroup(group.id, 'stop')}
                  disabled={controllingGroup === group.id}
                  className="flex-1 btn btn-secondary text-sm py-2"
                >
                  {controllingGroup === group.id ? '...' : t.homeControl.stop}
                </button>
                <button
                  onClick={() => controlGroup(group.id, 'close')}
                  disabled={controllingGroup === group.id}
                  className="flex-1 btn btn-secondary text-sm py-2"
                >
                  {controllingGroup === group.id ? '...' : t.homeControl.allDown}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Devices */}
      {devices.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
            {t.homeControl.devices}
          </h2>
          {devices.map(device => (
            <div
              key={device.id}
              className="rounded-xl p-4 transition-all"
              style={{
                background: 'var(--card)',
                border: confirmedDevice === device.device_url
                  ? '2px solid var(--color-sage)'
                  : '1px solid var(--border)',
              }}
            >
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    {device.custom_name || device.label}
                  </p>
                  <p className="text-sm" style={{ color: confirmedDevice === device.device_url ? 'var(--color-sage)' : 'var(--muted)' }}>
                    {confirmedDevice === device.device_url ? '✓ ' : ''}{device.position ?? 0} %
                  </p>
                </div>
                {device.available && (
                  <button
                    onClick={() => controlDevice(device.account_id, device.device_url, 'my')}
                    disabled={controllingDevice === device.device_url}
                    className="p-1"
                    title={t.homeControl.favoritePosition}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill={device.favorite ? 'var(--color-honey)' : 'none'}
                      stroke="var(--color-honey)"
                      strokeWidth="2"
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  </button>
                )}
              </div>

              {device.available ? (
                <div className="space-y-3">
                  <div className="pt-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={sliderDevice === device.device_url ? sliderPosition : (device.position ?? 0)}
                      onChange={e => {
                        setSliderDevice(device.device_url)
                        setSliderPosition(Number(e.target.value))
                      }}
                      onMouseUp={() => {
                        if (sliderDevice === device.device_url) {
                          handleSliderSubmit(device.account_id, device.device_url, sliderPosition)
                        }
                      }}
                      onTouchEnd={() => {
                        if (sliderDevice === device.device_url) {
                          handleSliderSubmit(device.account_id, device.device_url, sliderPosition)
                        }
                      }}
                      disabled={controllingDevice === device.device_url}
                      aria-label={`${t.homeControl.position} ${device.custom_name || device.label}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={sliderDevice === device.device_url ? sliderPosition : (device.position ?? 0)}
                      aria-valuetext={`${sliderDevice === device.device_url ? sliderPosition : (device.position ?? 0)}%`}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, var(--color-sky) 0%, var(--color-sky) ${sliderDevice === device.device_url ? sliderPosition : (device.position ?? 0)}%, var(--border) ${sliderDevice === device.device_url ? sliderPosition : (device.position ?? 0)}%, var(--border) 100%)`,
                      }}
                    />
                  </div>
                  <button
                    onClick={() => controlDevice(device.account_id, device.device_url, 'stop')}
                    disabled={controllingDevice === device.device_url}
                    className="w-full btn btn-secondary text-sm py-2"
                  >
                    {controllingDevice === device.device_url ? '...' : t.homeControl.stop}
                  </button>
                </div>
              ) : (
                <p className="text-sm mt-2" style={{ color: 'var(--color-coral)' }}>
                  {t.homeControl.unavailable}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {devices.length === 0 && groups.length === 0 && (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(126, 182, 196, 0.2)' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </div>
          <p className="font-medium mb-2" style={{ color: 'var(--foreground)' }}>
            {t.homeControl.noDevices}
          </p>
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            {t.homeControl.noDevicesDesc}
          </p>
          <TransitionLink href="/innstillinger" className="btn btn-primary">
            {t.homeControl.goToSettings}
          </TransitionLink>
        </div>
      )}
    </div>
  )
}
