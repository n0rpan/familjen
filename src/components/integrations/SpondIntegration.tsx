'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Child } from '@/lib/types'

interface SpondSubGroup {
  id: string
  name: string
}

interface SpondGroup {
  id: string
  name: string
  description: string | null
  memberCount: number
  subGroups: SpondSubGroup[]
}

interface Integration {
  id: string
  displayName: string
  accountEmail: string | null
  lastSyncAt: string | null
  lastSyncStatus: string
}

interface ChildMapping {
  childId: string
  groupId: string
  groupName: string
}

interface Props {
  householdId: string
  children: Child[]
  onMessage: (type: 'success' | 'error', text: string) => void
}

export function SpondIntegration({ householdId, children, onMessage }: Props) {
  const supabase = useMemo(() => createClient(), [])

  // State
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Connection form state
  const [showConnectForm, setShowConnectForm] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [testingConnection, setTestingConnection] = useState(false)
  const [availableGroups, setAvailableGroups] = useState<SpondGroup[]>([])
  const [selectedGroups, setSelectedGroups] = useState<Map<string, string>>(new Map()) // childId -> groupId
  const [connectionTested, setConnectionTested] = useState(false)

  // Child mappings
  const [childMappings, setChildMappings] = useState<Map<string, ChildMapping[]>>(new Map())

  useEffect(() => {
    loadIntegrations()
  }, [householdId])

  const loadIntegrations = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/integrations/spond/sync')
      if (res.ok) {
        const data = await res.json()
        setIntegrations(data.integrations || [])

        // Load child mappings for each integration
        if (data.integrations?.length > 0) {
          const { data: mappings } = await supabase
            .from('external_integration_children')
            .select('integration_id, child_id, external_group_id, external_group_name')
            .in(
              'integration_id',
              data.integrations.map((i: Integration) => i.id)
            )

          const mappingsByIntegration = new Map<string, ChildMapping[]>()
          mappings?.forEach((m) => {
            const existing = mappingsByIntegration.get(m.integration_id) || []
            existing.push({
              childId: m.child_id,
              groupId: m.external_group_id,
              groupName: m.external_group_name,
            })
            mappingsByIntegration.set(m.integration_id, existing)
          })
          setChildMappings(mappingsByIntegration)
        }
      }
    } catch (error) {
      console.error('Error loading integrations:', error)
    }
    setLoading(false)
  }

  const testConnection = async () => {
    if (!email || !password) {
      onMessage('error', 'Fyll inn e-post og passord')
      return
    }

    setTestingConnection(true)
    try {
      const res = await fetch('/api/integrations/spond/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        onMessage('error', data.error || 'Kunne ikke koble til Spond')
        return
      }

      setAvailableGroups(data.groups || [])
      setConnectionTested(true)
      onMessage('success', `Koblet til Spond som ${data.email}`)
    } catch (error) {
      console.error('Test connection error:', error)
      onMessage('error', 'Nettverksfeil - prøv igjen')
    }
    setTestingConnection(false)
  }

  const saveIntegration = async () => {
    if (!connectionTested || selectedGroups.size === 0) {
      onMessage('error', 'Velg minst ett barn og gruppe')
      return
    }

    setConnecting(true)
    try {
      // Save integration credentials
      const { data: integrationId, error: saveError } = await supabase.rpc(
        'upsert_external_integration',
        {
          p_household_id: householdId,
          p_service: 'spond',
          p_display_name: 'Spond',
          p_credentials: { email, password },
          p_account_email: email,
        }
      )

      if (saveError) {
        console.error('Save integration error:', saveError)
        onMessage('error', 'Kunne ikke lagre integrasjon')
        return
      }

      // Save child mappings
      const mappingsToInsert = Array.from(selectedGroups.entries()).map(
        ([childId, groupId]) => {
          // Find group name - could be parent group or subgroup
          let groupName = ''
          for (const group of availableGroups) {
            if (group.id === groupId) {
              groupName = group.name
              break
            }
            const subGroup = group.subGroups?.find((sg) => sg.id === groupId)
            if (subGroup) {
              groupName = `${group.name} > ${subGroup.name}`
              break
            }
          }
          return {
            integration_id: integrationId,
            child_id: childId,
            external_group_id: groupId,
            external_group_name: groupName,
          }
        }
      )

      // Delete existing mappings first
      await supabase
        .from('external_integration_children')
        .delete()
        .eq('integration_id', integrationId)

      // Insert new mappings
      const { error: mappingError } = await supabase
        .from('external_integration_children')
        .insert(mappingsToInsert)

      if (mappingError) {
        console.error('Save mappings error:', mappingError)
        onMessage('error', 'Kunne ikke lagre gruppetilknytninger')
        return
      }

      // Reset form and reload
      setShowConnectForm(false)
      setEmail('')
      setPassword('')
      setAvailableGroups([])
      setSelectedGroups(new Map())
      setConnectionTested(false)
      await loadIntegrations()

      onMessage('success', 'Spond-integrasjon lagret')

      // Trigger initial sync
      syncNow(integrationId)
    } catch (error) {
      console.error('Save integration error:', error)
      onMessage('error', 'Kunne ikke lagre integrasjon')
    }
    setConnecting(false)
  }

  const syncNow = async (integrationId?: string) => {
    setSyncing(true)
    try {
      const res = await fetch('/api/integrations/spond/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId }),
      })

      const data = await res.json()

      if (!res.ok) {
        onMessage('error', data.error || 'Synkronisering feilet')
      } else {
        const { summary } = data
        onMessage(
          'success',
          `Synkronisert: ${summary.eventsTotal} hendelser, ${summary.messagesTotal} meldinger`
        )
        await loadIntegrations()
      }
    } catch (error) {
      console.error('Sync error:', error)
      onMessage('error', 'Synkronisering feilet')
    }
    setSyncing(false)
  }

  const disconnectIntegration = async (integrationId: string) => {
    if (!confirm('Er du sikker på at du vil koble fra Spond?')) return

    try {
      const { error } = await supabase
        .from('external_integrations')
        .delete()
        .eq('id', integrationId)

      if (error) {
        onMessage('error', 'Kunne ikke fjerne integrasjon')
      } else {
        onMessage('success', 'Spond frakoblet')
        await loadIntegrations()
      }
    } catch (error) {
      console.error('Disconnect error:', error)
      onMessage('error', 'Kunne ikke fjerne integrasjon')
    }
  }

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return 'Aldri synkronisert'
    const date = new Date(timestamp)
    return `Sist synkronisert: ${date.toLocaleDateString('nb-NO')} kl ${date.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}`
  }

  if (loading) {
    return (
      <div className="animate-pulse rounded-xl p-4" style={{ background: 'var(--sand)' }}>
        <div className="h-6 w-32 rounded" style={{ background: 'var(--border)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Existing integrations */}
      {integrations.map((integration) => (
        <div
          key={integration.id}
          className="rounded-xl p-4"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(126, 182, 196, 0.2)' }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-sky)"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <div>
                <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                  Spond
                </div>
                <div className="text-sm" style={{ color: 'var(--muted)' }}>
                  {integration.accountEmail || 'Tilkoblet'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-1 rounded-full text-xs ${
                  integration.lastSyncStatus === 'ok'
                    ? 'bg-green-100 text-green-700'
                    : integration.lastSyncStatus === 'auth_failed'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                }`}
              >
                {integration.lastSyncStatus === 'ok'
                  ? 'OK'
                  : integration.lastSyncStatus === 'auth_failed'
                    ? 'Autentisering feilet'
                    : 'Venter'}
              </span>
            </div>
          </div>

          {/* Child mappings */}
          {childMappings.get(integration.id)?.length ? (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>
                Barn og grupper:
              </div>
              <div className="space-y-1">
                {childMappings.get(integration.id)?.map((mapping) => {
                  const child = children.find((c) => c.id === mapping.childId)
                  return (
                    <div
                      key={`${mapping.childId}-${mapping.groupId}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white"
                        style={{ background: `var(--color-${child?.color || 'sky'})` }}
                      >
                        {child?.name?.charAt(0) || '?'}
                      </span>
                      <span style={{ color: 'var(--foreground)' }}>{child?.name}</span>
                      <span style={{ color: 'var(--muted)' }}>→</span>
                      <span style={{ color: 'var(--muted)' }}>{mapping.groupName}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {/* Last sync info and actions */}
          <div
            className="mt-3 pt-3 flex items-center justify-between"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {formatLastSync(integration.lastSyncAt)}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => syncNow(integration.id)}
                disabled={syncing}
                className="btn btn-secondary text-sm"
              >
                {syncing ? 'Synkroniserer...' : 'Synkroniser'}
              </button>
              <button
                onClick={() => disconnectIntegration(integration.id)}
                className="btn text-sm"
                style={{ color: 'var(--color-coral)' }}
              >
                Koble fra
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Connect new integration */}
      {!showConnectForm && integrations.length === 0 && (
        <button
          onClick={() => setShowConnectForm(true)}
          className="w-full rounded-xl p-4 flex items-center justify-center gap-2 transition-colors"
          style={{
            background: 'var(--background)',
            border: '2px dashed var(--border)',
            color: 'var(--muted)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Koble til Spond
        </button>
      )}

      {/* Connection form */}
      {showConnectForm && (
        <div
          className="rounded-xl p-4 space-y-4"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <h4 className="font-medium" style={{ color: 'var(--foreground)' }}>
              Koble til Spond
            </h4>
            <button
              onClick={() => {
                setShowConnectForm(false)
                setConnectionTested(false)
                setAvailableGroups([])
              }}
              className="text-sm"
              style={{ color: 'var(--muted)' }}
            >
              Avbryt
            </button>
          </div>

          {!connectionTested ? (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    E-post (Spond-konto)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input mt-1"
                    placeholder="din@epost.no"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    Passord
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input mt-1"
                    placeholder="Ditt Spond-passord"
                  />
                </div>
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Passordet lagres kryptert og brukes kun til å hente data fra Spond.
              </p>
              <button
                onClick={testConnection}
                disabled={testingConnection || !email || !password}
                className="btn btn-primary w-full"
              >
                {testingConnection ? 'Tester tilkobling...' : 'Test tilkobling'}
              </button>
            </>
          ) : (
            <>
              <div
                className="p-3 rounded-lg text-sm"
                style={{ background: 'rgba(139, 168, 136, 0.1)', color: 'var(--color-sage)' }}
              >
                Tilkoblet som {email}
              </div>

              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  Koble barn til Spond-grupper
                </label>
                <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
                  Velg hvilken Spond-gruppe som tilhører hvert barn
                </p>

                <div className="space-y-3">
                  {children.map((child) => (
                    <div key={child.id} className="flex items-center gap-3">
                      <span
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm text-white flex-shrink-0"
                        style={{ background: `var(--color-${child.color || 'sky'})` }}
                      >
                        {child.name?.charAt(0) || '?'}
                      </span>
                      <span
                        className="flex-shrink-0 w-24 truncate"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {child.name}
                      </span>
                      <select
                        value={selectedGroups.get(child.id) || ''}
                        onChange={(e) => {
                          const newMap = new Map(selectedGroups)
                          if (e.target.value) {
                            newMap.set(child.id, e.target.value)
                          } else {
                            newMap.delete(child.id)
                          }
                          setSelectedGroups(newMap)
                        }}
                        className="input flex-grow"
                      >
                        <option value="">Velg gruppe...</option>
                        {availableGroups.map((group) => (
                          <optgroup key={group.id} label={group.name}>
                            {/* Parent group as an option */}
                            <option value={group.id}>
                              {group.name} (hovedgruppe)
                            </option>
                            {/* Subgroups */}
                            {group.subGroups?.map((subGroup) => (
                              <option key={subGroup.id} value={subGroup.id}>
                                {subGroup.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={saveIntegration}
                disabled={connecting || selectedGroups.size === 0}
                className="btn btn-primary w-full"
              >
                {connecting ? 'Lagrer...' : 'Lagre og synkroniser'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
