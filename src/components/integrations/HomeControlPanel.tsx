'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import { TransitionLink } from '@/components/TransitionLink'
import { getAccountDisplayName } from '@/lib/integrations/somfy/utils'
import {
  TEMPERATURE,
} from '@/lib/integrations/toshiba/constants'
import {
  type ToshibaOperationMode,
  type ToshibaPowerState,
} from '@/lib/integrations/toshiba/types'
import {
  TEMPERATURE as MELCLOUD_TEMPERATURE,
} from '@/lib/integrations/melcloud/constants'
import {
  type MelCloudOperationMode,
  type MelCloudPowerState,
} from '@/lib/integrations/melcloud/types'

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
  toshiba_device_ids: string[]
  melcloud_device_ids: string[]
}

interface ToshibaDeviceInGroup {
  id: string
  account_id: string
  ac_id: string
  name: string
  custom_name: string | null
  power_state: ToshibaPowerState | null
  operation_mode: ToshibaOperationMode | null
  target_temperature: number | null
  current_temperature: number | null
  outdoor_temperature: number | null
}

interface MelCloudDeviceInGroup {
  id: string
  account_id: string
  device_id: number
  building_id: number
  name: string
  custom_name: string | null
  power_state: MelCloudPowerState | null
  operation_mode: MelCloudOperationMode | null
  target_temperature: number | null
  current_temperature: number | null
  outdoor_temperature: number | null
}

interface HomeControlAccount {
  id: string
  display_name: string
  account_email: string | null
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
  const [accounts, setAccounts] = useState<HomeControlAccount[]>([])
  const [toshibaDevicesInGroups, setToshibaDevicesInGroups] = useState<ToshibaDeviceInGroup[]>([])
  const [melcloudDevicesInGroups, setMelcloudDevicesInGroups] = useState<MelCloudDeviceInGroup[]>([])
  const [loading, setLoading] = useState(true)

  // Control state
  const [controllingDevice, setControllingDevice] = useState<string | null>(null)
  const [controllingGroup, setControllingGroup] = useState<string | null>(null)
  const [controllingAccount, setControllingAccount] = useState<string | null>(null)
  const [controllingToshibaDevice, setControllingToshibaDevice] = useState<string | null>(null)
  const [confirmedToshibaDevice, setConfirmedToshibaDevice] = useState<string | null>(null)
  const [controllingMelCloudDevice, setControllingMelCloudDevice] = useState<string | null>(null)
  const [confirmedMelCloudDevice, setConfirmedMelCloudDevice] = useState<string | null>(null)
  const [activeSlider, setActiveSlider] = useState<string | null>(null)
  const [sliderValue, setSliderValue] = useState(0)
  const [confirmedDevice, setConfirmedDevice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Collapsed state for account sections (expanded by default)
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(new Set())

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

  const showToshibaConfirmation = useCallback((deviceId: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmedToshibaDevice(deviceId)
    confirmTimeoutRef.current = setTimeout(() => setConfirmedToshibaDevice(null), 2000)
  }, [])

  const showMelCloudConfirmation = useCallback((deviceId: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmedMelCloudDevice(deviceId)
    confirmTimeoutRef.current = setTimeout(() => setConfirmedMelCloudDevice(null), 2000)
  }, [])

  const loadData = useCallback(async () => {
    try {
      const { data: accountData } = await supabase.rpc('get_household_home_control_accounts')

      if (accountData && accountData.length > 0) {
        // Store accounts for grouping display
        setAccounts(accountData.map((a: { id: string; display_name: string; account_email: string | null }) => ({
          id: a.id,
          display_name: a.display_name,
          account_email: a.account_email,
        })))

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
        .select(`
          id, household_id, name, icon, sort_order,
          home_control_group_devices (device_id),
          home_control_group_toshiba_devices (toshiba_device_id),
          home_control_group_melcloud_devices (melcloud_device_id)
        `)
        .order('sort_order')
        .order('name')

      if (groupData) {
        const mappedGroups = groupData.map(g => ({
          ...g,
          device_ids: g.home_control_group_devices?.map((d: { device_id: string }) => d.device_id) || [],
          toshiba_device_ids: g.home_control_group_toshiba_devices?.map((d: { toshiba_device_id: string }) => d.toshiba_device_id) || [],
          melcloud_device_ids: g.home_control_group_melcloud_devices?.map((d: { melcloud_device_id: string }) => d.melcloud_device_id) || [],
        }))
        setGroups(mappedGroups)

        // Fetch Toshiba devices that are in any group
        const allToshibaDeviceIds = mappedGroups.flatMap(g => g.toshiba_device_ids)
        if (allToshibaDeviceIds.length > 0) {
          const { data: toshibaData } = await supabase
            .from('toshiba_ac_devices')
            .select('id, account_id, ac_id, name, custom_name, power_state, operation_mode, target_temperature, current_temperature, outdoor_temperature')
            .in('id', allToshibaDeviceIds)
            .eq('is_hidden', false)

          setToshibaDevicesInGroups(toshibaData || [])
        }

        // Fetch MelCloud devices that are in any group
        const allMelCloudDeviceIds = mappedGroups.flatMap(g => g.melcloud_device_ids)
        if (allMelCloudDeviceIds.length > 0) {
          const { data: melcloudData } = await supabase
            .from('melcloud_devices')
            .select('id, account_id, device_id, building_id, name, custom_name, power_state, operation_mode, target_temperature, current_temperature, outdoor_temperature')
            .in('id', allMelCloudDeviceIds)
            .eq('is_hidden', false)

          setMelcloudDevicesInGroups(melcloudData || [])
        }
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

  // Control all devices in an account
  const controlAccount = async (accountId: string, command: 'open' | 'close' | 'stop') => {
    const accountDevices = devices.filter(d => d.account_id === accountId && d.available)
    if (accountDevices.length === 0) return

    setControllingAccount(accountId)
    try {
      const response = await fetch('/api/home-control/somfy/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          devices: accountDevices.map(d => ({ deviceUrl: d.device_url, command })),
        }),
      })
      const data = await response.json()

      if (!data.success) {
        showError(data.error || t.homeControl.commandFailed)
      }

      // Update positions only on success
      if (data.success && (command === 'open' || command === 'close')) {
        const newPosition = command === 'open' ? 0 : 100
        setDevices(prev =>
          prev.map(d =>
            d.account_id === accountId ? { ...d, position: newPosition } : d
          )
        )
      }
    } catch (err) {
      console.error('Account control failed:', err)
      showError(t.homeControl.commandFailed)
    } finally {
      setControllingAccount(null)
    }
  }

  // Control Toshiba AC device in group
  const controlToshibaDevice = async (
    device: ToshibaDeviceInGroup,
    command: string,
    value?: string | number
  ) => {
    setControllingToshibaDevice(device.id)
    try {
      const response = await fetch('/api/home-control/toshiba/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: device.account_id,
          acId: device.ac_id,
          command,
          value,
        }),
      })
      const data = await response.json()

      if (data.success) {
        // Update local state
        setToshibaDevicesInGroups(prev =>
          prev.map(d => {
            if (d.id !== device.id) return d
            switch (command) {
              case 'power':
                return { ...d, power_state: value as ToshibaPowerState }
              case 'temperature':
                return { ...d, target_temperature: value as number }
              case 'turnOn':
                return { ...d, power_state: 'ON' as ToshibaPowerState }
              case 'turnOff':
                return { ...d, power_state: 'OFF' as ToshibaPowerState }
              default:
                return d
            }
          })
        )
        showToshibaConfirmation(device.id)
      } else {
        showError(data.error || t.homeControl.commandFailed)
      }
    } catch (err) {
      console.error('Toshiba control failed:', err)
      showError(t.homeControl.commandFailed)
    } finally {
      setControllingToshibaDevice(null)
    }
  }

  // Control MelCloud AC device in group
  const controlMelCloudDevice = async (
    device: MelCloudDeviceInGroup,
    command: string,
    value?: string | number
  ) => {
    setControllingMelCloudDevice(device.id)
    try {
      const response = await fetch('/api/home-control/melcloud/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: device.account_id,
          deviceId: device.device_id,
          buildingId: device.building_id,
          command,
          value,
        }),
      })
      const data = await response.json()

      if (data.success) {
        // Update local state
        setMelcloudDevicesInGroups(prev =>
          prev.map(d => {
            if (d.id !== device.id) return d
            switch (command) {
              case 'power':
                return { ...d, power_state: value as MelCloudPowerState }
              case 'temperature':
                return { ...d, target_temperature: value as number }
              case 'turnOn':
                return { ...d, power_state: 'ON' as MelCloudPowerState }
              case 'turnOff':
                return { ...d, power_state: 'OFF' as MelCloudPowerState }
              default:
                return d
            }
          })
        )
        showMelCloudConfirmation(device.id)
      } else {
        showError(data.error || t.homeControl.commandFailed)
      }
    } catch (err) {
      console.error('MelCloud control failed:', err)
      showError(t.homeControl.commandFailed)
    } finally {
      setControllingMelCloudDevice(null)
    }
  }

  // Group devices by account
  const devicesByAccount = useMemo(() => {
    const grouped: Record<string, HomeControlDevice[]> = {}
    devices.forEach(device => {
      if (!grouped[device.account_id]) {
        grouped[device.account_id] = []
      }
      grouped[device.account_id].push(device)
    })
    // Sort devices within each account: favorites first, then by label
    Object.keys(grouped).forEach(accountId => {
      grouped[accountId].sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
        return (a.custom_name || a.label).localeCompare(b.custom_name || b.label)
      })
    })
    return grouped
  }, [devices])

  // Get account display name by ID
  const getAccountName = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId)
    return getAccountDisplayName(account)
  }

  // Toggle account collapse state
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

  const hasDevices = devices.length > 0 || groups.length > 0

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        {/* Group skeleton */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl" style={{ background: 'rgba(213, 186, 124, 0.2)' }} />
            <div className="flex-1">
              <div className="h-4 w-28 rounded mb-1" style={{ background: 'var(--border)' }} />
              <div className="h-3 w-16 rounded" style={{ background: 'var(--border)' }} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="h-10 rounded-lg" style={{ background: 'var(--border)' }} />
            <div className="h-10 rounded-lg" style={{ background: 'var(--border)' }} />
            <div className="h-10 rounded-lg" style={{ background: 'var(--border)' }} />
          </div>
        </div>
        {/* Account section skeleton */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl" style={{ background: 'rgba(213, 186, 124, 0.2)' }} />
            <div className="flex-1">
              <div className="h-4 w-32 rounded mb-1" style={{ background: 'var(--border)' }} />
              <div className="h-3 w-20 rounded" style={{ background: 'var(--border)' }} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="h-10 rounded-lg" style={{ background: 'var(--border)' }} />
            <div className="h-10 rounded-lg" style={{ background: 'var(--border)' }} />
            <div className="h-10 rounded-lg" style={{ background: 'var(--border)' }} />
          </div>
          {/* Device cards skeleton */}
          <div className="space-y-2">
            <div className="rounded-lg p-3" style={{ background: 'color-mix(in srgb, var(--foreground) 3%, transparent)' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg" style={{ background: 'var(--border)' }} />
                <div className="flex-1">
                  <div className="h-4 w-24 rounded mb-1" style={{ background: 'var(--border)' }} />
                  <div className="h-3 w-16 rounded" style={{ background: 'var(--border)' }} />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5 mb-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-9 rounded-lg" style={{ background: 'var(--border)' }} />
                ))}
              </div>
              <div className="h-3 rounded-full" style={{ background: 'var(--border)' }} />
            </div>
          </div>
        </div>
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
            const groupToshibaDevices = toshibaDevicesInGroups.filter(d => group.toshiba_device_ids.includes(d.id))
            const groupMelCloudDevices = melcloudDevicesInGroups.filter(d => group.melcloud_device_ids.includes(d.id))
            const totalDevices = group.device_ids.length + groupToshibaDevices.length + groupMelCloudDevices.length
            // Get outdoor temperature from any AC device in this group (Toshiba or MelCloud)
            const outdoorTemp = groupToshibaDevices.find(d => d.outdoor_temperature !== null)?.outdoor_temperature
              ?? groupMelCloudDevices.find(d => d.outdoor_temperature !== null)?.outdoor_temperature
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
                      {t.homeControl.deviceCount.replace('{count}', String(totalDevices))}
                    </p>
                  </div>
                  {/* Outdoor temperature from AC unit */}
                  {outdoorTemp !== undefined && outdoorTemp !== null && (
                    <div className="flex items-center gap-1 shrink-0" style={{ color: 'var(--muted)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
                      </svg>
                      <span className="text-sm font-medium">{outdoorTemp}°</span>
                    </div>
                  )}
                </div>

                {/* Group Control Buttons (for Somfy screens) */}
                {group.device_ids.length > 0 && (
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
                )}

                {/* Toshiba AC devices in this group */}
                {groupToshibaDevices.length > 0 && (
                  <div className={group.device_ids.length > 0 ? 'mt-3 pt-3 border-t' : ''} style={{ borderColor: 'var(--border)' }}>
                    {groupToshibaDevices.map(device => {
                      const isOn = device.power_state === 'ON'
                      const isOffline = device.power_state === null
                      const isControlling = controllingToshibaDevice === device.id
                      const isConfirmed = confirmedToshibaDevice === device.id
                      const modeKey = device.operation_mode as keyof typeof t.homeControl.acModes
                      return (
                        <div
                          key={device.id}
                          className="rounded-lg p-3 mb-2 last:mb-0 transition-all relative"
                          style={{
                            background: 'color-mix(in srgb, var(--foreground) 3%, transparent)',
                            boxShadow: isConfirmed ? '0 0 0 2px var(--color-sage)' : 'none',
                            opacity: isOffline ? 0.7 : 1,
                          }}
                        >
                          {/* Loading overlay */}
                          {isControlling && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-lg z-10" style={{ background: 'rgba(var(--card-rgb, 255, 255, 255), 0.7)' }}>
                              <span className="loading-spinner" style={{ width: 20, height: 20, borderWidth: 2, color: 'var(--color-coral)' }} />
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                              style={{
                                background: isOffline ? 'rgba(128, 128, 128, 0.2)' : isOn ? 'rgba(232, 120, 109, 0.2)' : 'rgba(128, 128, 128, 0.2)',
                              }}
                            >
                              {/* AC unit icon */}
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isOffline ? 'var(--muted)' : isOn ? 'var(--color-coral)' : 'var(--muted)'} strokeWidth="2">
                                <rect x="2" y="4" width="20" height="12" rx="2"/>
                                <path d="M6 20v-4"/>
                                <path d="M18 20v-4"/>
                                <path d="M6 10h12"/>
                                <path d="M6 13h12"/>
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                                {device.custom_name || device.name}
                              </p>
                              <p className="text-xs" style={{ color: isConfirmed ? 'var(--color-sage)' : 'var(--muted)' }}>
                                {isConfirmed && '✓ '}
                                {isOffline ? (t.homeControl?.offline || 'Offline') : isOn ? (
                                  <>
                                    {t.homeControl?.acModes?.[modeKey] || device.operation_mode}
                                    {device.current_temperature != null && ` • ${device.current_temperature}°`}
                                    {device.target_temperature != null && ` → ${device.target_temperature}°`}
                                  </>
                                ) : (t.homeControl?.powerOff || 'Off')}
                              </p>
                            </div>

                            {/* Quick Controls */}
                            {!isOffline && (
                              <div className="flex items-center gap-2 shrink-0">
                                {/* Temperature controls (only when on) */}
                                {isOn && device.target_temperature !== null && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => controlToshibaDevice(device, 'temperature', Math.max(TEMPERATURE.MIN, device.target_temperature! - 1))}
                                      disabled={isControlling || device.target_temperature <= TEMPERATURE.MIN}
                                      className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-40 transition-colors"
                                      style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                                      aria-label={t.homeControl?.decreaseTemp || 'Decrease temperature'}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="5" y1="12" x2="19" y2="12"/>
                                      </svg>
                                    </button>
                                    <span className="text-sm font-medium w-10 text-center" style={{ color: 'var(--foreground)' }}>
                                      {device.target_temperature}°
                                    </span>
                                    <button
                                      onClick={() => controlToshibaDevice(device, 'temperature', Math.min(TEMPERATURE.MAX, device.target_temperature! + 1))}
                                      disabled={isControlling || device.target_temperature >= TEMPERATURE.MAX}
                                      className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-40 transition-colors"
                                      style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                                      aria-label={t.homeControl?.increaseTemp || 'Increase temperature'}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="12" y1="5" x2="12" y2="19"/>
                                        <line x1="5" y1="12" x2="19" y2="12"/>
                                      </svg>
                                    </button>
                                  </div>
                                )}

                                {/* Power toggle */}
                                <button
                                  onClick={() => controlToshibaDevice(device, isOn ? 'turnOff' : 'turnOn')}
                                  disabled={isControlling}
                                  className="w-12 h-7 rounded-full transition-all relative"
                                  style={{
                                    background: isOn ? 'var(--color-coral)' : 'var(--border)',
                                  }}
                                  aria-label={isOn ? (t.homeControl?.powerOff || 'Turn off') : (t.homeControl?.powerOn || 'Turn on')}
                                >
                                  <div
                                    className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform"
                                    style={{
                                      left: isOn ? 'calc(100% - 1.625rem)' : '0.125rem',
                                    }}
                                  />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* MelCloud AC devices in this group */}
                {groupMelCloudDevices.length > 0 && (
                  <div className={(group.device_ids.length > 0 || groupToshibaDevices.length > 0) ? 'mt-3 pt-3 border-t' : ''} style={{ borderColor: 'var(--border)' }}>
                    {groupMelCloudDevices.map(device => {
                      const isOn = device.power_state === 'ON'
                      const isOffline = device.power_state === null
                      const isControlling = controllingMelCloudDevice === device.id
                      const isConfirmed = confirmedMelCloudDevice === device.id
                      const modeKey = device.operation_mode as keyof typeof t.homeControl.acModes
                      return (
                        <div
                          key={device.id}
                          className="rounded-lg p-3 mb-2 last:mb-0 transition-all relative"
                          style={{
                            background: 'color-mix(in srgb, var(--foreground) 3%, transparent)',
                            boxShadow: isConfirmed ? '0 0 0 2px var(--color-sage)' : 'none',
                            opacity: isOffline ? 0.7 : 1,
                          }}
                        >
                          {/* Loading overlay */}
                          {isControlling && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-lg z-10" style={{ background: 'rgba(var(--card-rgb, 255, 255, 255), 0.7)' }}>
                              <span className="loading-spinner" style={{ width: 20, height: 20, borderWidth: 2, color: 'var(--color-sage)' }} />
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                              style={{
                                background: isOffline ? 'rgba(128, 128, 128, 0.2)' : isOn ? 'rgba(142, 184, 156, 0.2)' : 'rgba(128, 128, 128, 0.2)',
                              }}
                            >
                              {/* AC unit icon */}
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isOffline ? 'var(--muted)' : isOn ? 'var(--color-sage)' : 'var(--muted)'} strokeWidth="2">
                                <rect x="2" y="4" width="20" height="12" rx="2"/>
                                <path d="M6 20v-4"/>
                                <path d="M18 20v-4"/>
                                <path d="M6 10h12"/>
                                <path d="M6 13h12"/>
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                                {device.custom_name || device.name}
                              </p>
                              <p className="text-xs" style={{ color: isConfirmed ? 'var(--color-sage)' : 'var(--muted)' }}>
                                {isConfirmed && '✓ '}
                                {isOffline ? (t.homeControl?.offline || 'Offline') : isOn ? (
                                  <>
                                    {t.homeControl?.acModes?.[modeKey] || device.operation_mode}
                                    {device.current_temperature != null && ` • ${device.current_temperature}°`}
                                    {device.target_temperature != null && ` → ${device.target_temperature}°`}
                                  </>
                                ) : (t.homeControl?.powerOff || 'Off')}
                              </p>
                            </div>

                            {/* Quick Controls */}
                            {!isOffline && (
                              <div className="flex items-center gap-2 shrink-0">
                                {/* Temperature controls (only when on) */}
                                {isOn && device.target_temperature !== null && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => controlMelCloudDevice(device, 'temperature', Math.max(MELCLOUD_TEMPERATURE.MIN, device.target_temperature! - 1))}
                                      disabled={isControlling || device.target_temperature <= MELCLOUD_TEMPERATURE.MIN}
                                      className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-40 transition-colors"
                                      style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                                      aria-label={t.homeControl?.decreaseTemp || 'Decrease temperature'}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="5" y1="12" x2="19" y2="12"/>
                                      </svg>
                                    </button>
                                    <span className="text-sm font-medium w-10 text-center" style={{ color: 'var(--foreground)' }}>
                                      {device.target_temperature}°
                                    </span>
                                    <button
                                      onClick={() => controlMelCloudDevice(device, 'temperature', Math.min(MELCLOUD_TEMPERATURE.MAX, device.target_temperature! + 1))}
                                      disabled={isControlling || device.target_temperature >= MELCLOUD_TEMPERATURE.MAX}
                                      className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-40 transition-colors"
                                      style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                                      aria-label={t.homeControl?.increaseTemp || 'Increase temperature'}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="12" y1="5" x2="12" y2="19"/>
                                        <line x1="5" y1="12" x2="19" y2="12"/>
                                      </svg>
                                    </button>
                                  </div>
                                )}

                                {/* Power toggle */}
                                <button
                                  onClick={() => controlMelCloudDevice(device, isOn ? 'turnOff' : 'turnOn')}
                                  disabled={isControlling}
                                  className="w-12 h-7 rounded-full transition-all relative"
                                  style={{
                                    background: isOn ? 'var(--color-sage)' : 'var(--border)',
                                  }}
                                  aria-label={isOn ? (t.homeControl?.powerOff || 'Turn off') : (t.homeControl?.powerOn || 'Turn on')}
                                >
                                  <div
                                    className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform"
                                    style={{
                                      left: isOn ? 'calc(100% - 1.625rem)' : '0.125rem',
                                    }}
                                  />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Devices grouped by Account (Location) */}
      {Object.entries(devicesByAccount).map(([accountId, accountDevices]) => {
        const isControllingThisAccount = controllingAccount === accountId
        const accountName = getAccountName(accountId)
        const isCollapsed = collapsedAccounts.has(accountId)

        return (
          <div
            key={accountId}
            className="rounded-2xl p-4"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            {/* Account Header with Quick Controls */}
            <button
              type="button"
              onClick={() => toggleAccountCollapse(accountId)}
              className="flex items-center gap-3 mb-3 w-full text-left"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(213, 186, 124, 0.2)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {accountName}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {t.homeControl.deviceCount.replace('{count}', String(accountDevices.length))}
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

            {/* Account Quick Control Buttons */}
            <div className={`grid grid-cols-3 gap-2 ${isCollapsed ? '' : 'mb-4'}`}>
              <button
                onClick={(e) => { e.stopPropagation(); controlAccount(accountId, 'open') }}
                disabled={isControllingThisAccount}
                className="control-btn control-btn-open"
                aria-label={`${t.homeControl.allUp} ${accountName}`}
              >
                {isControllingThisAccount ? (
                  <span className="loading-spinner" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="18 15 12 9 6 15"/>
                  </svg>
                )}
                <span>{t.homeControl.allUp}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); controlAccount(accountId, 'stop') }}
                disabled={isControllingThisAccount}
                className="control-btn control-btn-stop"
                aria-label={`${t.homeControl.stop} ${accountName}`}
              >
                {isControllingThisAccount ? (
                  <span className="loading-spinner" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="6" y="6" width="12" height="12"/>
                  </svg>
                )}
                <span>{t.homeControl.stop}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); controlAccount(accountId, 'close') }}
                disabled={isControllingThisAccount}
                className="control-btn control-btn-close"
                aria-label={`${t.homeControl.allDown} ${accountName}`}
              >
                {isControllingThisAccount ? (
                  <span className="loading-spinner" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                )}
                <span>{t.homeControl.allDown}</span>
              </button>
            </div>

            {/* Individual Devices in this Account */}
            {!isCollapsed && (
            <div className={compact ? 'space-y-2' : 'grid gap-2 grid-cols-1 md:grid-cols-2'}>
              {accountDevices.map(device => {
                const isControlling = controllingDevice === device.device_url
                const isConfirmed = confirmedDevice === device.device_url
                const isSliding = activeSlider === device.device_url
                const currentPosition = isSliding ? sliderValue : (device.position ?? 0)

                return (
                  <div
                    key={device.id}
                    className="rounded-lg p-3 transition-all relative"
                    style={{
                      background: 'color-mix(in srgb, var(--foreground) 3%, transparent)',
                      boxShadow: isConfirmed ? '0 0 0 2px var(--color-sage)' : 'none',
                    }}
                  >
                    {/* Loading overlay */}
                    {isControlling && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg z-10" style={{ background: 'rgba(var(--card-rgb, 255, 255, 255), 0.7)' }}>
                        <span className="loading-spinner" style={{ width: 24, height: 24, borderWidth: 3, color: 'var(--color-sky)' }} />
                      </div>
                    )}
                    {/* Device Header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: 'rgba(126, 182, 196, 0.2)', color: 'var(--color-sky)' }}
                        >
                          {getDeviceIcon(device.ui_class)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate" style={{ color: 'var(--foreground)' }}>
                            {device.custom_name || device.label}
                          </p>
                          <p className="text-xs" style={{ color: isConfirmed ? 'var(--color-sage)' : 'var(--muted)' }}>
                            {isConfirmed && '✓ '}
                            {currentPosition === 0 ? t.homeControl.open : currentPosition === 100 ? t.homeControl.closed : `${currentPosition}%`}
                          </p>
                        </div>
                      </div>
                      {device.favorite && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-honey)" stroke="var(--color-honey)" strokeWidth="2" aria-label={t.homeControl.favoritePosition}>
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      )}
                    </div>

                    {device.available ? (
                      <>
                        {/* Quick Action Buttons */}
                        <div className="grid grid-cols-4 gap-1.5 mb-3">
                          <button
                            onClick={() => controlDevice(device.account_id, device.device_url, 'open')}
                            disabled={isControlling}
                            className="control-btn control-btn-open py-2"
                            aria-label={`${t.homeControl.openAction} ${device.custom_name || device.label}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="18 15 12 9 6 15"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => controlDevice(device.account_id, device.device_url, 'stop')}
                            disabled={isControlling}
                            className="control-btn control-btn-stop py-2"
                            aria-label={`${t.homeControl.stop} ${device.custom_name || device.label}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <rect x="6" y="6" width="12" height="12"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => controlDevice(device.account_id, device.device_url, 'close')}
                            disabled={isControlling}
                            className="control-btn control-btn-close py-2"
                            aria-label={`${t.homeControl.closeAction} ${device.custom_name || device.label}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="6 9 12 15 18 9"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => controlDevice(device.account_id, device.device_url, 'my')}
                            disabled={isControlling}
                            className="control-btn control-btn-fav py-2"
                            aria-label={`${t.homeControl.favoritePosition} ${device.custom_name || device.label}`}
                            title={t.homeControl.favoritePosition}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                            </svg>
                          </button>
                        </div>

                        {/* Position Slider */}
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
                        {/* Position labels */}
                        <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--muted)' }}>
                          <span>{t.homeControl.open}</span>
                          <span>{t.homeControl.closed}</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs py-1" style={{ color: 'var(--color-coral)' }}>
                        {t.homeControl.unavailable}
                      </p>
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
            {t.settings.title}
          </TransitionLink>
        </div>
      )}
    </div>
  )
}
