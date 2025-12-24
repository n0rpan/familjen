'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type { OverkizServer } from '@/lib/integrations/somfy'
import { SOMFY_UI } from '@/lib/integrations/somfy/constants'

interface HomeControlAccount {
  id: string
  service: string
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
  const [groups, setGroups] = useState<HomeControlGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [editingGroup, setEditingGroup] = useState<HomeControlGroup | null>(null)

  // Form state
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
  const [savingGroup, setSavingGroup] = useState(false)

  // Edit device state
  const [editingDevice, setEditingDevice] = useState<string | null>(null)
  const [editDeviceName, setEditDeviceName] = useState('')
  const [editDeviceType, setEditDeviceType] = useState('')
  const [savingDevice, setSavingDevice] = useState(false)
  const [syncingAccount, setSyncingAccount] = useState<string | null>(null)
  const [togglingHidden, setTogglingHidden] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  const loadAccounts = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_household_home_control_accounts')
      if (error) throw error
      setAccounts(data || [])

      if (data && data.length > 0) {
        const { data: deviceData } = await supabase
          .from('home_control_devices')
          .select('*')
          .in('account_id', data.map((a: HomeControlAccount) => a.id))
          .order('favorite', { ascending: false })
          .order('label')
        setDevices(deviceData || [])
      }

      const { data: groupData } = await supabase
        .from('home_control_groups')
        .select(`
          id, household_id, name, icon, sort_order,
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
      const response = await fetch('/api/home-control/somfy/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, server }),
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
      const { data, error } = await supabase.rpc('upsert_home_control_account', {
        p_household_id: householdId,
        p_service: 'somfy',
        p_display_name: email,
        p_credentials: { email, password },
        p_account_email: email,
        p_server: server,
      })
      if (error) throw error

      await fetch(`/api/home-control/somfy/devices?accountId=${data}`, { method: 'POST' })
      onMessage('success', t.homeControl.syncSuccess)
      setShowAddForm(false)
      setEmail('')
      setPassword('')
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

  const syncDevices = async (accountId: string) => {
    setSyncingAccount(accountId)
    try {
      const response = await fetch(`/api/home-control/somfy/devices?accountId=${accountId}`, { method: 'POST' })
      const data = await response.json()

      if (data.success) {
        setDevices(prev => {
          const filtered = prev.filter(d => d.account_id !== accountId)
          return [...filtered, ...data.devices]
        })
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
    if (!groupName.trim() || selectedDeviceIds.length === 0) return
    setSavingGroup(true)

    try {
      if (editingGroup) {
        await supabase.from('home_control_groups').update({ name: groupName.trim() }).eq('id', editingGroup.id)
        await supabase.from('home_control_group_devices').delete().eq('group_id', editingGroup.id)
        await supabase.from('home_control_group_devices').insert(
          selectedDeviceIds.map(deviceId => ({ group_id: editingGroup.id, device_id: deviceId }))
        )
        onMessage('success', t.homeControl.groupUpdated)
      } else {
        const { data: newGroup, error } = await supabase
          .from('home_control_groups')
          .insert({ household_id: householdId, name: groupName.trim() })
          .select('id')
          .single()
        if (error) throw error

        await supabase.from('home_control_group_devices').insert(
          selectedDeviceIds.map(deviceId => ({ group_id: newGroup.id, device_id: deviceId }))
        )
        onMessage('success', t.homeControl.groupCreated)
      }

      setShowGroupForm(false)
      setEditingGroup(null)
      setGroupName('')
      setSelectedDeviceIds([])
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
    setShowGroupForm(true)
  }

  const startEditingDevice = (device: HomeControlDevice) => {
    setEditingDevice(device.id)
    setEditDeviceName(device.custom_name || device.label)
    setEditDeviceType(device.ui_class)
  }

  // Get account by id for display
  const getAccountEmail = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId)
    return account?.account_email || account?.display_name || ''
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(126, 182, 196, 0.2)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <line x1="9" y1="3" x2="9" y2="21"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate" style={{ color: 'var(--foreground)' }}>
                    {account.account_email || account.display_name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {t.homeControl[SERVER_OPTION_KEYS.find(s => s.value === account.server)?.labelKey || 'regionEurope']}
                    {account.last_sync_at && (
                      <> &bull; {t.homeControl.lastSynced} {new Date(account.last_sync_at).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => syncDevices(account.id)}
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
          </div>
        ))}

        {/* Add account form */}
        {showAddForm ? (
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
          >
            <h4 className="font-medium mb-4" style={{ color: 'var(--foreground)' }}>
              {t.homeControl.addSomfyAccount}
            </h4>
            <div className="space-y-4">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                  {t.homeControl.accountEmail}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input"
                  placeholder={t.homeControl.emailPlaceholder}
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
            {t.homeControl.addSomfyAccount}
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
                        {getAccountEmail(device.account_id)}
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
      {devices.length > 0 && (
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
                      {t.homeControl.deviceCount.replace('{count}', String(group.device_ids.length))}
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
                    {Object.entries(devicesByAccount).map(([accountId, accountDevices]) => (
                      <div key={accountId}>
                        <p className="text-xs font-medium mb-2 px-2" style={{ color: 'var(--color-sky)' }}>
                          {getAccountEmail(accountId)}
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
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={saveGroup}
                    disabled={savingGroup || !groupName.trim() || selectedDeviceIds.length === 0}
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
          {t.homeControl.connectSomfy}
        </p>
      )}
    </div>
  )
}
