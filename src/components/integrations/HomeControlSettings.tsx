'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type { OverkizServer } from '@/lib/integrations/somfy'
import { SOMFY_UI } from '@/lib/integrations/somfy/constants'
import { getAccountDisplayName } from '@/lib/integrations/somfy/utils'

type ServiceType = 'somfy' | 'toshiba' | 'melcloud'

interface HomeControlAccount {
  id: string
  service: ServiceType
  display_name: string
  account_email: string | null
  server: string
  last_sync_at: string | null
  last_sync_status: string
  last_sync_error: string | null
}

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

interface ToshibaDevice {
  id: string
  account_id: string
  name: string
  custom_name: string | null
}

interface MelCloudDevice {
  id: string
  account_id: string
  name: string
  custom_name: string | null
}

interface HomeControlSettingsProps {
  householdId: string
  onMessage: (type: 'success' | 'error', text: string) => void
}

const SERVER_OPTION_KEYS: { value: OverkizServer; labelKey: 'regionEurope' | 'regionNorthAmerica' | 'regionOceania' }[] = [
  { value: 'somfy_europe', labelKey: 'regionEurope' },
  { value: 'somfy_america', labelKey: 'regionNorthAmerica' },
  { value: 'somfy_oceania', labelKey: 'regionOceania' },
]

const UI_CLASS_KEYS = [
  'ExteriorScreen',
  'Screen',
  'RollerShutter',
  'Awning',
  'Pergola',
  'GarageDoor',
  'Gate',
  'Window',
  'VenetianBlind',
  'ExteriorVenetianBlind',
  'Blind',
  'Curtain',
] as const

type DeviceTypeKey = typeof UI_CLASS_KEYS[number]

function getDeviceTypeLabel(uiClass: string, deviceTypes: Record<string, string>): string {
  return deviceTypes[uiClass as DeviceTypeKey] || uiClass
}

function sanitizeDeviceName(name: string): string {
  let sanitized = name.trim()
  if (sanitized.length > SOMFY_UI.MAX_DEVICE_NAME_LENGTH) {
    sanitized = sanitized.substring(0, SOMFY_UI.MAX_DEVICE_NAME_LENGTH)
  }
  return sanitized
}

export function HomeControlSettings({ householdId, onMessage }: HomeControlSettingsProps) {
  const { t } = useLanguage()
  const [accounts, setAccounts] = useState<HomeControlAccount[]>([])
  const [devices, setDevices] = useState<HomeControlDevice[]>([])
  const [toshibaDevices, setToshibaDevices] = useState<ToshibaDevice[]>([])
  const [melcloudDevices, setMelcloudDevices] = useState<MelCloudDevice[]>([])
  const [groups, setGroups] = useState<HomeControlGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [editingGroup, setEditingGroup] = useState<HomeControlGroup | null>(null)

  // Form state
  const [serviceType, setServiceType] = useState<ServiceType>('somfy')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState<OverkizServer>('somfy_europe')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    deviceCount?: number
    error?: string
  } | null>(null)

  // Group form state
  const [groupName, setGroupName] = useState('')
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])
  const [selectedToshibaDeviceIds, setSelectedToshibaDeviceIds] = useState<string[]>([])
  const [selectedMelCloudDeviceIds, setSelectedMelCloudDeviceIds] = useState<string[]>([])
  const [savingGroup, setSavingGroup] = useState(false)

  // Edit device state
  const [editingDevice, setEditingDevice] = useState<string | null>(null)
  const [editDeviceName, setEditDeviceName] = useState('')
  const [editDeviceType, setEditDeviceType] = useState('')
  const [savingDevice, setSavingDevice] = useState(false)
  const [syncingAccount, setSyncingAccount] = useState<string | null>(null)
  const [togglingHidden, setTogglingHidden] = useState<string | null>(null)

  // Edit account name state
  const [editingAccount, setEditingAccount] = useState<string | null>(null)
  const [editAccountName, setEditAccountName] = useState('')
  const [savingAccountName, setSavingAccountName] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  const loadAccounts = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_household_home_control_accounts')
      if (error) throw error
      setAccounts(data || [])

      if (data && data.length > 0) {
        // Load Somfy devices
        const somfyAccounts = data.filter((a: HomeControlAccount) => a.service === 'somfy')
        if (somfyAccounts.length > 0) {
          const { data: deviceData } = await supabase
            .from('home_control_devices')
            .select('*')
            .in('account_id', somfyAccounts.map((a: HomeControlAccount) => a.id))
            .order('favorite', { ascending: false })
            .order('label')
          setDevices(deviceData || [])
        }

        // Load Toshiba devices
        const toshibaAccounts = data.filter((a: HomeControlAccount) => a.service === 'toshiba')
        if (toshibaAccounts.length > 0) {
          const { data: toshibaData } = await supabase
            .from('toshiba_ac_devices')
            .select('id, account_id, name, custom_name')
            .in('account_id', toshibaAccounts.map((a: HomeControlAccount) => a.id))
            .eq('is_hidden', false)
            .order('name')
          setToshibaDevices(toshibaData || [])
        }

        // Load MelCloud devices
        const melcloudAccounts = data.filter((a: HomeControlAccount) => a.service === 'melcloud')
        if (melcloudAccounts.length > 0) {
          const { data: melcloudData } = await supabase
            .from('melcloud_devices')
            .select('id, account_id, name, custom_name')
            .in('account_id', melcloudAccounts.map((a: HomeControlAccount) => a.id))
            .eq('is_hidden', false)
            .order('name')
          setMelcloudDevices(melcloudData || [])
        }
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
        setGroups(groupData.map(g => ({
          ...g,
          device_ids: g.home_control_group_devices?.map((d: { device_id: string }) => d.device_id) || [],
          toshiba_device_ids: g.home_control_group_toshiba_devices?.map((d: { toshiba_device_id: string }) => d.toshiba_device_id) || [],
          melcloud_device_ids: g.home_control_group_melcloud_devices?.map((d: { melcloud_device_id: string }) => d.melcloud_device_id) || [],
        })))
      }
    } catch (err) {
      console.error('Failed to load home control accounts:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const testConnection = async () => {
    if (!email || !password) return
    setTesting(true)
    setTestResult(null)

    try {
      const endpoint = serviceType === 'toshiba'
        ? '/api/home-control/toshiba/test-connection'
        : serviceType === 'melcloud'
        ? '/api/home-control/melcloud/test-connection'
        : '/api/home-control/somfy/test-connection'

      const body = serviceType === 'toshiba'
        ? { username: email, password }
        : serviceType === 'melcloud'
        ? { email, password }
        : { email, password, server }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      setTestResult(data.success
        ? { success: true, deviceCount: data.deviceCount }
        : { success: false, error: data.error }
      )
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : t.homeControl.connectionFailed,
      })
    } finally {
      setTesting(false)
    }
  }

  const saveAccount = async () => {
    if (!email || !password || !testResult?.success) return
    setSaving(true)

    try {
      const credentials = serviceType === 'toshiba'
        ? { username: email, password }
        : { email, password }

      const { data, error } = await supabase.rpc('upsert_home_control_account', {
        p_household_id: householdId,
        p_service: serviceType,
        p_display_name: email,
        p_credentials: credentials,
        p_account_email: email,
        p_server: serviceType === 'somfy' ? server : null,
      })
      if (error) throw error

      const syncEndpoint = serviceType === 'toshiba'
        ? `/api/home-control/toshiba/devices?accountId=${data}`
        : serviceType === 'melcloud'
        ? `/api/home-control/melcloud/devices?accountId=${data}`
        : `/api/home-control/somfy/devices?accountId=${data}`

      await fetch(syncEndpoint, { method: 'POST' })
      onMessage('success', t.homeControl.syncSuccess)
      setShowAddForm(false)
      setEmail('')
      setPassword('')
      setServiceType('somfy')
      setTestResult(null)
      await loadAccounts()
    } catch (err) {
      console.error('Failed to save account:', err)
      onMessage('error', t.homeControl.couldNotSaveAccount)
    } finally {
      setSaving(false)
    }
  }

  const deleteAccount = async (accountId: string) => {
    if (!confirm(t.homeControl.removeAccountConfirm)) return
    try {
      const { error } = await supabase.rpc('delete_home_control_account', { p_account_id: accountId })
      if (error) throw error
      setAccounts(accounts.filter(a => a.id !== accountId))
      setDevices(devices.filter(d => d.account_id !== accountId))
      onMessage('success', t.homeControl.accountRemoved)
    } catch (err) {
      console.error('Failed to delete account:', err)
      onMessage('error', t.homeControl.couldNotRemoveAccount)
    }
  }

  const saveAccountName = async (accountId: string) => {
    if (!editAccountName.trim()) return
    setSavingAccountName(true)
    try {
      const { error } = await supabase
        .from('home_control_accounts')
        .update({ display_name: editAccountName.trim() })
        .eq('id', accountId)
      if (error) throw error
      setAccounts(accounts.map(a =>
        a.id === accountId ? { ...a, display_name: editAccountName.trim() } : a
      ))
      setEditingAccount(null)
      setEditAccountName('')
      onMessage('success', t.homeControl.locationNameUpdated)
    } catch (err) {
      console.error('Failed to save account name:', err)
      onMessage('error', t.homeControl.couldNotSaveName)
    } finally {
      setSavingAccountName(false)
    }
  }

  const startEditingAccount = (account: HomeControlAccount) => {
    setEditingAccount(account.id)
    setEditAccountName(account.display_name || account.account_email || '')
  }

  const syncDevices = async (accountId: string, service: ServiceType) => {
    setSyncingAccount(accountId)
    try {
      const endpoint = service === 'toshiba'
        ? `/api/home-control/toshiba/devices?accountId=${accountId}`
        : service === 'melcloud'
        ? `/api/home-control/melcloud/devices?accountId=${accountId}`
        : `/api/home-control/somfy/devices?accountId=${accountId}`

      const response = await fetch(endpoint, { method: 'POST' })
      const data = await response.json()

      if (data.success) {
        // For Toshiba, devices come from toshiba_ac_devices table
        // For Somfy, devices come from home_control_devices table
        // Just reload all accounts to get fresh data
        await loadAccounts()
        onMessage('success', t.homeControl.synced.replace('{count}', String(data.devices.length)))
      } else {
        onMessage('error', data.error || t.homeControl.syncFailed)
      }
    } catch (err) {
      console.error('Sync failed:', err)
      onMessage('error', t.homeControl.syncFailed)
    } finally {
      setSyncingAccount(null)
    }
  }

  const saveDeviceSettings = async (deviceId: string) => {
    setSavingDevice(true)
    try {
      const sanitizedName = sanitizeDeviceName(editDeviceName)
      const finalName = sanitizedName || null

      const { error } = await supabase
        .from('home_control_devices')
        .update({
          custom_name: finalName,
          ui_class: editDeviceType || undefined,
        })
        .eq('id', deviceId)

      if (error) throw error

      setDevices(prev =>
        prev.map(d =>
          d.id === deviceId
            ? { ...d, custom_name: finalName, ui_class: editDeviceType || d.ui_class }
            : d
        )
      )
      setEditingDevice(null)
      setEditDeviceName('')
      setEditDeviceType('')
      onMessage('success', t.homeControl.nameUpdated)
    } catch (err) {
      console.error('Failed to save device settings:', err)
      onMessage('error', t.homeControl.couldNotSaveName)
    } finally {
      setSavingDevice(false)
    }
  }

  const toggleDeviceHidden = async (deviceId: string, hidden: boolean) => {
    setTogglingHidden(deviceId)
    try {
      const { error } = await supabase
        .from('home_control_devices')
        .update({ is_hidden: hidden })
        .eq('id', deviceId)

      if (error) throw error

      setDevices(prev =>
        prev.map(d => d.id === deviceId ? { ...d, is_hidden: hidden } : d)
      )
    } catch (err) {
      console.error('Failed to toggle device visibility:', err)
      onMessage('error', t.homeControl.commandFailed)
    } finally {
      setTogglingHidden(null)
    }
  }

  const saveGroup = async () => {
    // Need at least a name and at least one device (Somfy, Toshiba, or MelCloud)
    if (!groupName.trim() || (selectedDeviceIds.length === 0 && selectedToshibaDeviceIds.length === 0 && selectedMelCloudDeviceIds.length === 0)) return
    setSavingGroup(true)

    try {
      if (editingGroup) {
        await supabase.from('home_control_groups').update({ name: groupName.trim() }).eq('id', editingGroup.id)

        // Update Somfy device assignments
        await supabase.from('home_control_group_devices').delete().eq('group_id', editingGroup.id)
        if (selectedDeviceIds.length > 0) {
          await supabase.from('home_control_group_devices').insert(
            selectedDeviceIds.map(deviceId => ({ group_id: editingGroup.id, device_id: deviceId }))
          )
        }

        // Update Toshiba device assignments
        await supabase.from('home_control_group_toshiba_devices').delete().eq('group_id', editingGroup.id)
        if (selectedToshibaDeviceIds.length > 0) {
          await supabase.from('home_control_group_toshiba_devices').insert(
            selectedToshibaDeviceIds.map(deviceId => ({ group_id: editingGroup.id, toshiba_device_id: deviceId }))
          )
        }

        // Update MelCloud device assignments
        await supabase.from('home_control_group_melcloud_devices').delete().eq('group_id', editingGroup.id)
        if (selectedMelCloudDeviceIds.length > 0) {
          await supabase.from('home_control_group_melcloud_devices').insert(
            selectedMelCloudDeviceIds.map(deviceId => ({ group_id: editingGroup.id, melcloud_device_id: deviceId }))
          )
        }
        onMessage('success', t.homeControl.groupUpdated)
      } else {
        const { data: newGroup, error } = await supabase
          .from('home_control_groups')
          .insert({ household_id: householdId, name: groupName.trim() })
          .select('id')
          .single()
        if (error) throw error

        // Add Somfy devices to group
        if (selectedDeviceIds.length > 0) {
          await supabase.from('home_control_group_devices').insert(
            selectedDeviceIds.map(deviceId => ({ group_id: newGroup.id, device_id: deviceId }))
          )
        }

        // Add Toshiba devices to group
        if (selectedToshibaDeviceIds.length > 0) {
          await supabase.from('home_control_group_toshiba_devices').insert(
            selectedToshibaDeviceIds.map(deviceId => ({ group_id: newGroup.id, toshiba_device_id: deviceId }))
          )
        }

        // Add MelCloud devices to group
        if (selectedMelCloudDeviceIds.length > 0) {
          await supabase.from('home_control_group_melcloud_devices').insert(
            selectedMelCloudDeviceIds.map(deviceId => ({ group_id: newGroup.id, melcloud_device_id: deviceId }))
          )
        }
        onMessage('success', t.homeControl.groupCreated)
      }

      setShowGroupForm(false)
      setEditingGroup(null)
      setGroupName('')
      setSelectedDeviceIds([])
      setSelectedToshibaDeviceIds([])
      setSelectedMelCloudDeviceIds([])
      await loadAccounts()
    } catch (err) {
      console.error('Failed to save group:', err)
      onMessage('error', t.homeControl.couldNotSaveGroup)
    } finally {
      setSavingGroup(false)
    }
  }

  const deleteGroup = async (groupId: string) => {
    if (!confirm(t.homeControl.deleteGroupConfirm)) return
    try {
      await supabase.from('home_control_groups').delete().eq('id', groupId)
      setGroups(groups.filter(g => g.id !== groupId))
      onMessage('success', t.homeControl.groupDeleted)
    } catch (err) {
      console.error('Failed to delete group:', err)
      onMessage('error', t.homeControl.couldNotDeleteGroup)
    }
  }

  const openEditGroup = (group: HomeControlGroup) => {
    setEditingGroup(group)
    setGroupName(group.name)
    setSelectedDeviceIds(group.device_ids)
    setSelectedToshibaDeviceIds(group.toshiba_device_ids || [])
    setSelectedMelCloudDeviceIds(group.melcloud_device_ids || [])
    setShowGroupForm(true)
  }

  const startEditingDevice = (device: HomeControlDevice) => {
    setEditingDevice(device.id)
    setEditDeviceName(device.custom_name || device.label)
    setEditDeviceType(device.ui_class)
  }

  // Get account display name by ID
  const getAccountName = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId)
    return getAccountDisplayName(account)
  }

  // Group devices by account for the group form
  const devicesByAccount = useMemo(() => {
    const grouped: Record<string, HomeControlDevice[]> = {}
    devices.filter(d => !d.is_hidden).forEach(device => {
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
        <div className="h-12 rounded-xl" style={{ background: 'var(--background)' }} />
        <div className="h-12 rounded-xl" style={{ background: 'var(--background)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Connected Accounts */}
      <div>
        <h4 className="font-medium text-sm mb-3" style={{ color: 'var(--foreground)' }}>
          {t.homeControl.title}
        </h4>

        {accounts.map(account => (
          <div
            key={account.id}
            className="rounded-xl p-4 mb-4"
            style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
          >
            {editingAccount === account.id ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                    {t.homeControl.locationName}
                  </label>
                  <input
                    type="text"
                    value={editAccountName}
                    onChange={e => setEditAccountName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && editAccountName.trim()) {
                        saveAccountName(account.id)
                      } else if (e.key === 'Escape') {
                        setEditingAccount(null)
                        setEditAccountName('')
                      }
                    }}
                    className="input text-sm py-2"
                    placeholder={t.homeControl.locationNamePlaceholder}
                    autoFocus
                  />
                </div>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {account.account_email}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => saveAccountName(account.id)}
                    disabled={savingAccountName || !editAccountName.trim()}
                    className="btn btn-primary text-sm py-2"
                  >
                    {savingAccountName ? t.homeControl.saving : t.homeControl.save}
                  </button>
                  <button
                    onClick={() => {
                      setEditingAccount(null)
                      setEditAccountName('')
                    }}
                    className="btn btn-secondary text-sm py-2"
                  >
                    {t.homeControl.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: account.service === 'toshiba' ? 'rgba(232, 120, 109, 0.2)' : account.service === 'melcloud' ? 'rgba(158, 185, 154, 0.2)' : 'rgba(126, 182, 196, 0.2)' }}
                  >
                    {account.service === 'toshiba' ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
                        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/>
                        <path d="M12 6v6l4 2"/>
                        <path d="M8 14h8"/>
                        <path d="M8 18h8"/>
                      </svg>
                    ) : account.service === 'melcloud' ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2">
                        <rect x="2" y="4" width="20" height="16" rx="2"/>
                        <path d="M6 8h4"/>
                        <path d="M6 12h2"/>
                        <circle cx="17" cy="12" r="3"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="9" y1="3" x2="9" y2="21"/>
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{
                        background: account.service === 'toshiba' ? 'rgba(232, 120, 109, 0.15)' : account.service === 'melcloud' ? 'rgba(158, 185, 154, 0.15)' : 'rgba(126, 182, 196, 0.15)',
                        color: account.service === 'toshiba' ? 'var(--color-coral)' : account.service === 'melcloud' ? 'var(--color-sage)' : 'var(--color-sky)',
                      }}>
                        {account.service === 'toshiba' ? 'Toshiba AC' : account.service === 'melcloud' ? 'Mitsubishi AC' : 'Somfy'}
                      </span>
                      <p className="font-medium truncate" style={{ color: 'var(--foreground)' }}>
                        {account.display_name !== account.account_email ? account.display_name : account.account_email}
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          startEditingAccount(account)
                        }}
                        className="px-2.5 py-2 rounded-md text-xs flex items-center gap-1 transition-colors min-h-[44px]"
                        style={{
                          background: 'rgba(126, 182, 196, 0.1)',
                          color: 'var(--color-sky)',
                        }}
                        title={t.homeControl.editLocation}
                        aria-label={t.homeControl.editLocation}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        {t.homeControl.editLocation}
                      </button>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {account.display_name !== account.account_email && account.account_email && (
                        <>{account.account_email} &bull; </>
                      )}
                      {account.service === 'somfy' && t.homeControl[SERVER_OPTION_KEYS.find(s => s.value === account.server)?.labelKey || 'regionEurope']}
                      {account.last_sync_at && (
                        <> &bull; {t.homeControl.lastSynced} {new Date(account.last_sync_at).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => syncDevices(account.id, account.service)}
                    disabled={syncingAccount === account.id}
                    className="btn btn-secondary text-sm py-2 px-3"
                  >
                    {syncingAccount === account.id ? t.homeControl.syncing : t.homeControl.sync}
                  </button>
                  <button
                    onClick={() => deleteAccount(account.id)}
                    disabled={syncingAccount === account.id}
                    className="text-sm px-3 py-2 rounded-lg"
                    style={{ color: 'var(--color-coral)' }}
                  >
                    {t.homeControl.removeAccount}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add account form */}
        {showAddForm ? (
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
          >
            <h4 className="font-medium mb-4" style={{ color: 'var(--foreground)' }}>
              {t.homeControl.addAccount || 'Add Account'}
            </h4>
            <div className="space-y-4">
              {/* Service Type Selector */}
              <div>
                <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>
                  {t.homeControl.serviceType || 'Service Type'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => { setServiceType('somfy'); setTestResult(null) }}
                    className="p-3 rounded-lg flex flex-col items-center gap-1 transition-all"
                    style={{
                      background: serviceType === 'somfy' ? 'rgba(126, 182, 196, 0.15)' : 'var(--background)',
                      border: serviceType === 'somfy' ? '2px solid var(--color-sky)' : '1px solid var(--border)',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={serviceType === 'somfy' ? 'var(--color-sky)' : 'var(--muted)'} strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <line x1="9" y1="3" x2="9" y2="21"/>
                    </svg>
                    <span className="text-xs font-medium" style={{ color: serviceType === 'somfy' ? 'var(--color-sky)' : 'var(--muted)' }}>
                      Somfy
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setServiceType('toshiba'); setTestResult(null) }}
                    className="p-3 rounded-lg flex flex-col items-center gap-1 transition-all"
                    style={{
                      background: serviceType === 'toshiba' ? 'rgba(232, 120, 109, 0.15)' : 'var(--background)',
                      border: serviceType === 'toshiba' ? '2px solid var(--color-coral)' : '1px solid var(--border)',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={serviceType === 'toshiba' ? 'var(--color-coral)' : 'var(--muted)'} strokeWidth="2">
                      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/>
                      <path d="M12 6v6l4 2"/>
                      <path d="M8 14h8"/>
                      <path d="M8 18h8"/>
                    </svg>
                    <span className="text-xs font-medium" style={{ color: serviceType === 'toshiba' ? 'var(--color-coral)' : 'var(--muted)' }}>
                      Toshiba AC
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setServiceType('melcloud'); setTestResult(null) }}
                    className="p-3 rounded-lg flex flex-col items-center gap-1 transition-all"
                    style={{
                      background: serviceType === 'melcloud' ? 'rgba(158, 185, 154, 0.15)' : 'var(--background)',
                      border: serviceType === 'melcloud' ? '2px solid var(--color-sage)' : '1px solid var(--border)',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={serviceType === 'melcloud' ? 'var(--color-sage)' : 'var(--muted)'} strokeWidth="2">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <path d="M6 8h4"/>
                      <path d="M6 12h2"/>
                      <circle cx="17" cy="12" r="3"/>
                    </svg>
                    <span className="text-xs font-medium" style={{ color: serviceType === 'melcloud' ? 'var(--color-sage)' : 'var(--muted)' }}>
                      Mitsubishi
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                  {serviceType === 'toshiba' ? (t.homeControl.username || 'Username') : t.homeControl.accountEmail}
                </label>
                <input
                  type={serviceType === 'toshiba' ? 'text' : 'email'}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input"
                  placeholder={serviceType === 'toshiba' ? (t.homeControl.usernamePlaceholder || 'Your Toshiba username') : serviceType === 'melcloud' ? 'MELCloud email' : t.homeControl.emailPlaceholder}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                  {t.homeControl.accountPassword}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input"
                />
              </div>
              {serviceType === 'somfy' && (
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                    {t.homeControl.region}
                  </label>
                  <select
                    value={server}
                    onChange={e => setServer(e.target.value as OverkizServer)}
                    className="input"
                  >
                    {SERVER_OPTION_KEYS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {t.homeControl[opt.labelKey]}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {testResult && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    background: testResult.success ? 'rgba(158, 185, 154, 0.15)' : 'rgba(232, 120, 109, 0.15)',
                    color: testResult.success ? 'var(--color-sage)' : 'var(--color-coral)',
                  }}
                >
                  {testResult.success
                    ? t.homeControl.connectionSuccessWithCount.replace('{count}', String(testResult.deviceCount))
                    : testResult.error}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={testConnection}
                  disabled={testing || !email || !password}
                  className="btn btn-secondary"
                >
                  {testing ? t.homeControl.testing : t.homeControl.testConnection}
                </button>
                {testResult?.success && (
                  <button onClick={saveAccount} disabled={saving} className="btn btn-primary">
                    {saving ? t.homeControl.saving : t.homeControl.saveAccount}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowAddForm(false)
                    setEmail('')
                    setPassword('')
                    setServiceType('somfy')
                    setTestResult(null)
                  }}
                  className="btn btn-secondary"
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
            style={{ background: 'var(--background)', border: '1px dashed var(--border)', color: 'var(--muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {t.homeControl.addAccount || 'Add Smart Home Account'}
          </button>
        )}
      </div>

      {/* Device Configuration */}
      {devices.length > 0 && (
        <div>
          <h4 className="font-medium text-sm mb-3" style={{ color: 'var(--foreground)' }}>
            {t.homeControl.devices}
          </h4>
          <div className="space-y-2">
            {devices.map(device => (
              <div
                key={device.id}
                className="rounded-xl p-3"
                style={{
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  opacity: device.is_hidden ? 0.5 : 1,
                }}
              >
                {editingDevice === device.id ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                        {t.homeControl.customName}
                      </label>
                      <input
                        type="text"
                        value={editDeviceName}
                        onChange={e => setEditDeviceName(e.target.value)}
                        className="input text-sm py-2"
                        placeholder={device.label}
                        maxLength={SOMFY_UI.MAX_DEVICE_NAME_LENGTH}
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                        {t.homeControl.deviceType}
                      </label>
                      <select
                        value={editDeviceType}
                        onChange={e => setEditDeviceType(e.target.value)}
                        className="input text-sm py-2"
                      >
                        {UI_CLASS_KEYS.map(key => (
                          <option key={key} value={key}>
                            {getDeviceTypeLabel(key, t.homeControl.deviceTypes)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveDeviceSettings(device.id)}
                        disabled={savingDevice}
                        className="btn btn-primary text-sm py-2"
                      >
                        {savingDevice ? '...' : t.homeControl.save}
                      </button>
                      <button
                        onClick={() => {
                          setEditingDevice(null)
                          setEditDeviceName('')
                          setEditDeviceType('')
                        }}
                        className="btn btn-secondary text-sm py-2"
                      >
                        {t.homeControl.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate" style={{ color: 'var(--foreground)' }}>
                          {device.custom_name || device.label}
                        </p>
                        {device.favorite && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-honey)" stroke="var(--color-honey)" strokeWidth="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                          </svg>
                        )}
                      </div>
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        {getDeviceTypeLabel(device.ui_class, t.homeControl.deviceTypes)}
                        <span className="mx-1">&bull;</span>
                        {getAccountName(device.account_id)}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => startEditingDevice(device)}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                        title={t.homeControl.editDevice}
                        aria-label={`${t.homeControl.editDevice}: ${device.custom_name || device.label}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => toggleDeviceHidden(device.id, !device.is_hidden)}
                        disabled={togglingHidden === device.id}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                        title={device.is_hidden ? t.homeControl.showDevice : t.homeControl.hideDevice}
                        aria-label={device.is_hidden ? t.homeControl.showDevice : t.homeControl.hideDevice}
                      >
                        {togglingHidden === device.id ? (
                          <span className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                        ) : device.is_hidden ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Device Groups */}
      {(devices.length > 0 || toshibaDevices.length > 0 || melcloudDevices.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
              {t.homeControl.groups}
            </h4>
            {!showGroupForm && (
              <button
                onClick={() => {
                  setShowGroupForm(true)
                  setEditingGroup(null)
                  setGroupName('')
                  setSelectedDeviceIds([])
                }}
                className="text-xs"
                style={{ color: 'var(--color-sky)' }}
              >
                + {t.homeControl.newGroup}
              </button>
            )}
          </div>

          {groups.map(group => (
            <div
              key={group.id}
              className="rounded-xl p-3 mb-2"
              style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: 'rgba(213, 186, 124, 0.2)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7"/>
                      <rect x="14" y="3" width="7" height="7"/>
                      <rect x="14" y="14" width="7" height="7"/>
                      <rect x="3" y="14" width="7" height="7"/>
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
                      {group.name}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {t.homeControl.deviceCount.replace('{count}', String(group.device_ids.length + (group.toshiba_device_ids?.length || 0) + (group.melcloud_device_ids?.length || 0)))}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEditGroup(group)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    title={t.homeControl.editGroupLabel}
                    aria-label={`${t.homeControl.editGroupLabel}: ${group.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteGroup(group.id)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    title={t.homeControl.deleteGroup}
                    aria-label={`${t.homeControl.deleteGroup}: ${group.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Group Form */}
          {showGroupForm && (
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
            >
              <h4 className="font-medium mb-4" style={{ color: 'var(--foreground)' }}>
                {editingGroup ? t.homeControl.editGroup : t.homeControl.newGroup}
              </h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                    {t.homeControl.groupName}
                  </label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={e => setGroupName(e.target.value)}
                    className="input"
                    placeholder={t.homeControl.exampleGroupName}
                  />
                </div>

                <div>
                  <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>
                    {t.homeControl.selectDevices}
                  </label>
                  <div className="space-y-4 max-h-64 overflow-y-auto">
                    {/* Somfy devices */}
                    {Object.entries(devicesByAccount).map(([accountId, accountDevices]) => (
                      <div key={accountId}>
                        <p className="text-xs font-medium mb-2 px-2" style={{ color: 'var(--color-sky)' }}>
                          {getAccountName(accountId)}
                        </p>
                        <div className="space-y-1">
                          {accountDevices.map(device => (
                            <label
                              key={device.id}
                              className="flex items-center gap-3 p-2 rounded-lg cursor-pointer"
                              style={{
                                background: selectedDeviceIds.includes(device.id)
                                  ? 'rgba(126, 182, 196, 0.1)'
                                  : 'transparent'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedDeviceIds.includes(device.id)}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedDeviceIds([...selectedDeviceIds, device.id])
                                  } else {
                                    setSelectedDeviceIds(selectedDeviceIds.filter(id => id !== device.id))
                                  }
                                }}
                                className="rounded w-5 h-5"
                              />
                              <div className="min-w-0 flex-1">
                                <span className="text-sm block truncate" style={{ color: 'var(--foreground)' }}>
                                  {device.custom_name || device.label}
                                </span>
                                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                                  {getDeviceTypeLabel(device.ui_class, t.homeControl.deviceTypes)}
                                </span>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* Toshiba AC devices */}
                    {toshibaDevices.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-2 px-2" style={{ color: 'var(--color-coral)' }}>
                          Toshiba AC
                        </p>
                        <div className="space-y-1">
                          {toshibaDevices.map(device => (
                            <label
                              key={device.id}
                              className="flex items-center gap-3 p-2 rounded-lg cursor-pointer"
                              style={{
                                background: selectedToshibaDeviceIds.includes(device.id)
                                  ? 'rgba(232, 120, 109, 0.1)'
                                  : 'transparent'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedToshibaDeviceIds.includes(device.id)}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedToshibaDeviceIds([...selectedToshibaDeviceIds, device.id])
                                  } else {
                                    setSelectedToshibaDeviceIds(selectedToshibaDeviceIds.filter(id => id !== device.id))
                                  }
                                }}
                                className="rounded w-5 h-5"
                              />
                              <div className="min-w-0 flex-1">
                                <span className="text-sm block truncate" style={{ color: 'var(--foreground)' }}>
                                  {device.custom_name || device.name}
                                </span>
                                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                                  {t.homeControl?.acUnit || 'AC Unit'}
                                </span>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* MelCloud AC devices */}
                    {melcloudDevices.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-2 px-2" style={{ color: 'var(--color-sage)' }}>
                          Mitsubishi AC
                        </p>
                        <div className="space-y-1">
                          {melcloudDevices.map(device => (
                            <label
                              key={device.id}
                              className="flex items-center gap-3 p-2 rounded-lg cursor-pointer"
                              style={{
                                background: selectedMelCloudDeviceIds.includes(device.id)
                                  ? 'rgba(158, 185, 154, 0.1)'
                                  : 'transparent'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedMelCloudDeviceIds.includes(device.id)}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedMelCloudDeviceIds([...selectedMelCloudDeviceIds, device.id])
                                  } else {
                                    setSelectedMelCloudDeviceIds(selectedMelCloudDeviceIds.filter(id => id !== device.id))
                                  }
                                }}
                                className="rounded w-5 h-5"
                              />
                              <div className="min-w-0 flex-1">
                                <span className="text-sm block truncate" style={{ color: 'var(--foreground)' }}>
                                  {device.custom_name || device.name}
                                </span>
                                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                                  {t.homeControl?.acUnit || 'AC Unit'}
                                </span>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={saveGroup}
                    disabled={savingGroup || !groupName.trim() || (selectedDeviceIds.length === 0 && selectedToshibaDeviceIds.length === 0 && selectedMelCloudDeviceIds.length === 0)}
                    className="btn btn-primary"
                  >
                    {savingGroup ? t.homeControl.saving : editingGroup ? t.homeControl.update : t.homeControl.create}
                  </button>
                  <button
                    onClick={() => {
                      setShowGroupForm(false)
                      setEditingGroup(null)
                      setGroupName('')
                      setSelectedDeviceIds([])
                      setSelectedToshibaDeviceIds([])
                      setSelectedMelCloudDeviceIds([])
                    }}
                    className="btn btn-secondary"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            </div>
          )}

          {groups.length === 0 && !showGroupForm && (
            <button
              onClick={() => {
                setShowGroupForm(true)
                setEditingGroup(null)
                setGroupName('')
                setSelectedDeviceIds([])
              }}
              className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: 'var(--background)', border: '1px dashed var(--border)', color: 'var(--muted)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
              </svg>
              {t.homeControl.createDeviceGroup}
            </button>
          )}
        </div>
      )}

      {accounts.length === 0 && !showAddForm && (
        <p className="text-sm text-center" style={{ color: 'var(--muted)' }}>
          {t.homeControl.connectSmartHome || 'Connect your Somfy or Toshiba AC account to control your devices'}
        </p>
      )}
    </div>
  )
}
