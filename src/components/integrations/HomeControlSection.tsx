'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type { OverkizServer } from '@/lib/integrations/somfy'

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

interface HomeControlSectionProps {
  householdId: string
  onMessage: (type: 'success' | 'error', text: string) => void
}

const SERVER_OPTIONS: { value: OverkizServer; label: string }[] = [
  { value: 'somfy_europe', label: 'Europa' },
  { value: 'somfy_america', label: 'Nord-Amerika' },
  { value: 'somfy_oceania', label: 'Oseania' },
]

const UI_CLASS_LABELS: Record<string, string> = {
  ExteriorScreen: 'Utvendig screen',
  Screen: 'Screen',
  RollerShutter: 'Rullegardin',
  Awning: 'Markise',
  Pergola: 'Pergola',
  GarageDoor: 'Garasjeport',
  Gate: 'Port',
  Window: 'Vindu',
  VenetianBlind: 'Persienne',
  ExteriorVenetianBlind: 'Utvendig persienne',
  Blind: 'Rullegardin',
  Curtain: 'Gardin',
}

export function HomeControlSection({ householdId, onMessage }: HomeControlSectionProps) {
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

  // Control state
  const [controllingDevice, setControllingDevice] = useState<string | null>(null)
  const [controllingGroup, setControllingGroup] = useState<string | null>(null)
  const [syncingAccount, setSyncingAccount] = useState<string | null>(null)
  const [sliderDevice, setSliderDevice] = useState<string | null>(null)
  const [sliderPosition, setSliderPosition] = useState(50)

  const supabase = useMemo(() => createClient(), [])

  const loadAccounts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .rpc('get_household_home_control_accounts')

      if (error) throw error
      setAccounts(data || [])

      // Load devices for all accounts
      if (data && data.length > 0) {
        const { data: deviceData } = await supabase
          .from('home_control_devices')
          .select('*')
          .in('account_id', data.map((a: HomeControlAccount) => a.id))
          .eq('is_hidden', false)
          .order('favorite', { ascending: false })
          .order('label')

        setDevices(deviceData || [])
      }

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

      if (data.success) {
        setTestResult({ success: true, deviceCount: data.deviceCount })
      } else {
        setTestResult({ success: false, error: data.error })
      }
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : 'Tilkobling feilet',
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

      // Sync devices
      await fetch(`/api/home-control/somfy/devices?accountId=${data}`, {
        method: 'POST',
      })

      onMessage('success', 'Somfy-konto lagt til')
      setShowAddForm(false)
      setEmail('')
      setPassword('')
      setTestResult(null)
      await loadAccounts()
    } catch (err) {
      console.error('Failed to save account:', err)
      onMessage('error', 'Kunne ikke lagre konto')
    } finally {
      setSaving(false)
    }
  }

  const deleteAccount = async (accountId: string) => {
    if (!confirm('Er du sikker på at du vil fjerne denne kontoen?')) return

    try {
      const { error } = await supabase.rpc('delete_home_control_account', {
        p_account_id: accountId,
      })

      if (error) throw error

      setAccounts(accounts.filter(a => a.id !== accountId))
      setDevices(devices.filter(d => d.account_id !== accountId))
      onMessage('success', 'Konto fjernet')
    } catch (err) {
      console.error('Failed to delete account:', err)
      onMessage('error', 'Kunne ikke fjerne konto')
    }
  }

  const syncDevices = async (accountId: string) => {
    setSyncingAccount(accountId)
    try {
      const response = await fetch(`/api/home-control/somfy/devices?accountId=${accountId}`, {
        method: 'POST',
      })

      const data = await response.json()

      if (data.success) {
        setDevices(prev => {
          const filtered = prev.filter(d => d.account_id !== accountId)
          return [...filtered, ...data.devices]
        })
        onMessage('success', `Synkroniserte ${data.devices.length} enheter`)
      } else {
        onMessage('error', data.error || 'Synkronisering feilet')
      }
    } catch (err) {
      console.error('Sync failed:', err)
      onMessage('error', 'Synkronisering feilet')
    } finally {
      setSyncingAccount(null)
    }
  }

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
        onMessage('error', data.error || 'Kommando feilet')
      }
    } catch (err) {
      console.error('Control failed:', err)
      onMessage('error', 'Kommando feilet')
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
        // Update local state
        setDevices(prev =>
          prev.map(d =>
            d.device_url === deviceUrl ? { ...d, position } : d
          )
        )
        setSliderDevice(null)
      } else {
        onMessage('error', data.error || 'Kommando feilet')
      }
    } catch (err) {
      console.error('Position control failed:', err)
      onMessage('error', 'Kommando feilet')
    } finally {
      setControllingDevice(null)
    }
  }

  const controlGroup = async (
    groupId: string,
    command: 'open' | 'close' | 'stop'
  ) => {
    const group = groups.find(g => g.id === groupId)
    if (!group || group.device_ids.length === 0) return

    setControllingGroup(groupId)

    // Get devices for this group
    const groupDevices = devices.filter(d => group.device_ids.includes(d.id))

    // Group devices by account
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
      // Execute for each account
      await Promise.all(
        Object.entries(devicesByAccount).map(async ([accountId, devs]) => {
          const response = await fetch('/api/home-control/somfy/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId, devices: devs }),
          })

          const data = await response.json()
          if (!data.success) {
            throw new Error(data.error || 'Kommando feilet')
          }
        })
      )
    } catch (err) {
      console.error('Group control failed:', err)
      onMessage('error', 'Kommando feilet')
    } finally {
      setControllingGroup(null)
    }
  }

  const saveGroup = async () => {
    if (!groupName.trim() || selectedDeviceIds.length === 0) return

    setSavingGroup(true)
    try {
      if (editingGroup) {
        // Update existing group
        await supabase
          .from('home_control_groups')
          .update({ name: groupName.trim() })
          .eq('id', editingGroup.id)

        // Update memberships
        await supabase
          .from('home_control_group_devices')
          .delete()
          .eq('group_id', editingGroup.id)

        await supabase
          .from('home_control_group_devices')
          .insert(selectedDeviceIds.map(deviceId => ({
            group_id: editingGroup.id,
            device_id: deviceId,
          })))

        onMessage('success', 'Gruppe oppdatert')
      } else {
        // Create new group
        const { data: newGroup, error } = await supabase
          .from('home_control_groups')
          .insert({
            household_id: householdId,
            name: groupName.trim(),
          })
          .select('id')
          .single()

        if (error) throw error

        // Add device memberships
        await supabase
          .from('home_control_group_devices')
          .insert(selectedDeviceIds.map(deviceId => ({
            group_id: newGroup.id,
            device_id: deviceId,
          })))

        onMessage('success', 'Gruppe opprettet')
      }

      setShowGroupForm(false)
      setEditingGroup(null)
      setGroupName('')
      setSelectedDeviceIds([])
      await loadAccounts()
    } catch (err) {
      console.error('Failed to save group:', err)
      onMessage('error', 'Kunne ikke lagre gruppe')
    } finally {
      setSavingGroup(false)
    }
  }

  const deleteGroup = async (groupId: string) => {
    if (!confirm('Er du sikker på at du vil slette denne gruppen?')) return

    try {
      await supabase
        .from('home_control_groups')
        .delete()
        .eq('id', groupId)

      setGroups(groups.filter(g => g.id !== groupId))
      onMessage('success', 'Gruppe slettet')
    } catch (err) {
      console.error('Failed to delete group:', err)
      onMessage('error', 'Kunne ikke slette gruppe')
    }
  }

  const openEditGroup = (group: HomeControlGroup) => {
    setEditingGroup(group)
    setGroupName(group.name)
    setSelectedDeviceIds(group.device_ids)
    setShowGroupForm(true)
  }

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
      {/* Device Groups */}
      {groups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
              Grupper
            </h4>
            {devices.length > 0 && (
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
                + Ny gruppe
              </button>
            )}
          </div>
          {groups.map(group => (
            <div
              key={group.id}
              className="rounded-xl p-3"
              style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: 'rgba(213, 186, 124, 0.2)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-honey)" strokeWidth="2">
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
                      {group.device_ids.length} enheter
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEditGroup(group)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="Rediger gruppe"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteGroup(group.id)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="Slett gruppe"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => controlGroup(group.id, 'open')}
                  disabled={controllingGroup === group.id}
                  className="flex-1 btn btn-secondary text-xs py-1.5"
                >
                  {controllingGroup === group.id ? '...' : 'Alle opp'}
                </button>
                <button
                  onClick={() => controlGroup(group.id, 'stop')}
                  disabled={controllingGroup === group.id}
                  className="flex-1 btn btn-secondary text-xs py-1.5"
                >
                  {controllingGroup === group.id ? '...' : 'Stopp alle'}
                </button>
                <button
                  onClick={() => controlGroup(group.id, 'close')}
                  disabled={controllingGroup === group.id}
                  className="flex-1 btn btn-secondary text-xs py-1.5"
                >
                  {controllingGroup === group.id ? '...' : 'Alle ned'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Group form */}
      {showGroupForm && (
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <h4 className="font-medium mb-4" style={{ color: 'var(--foreground)' }}>
            {editingGroup ? 'Rediger gruppe' : 'Ny gruppe'}
          </h4>

          <div className="space-y-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                Gruppenavn
              </label>
              <input
                type="text"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                className="input"
                placeholder="f.eks. Stue"
              />
            </div>

            <div>
              <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>
                Velg enheter
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {devices.map(device => (
                  <label
                    key={device.id}
                    className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                    style={{ background: selectedDeviceIds.includes(device.id) ? 'rgba(126, 182, 196, 0.1)' : 'transparent' }}
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
                      className="rounded"
                    />
                    <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                      {device.custom_name || device.label}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      ({UI_CLASS_LABELS[device.ui_class] || device.ui_class})
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={saveGroup}
                disabled={savingGroup || !groupName.trim() || selectedDeviceIds.length === 0}
                className="btn btn-primary"
              >
                {savingGroup ? 'Lagrer...' : editingGroup ? 'Oppdater' : 'Opprett'}
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

      {/* Add group button (when no groups exist but devices exist) */}
      {groups.length === 0 && devices.length > 0 && !showGroupForm && (
        <button
          onClick={() => {
            setShowGroupForm(true)
            setEditingGroup(null)
            setGroupName('')
            setSelectedDeviceIds([])
          }}
          className="w-full py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          style={{
            background: 'var(--background)',
            border: '1px dashed var(--border)',
            color: 'var(--muted)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
          </svg>
          Opprett enhetsgruppe
        </button>
      )}

      {/* Existing accounts */}
      {accounts.map(account => (
        <div
          key={account.id}
          className="rounded-xl p-4"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(126, 182, 196, 0.2)' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="9" y1="3" x2="9" y2="21"/>
                </svg>
              </div>
              <div>
                <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                  {account.account_email || account.display_name}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {SERVER_OPTIONS.find(s => s.value === account.server)?.label || account.server}
                  {account.last_sync_at && (
                    <> • Sist synkronisert {new Date(account.last_sync_at).toLocaleDateString('nb-NO')}</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => syncDevices(account.id)}
                disabled={syncingAccount === account.id}
                className="btn btn-secondary text-sm"
              >
                {syncingAccount === account.id ? 'Synker...' : 'Synk'}
              </button>
              <button
                onClick={() => deleteAccount(account.id)}
                disabled={syncingAccount === account.id}
                className="text-sm px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--color-coral)' }}
              >
                Fjern
              </button>
            </div>
          </div>

          {/* Devices for this account */}
          {devices.filter(d => d.account_id === account.id).length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              {devices
                .filter(d => d.account_id === account.id)
                .map(device => (
                  <div
                    key={device.id}
                    className="rounded-lg p-3"
                    style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
                          {device.custom_name || device.label}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>
                          {UI_CLASS_LABELS[device.ui_class] || device.ui_class}
                          {device.position !== null && ` • ${device.position}%`}
                        </p>
                      </div>
                      {!device.available && (
                        <span
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ background: 'rgba(232, 120, 109, 0.15)', color: 'var(--color-coral)' }}
                        >
                          Ikke tilgjengelig
                        </span>
                      )}
                    </div>

                    {device.available && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => controlDevice(account.id, device.device_url, 'open')}
                            disabled={controllingDevice === device.device_url}
                            className="flex-1 btn btn-secondary text-xs py-1.5"
                          >
                            Opp
                          </button>
                          <button
                            onClick={() => controlDevice(account.id, device.device_url, 'stop')}
                            disabled={controllingDevice === device.device_url}
                            className="flex-1 btn btn-secondary text-xs py-1.5"
                          >
                            Stopp
                          </button>
                          <button
                            onClick={() => controlDevice(account.id, device.device_url, 'close')}
                            disabled={controllingDevice === device.device_url}
                            className="flex-1 btn btn-secondary text-xs py-1.5"
                          >
                            Ned
                          </button>
                          <button
                            onClick={() => controlDevice(account.id, device.device_url, 'my')}
                            disabled={controllingDevice === device.device_url}
                            className="btn btn-secondary text-xs py-1.5"
                            title="Favorittposisjon"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setSliderDevice(device.device_url)
                              setSliderPosition(device.position ?? 50)
                            }}
                            disabled={controllingDevice === device.device_url}
                            className="btn btn-secondary text-xs py-1.5"
                            title="Velg posisjon"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="4" y1="21" x2="4" y2="14"/>
                              <line x1="4" y1="10" x2="4" y2="3"/>
                              <line x1="12" y1="21" x2="12" y2="12"/>
                              <line x1="12" y1="8" x2="12" y2="3"/>
                              <line x1="20" y1="21" x2="20" y2="16"/>
                              <line x1="20" y1="12" x2="20" y2="3"/>
                              <line x1="1" y1="14" x2="7" y2="14"/>
                              <line x1="9" y1="8" x2="15" y2="8"/>
                              <line x1="17" y1="16" x2="23" y2="16"/>
                            </svg>
                          </button>
                        </div>

                        {/* Position slider */}
                        {sliderDevice === device.device_url && (
                          <div
                            className="p-2 rounded-lg"
                            style={{ background: 'var(--background)' }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>0%</span>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={sliderPosition}
                                onChange={e => setSliderPosition(Number(e.target.value))}
                                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
                                style={{ background: 'var(--border)' }}
                              />
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>100%</span>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                                {sliderPosition}%
                              </span>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setSliderDevice(null)}
                                  className="btn btn-secondary text-xs py-1 px-2"
                                >
                                  Avbryt
                                </button>
                                <button
                                  onClick={() => setDevicePosition(account.id, device.device_url, sliderPosition)}
                                  disabled={controllingDevice === device.device_url}
                                  className="btn btn-primary text-xs py-1 px-2"
                                >
                                  {controllingDevice === device.device_url ? 'Setter...' : 'Sett'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>
              Ingen enheter funnet. Klikk «Synk» for å hente enheter.
            </p>
          )}
        </div>
      ))}

      {/* Add new account form */}
      {showAddForm ? (
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <h4 className="font-medium mb-4" style={{ color: 'var(--foreground)' }}>
            Legg til Somfy-konto
          </h4>

          <div className="space-y-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                E-post
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input"
                placeholder="din@epost.no"
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                Passord
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                Region
              </label>
              <select
                value={server}
                onChange={e => setServer(e.target.value as OverkizServer)}
                className="input"
              >
                {SERVER_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {testResult && (
              <div
                className="p-3 rounded-lg text-sm"
                style={{
                  background: testResult.success
                    ? 'rgba(158, 185, 154, 0.15)'
                    : 'rgba(232, 120, 109, 0.15)',
                  color: testResult.success ? 'var(--color-sage)' : 'var(--color-coral)',
                }}
              >
                {testResult.success
                  ? `Tilkobling OK! Fant ${testResult.deviceCount} enheter.`
                  : testResult.error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={testConnection}
                disabled={testing || !email || !password}
                className="btn btn-secondary"
              >
                {testing ? 'Tester...' : 'Test tilkobling'}
              </button>

              {testResult?.success && (
                <button
                  onClick={saveAccount}
                  disabled={saving}
                  className="btn btn-primary"
                >
                  {saving ? 'Lagrer...' : 'Lagre konto'}
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
          className="w-full py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          style={{
            background: 'var(--background)',
            border: '1px dashed var(--border)',
            color: 'var(--muted)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Legg til Somfy-konto
        </button>
      )}

      {accounts.length === 0 && !showAddForm && (
        <p className="text-sm text-center" style={{ color: 'var(--muted)' }}>
          Koble til din Somfy TaHoma eller Connexoon for å styre screens og persienner.
        </p>
      )}
    </div>
  )
}
