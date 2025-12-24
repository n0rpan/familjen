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
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)

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

  // Control state
  const [controllingDevice, setControllingDevice] = useState<string | null>(null)
  const [syncingAccount, setSyncingAccount] = useState<string | null>(null)

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
