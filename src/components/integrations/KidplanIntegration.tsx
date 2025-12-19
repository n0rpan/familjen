'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Child } from '@/lib/types'

interface KidplanChild {
  id: string
  name: string
  unit: string
  birthdate: string
}

interface Integration {
  id: string
  displayName: string
  accountEmail: string | null
  lastSyncAt: string | null
  lastSyncStatus: string
}

interface ChildMapping {
  id?: string
  childId: string
  kidplanChildId: string
  kidplanChildName: string
}

interface Props {
  householdId: string
  children: Child[]
  onMessage: (type: 'success' | 'error', text: string) => void
}

export function KidplanIntegration({ householdId, children, onMessage }: Props) {
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
  const [connectionTested, setConnectionTested] = useState(false)

  // Kidplan data
  const [kindergartenInfo, setKindergartenInfo] = useState<{ id: number; name: string } | null>(null)
  const [kidplanChildren, setKidplanChildren] = useState<KidplanChild[]>([])

  // Child mapping state: Map<ourChildId, kidplanChildId>
  const [childMappings, setChildMappings] = useState<Map<string, string>>(new Map())

  // Current mappings for display
  const [currentMappings, setCurrentMappings] = useState<ChildMapping[]>([])

  // Edit mode
  const [editingIntegrationId, setEditingIntegrationId] = useState<string | null>(null)
  const [loadingKidplanData, setLoadingKidplanData] = useState(false)

  useEffect(() => {
    loadIntegrations()
  }, [householdId])

  const loadIntegrations = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/integrations/kidplan/sync')
      if (res.ok) {
        const data = await res.json()
        setIntegrations(data.integrations || [])

        // Load mappings for each integration
        if (data.integrations?.length > 0) {
          const { data: mappings } = await supabase
            .from('external_integration_children')
            .select('id, integration_id, child_id, external_group_id, external_group_name')
            .in(
              'integration_id',
              data.integrations.map((i: Integration) => i.id)
            )

          setCurrentMappings(
            (mappings || []).map((m) => ({
              id: m.id,
              childId: m.child_id,
              kidplanChildId: m.external_group_id,
              kidplanChildName: m.external_group_name,
            }))
          )
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
      const res = await fetch('/api/integrations/kidplan/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        onMessage('error', data.error || 'Kunne ikke koble til Kidplan')
        return
      }

      setKindergartenInfo(data.kindergarten)
      setKidplanChildren(data.children || [])
      setConnectionTested(true)
      onMessage('success', `Koblet til ${data.kindergarten.name}`)
    } catch (error) {
      console.error('Test connection error:', error)
      onMessage('error', 'Nettverksfeil - prøv igjen')
    }
    setTestingConnection(false)
  }

  const loadKidplanDataForEdit = async (integrationId: string) => {
    setLoadingKidplanData(true)
    setEditingIntegrationId(integrationId)

    try {
      const res = await fetch(`/api/integrations/kidplan/groups?integrationId=${integrationId}`)
      const data = await res.json()

      if (!res.ok) {
        onMessage('error', data.error || 'Kunne ikke hente barn fra Kidplan')
        setEditingIntegrationId(null)
        return
      }

      setKidplanChildren(data.children || [])

      // Initialize mappings from current data
      const mappings = new Map<string, string>()
      for (const mapping of data.currentMappings || []) {
        if (mapping.child_id && mapping.external_group_id) {
          mappings.set(mapping.child_id, mapping.external_group_id)
        }
      }
      setChildMappings(mappings)
    } catch (error) {
      console.error('Load Kidplan data error:', error)
      onMessage('error', 'Nettverksfeil - prøv igjen')
      setEditingIntegrationId(null)
    }

    setLoadingKidplanData(false)
  }

  const setChildMapping = (ourChildId: string, kidplanChildId: string) => {
    setChildMappings((prev) => {
      const newMap = new Map(prev)
      if (kidplanChildId) {
        newMap.set(ourChildId, kidplanChildId)
      } else {
        newMap.delete(ourChildId)
      }
      return newMap
    })
  }

  const hasAnyMapping = (): boolean => {
    return childMappings.size > 0
  }

  const saveIntegration = async () => {
    if (!connectionTested || !hasAnyMapping()) {
      onMessage('error', 'Koble sammen minst ett barn')
      return
    }

    setConnecting(true)
    try {
      // Save integration credentials
      const { data: integrationId, error: saveError } = await supabase.rpc(
        'upsert_external_integration',
        {
          p_household_id: householdId,
          p_service: 'kidplan',
          p_display_name: kindergartenInfo?.name || 'Kidplan',
          p_credentials: {
            email,
            password,
            kindergartenId: kindergartenInfo?.id,
          },
          p_account_email: email,
        }
      )

      if (saveError) {
        console.error('Save integration error:', saveError)
        onMessage('error', 'Kunne ikke lagre integrasjon')
        return
      }

      await saveMappings(integrationId)

      // Reset form and reload
      resetForm()
      await loadIntegrations()
      onMessage('success', 'Kidplan-integrasjon lagret')

      // Trigger initial sync
      syncNow(integrationId)
    } catch (error) {
      console.error('Save integration error:', error)
      onMessage('error', 'Kunne ikke lagre integrasjon')
    }
    setConnecting(false)
  }

  const saveEditedMappings = async () => {
    if (!editingIntegrationId || !hasAnyMapping()) {
      onMessage('error', 'Koble sammen minst ett barn')
      return
    }

    setConnecting(true)
    try {
      await saveMappings(editingIntegrationId)

      // Reset and reload
      setEditingIntegrationId(null)
      setKidplanChildren([])
      setChildMappings(new Map())
      await loadIntegrations()

      onMessage('success', 'Barnekoblinger oppdatert')

      // Trigger sync
      syncNow(editingIntegrationId)
    } catch (error) {
      console.error('Save mappings error:', error)
      onMessage('error', 'Kunne ikke lagre barnekoblinger')
    }
    setConnecting(false)
  }

  const saveMappings = async (integrationId: string) => {
    // Build mappings to insert
    const mappingsToInsert: Array<{
      integration_id: string
      child_id: string
      member_id: null
      external_group_id: string
      external_group_name: string
    }> = []

    for (const [ourChildId, kidplanChildId] of childMappings.entries()) {
      const kidplanChild = kidplanChildren.find((c) => c.id === kidplanChildId)
      if (kidplanChild) {
        mappingsToInsert.push({
          integration_id: integrationId,
          child_id: ourChildId,
          member_id: null,
          external_group_id: kidplanChildId,
          external_group_name: kidplanChild.name,
        })
      }
    }

    // Delete existing mappings first
    await supabase
      .from('external_integration_children')
      .delete()
      .eq('integration_id', integrationId)

    // Insert new mappings
    if (mappingsToInsert.length > 0) {
      const { error: mappingError } = await supabase
        .from('external_integration_children')
        .insert(mappingsToInsert)

      if (mappingError) {
        console.error('Save mappings error:', mappingError)
        throw new Error('Could not save mappings')
      }
    }
  }

  const resetForm = () => {
    setShowConnectForm(false)
    setEmail('')
    setPassword('')
    setKindergartenInfo(null)
    setKidplanChildren([])
    setChildMappings(new Map())
    setConnectionTested(false)
    setEditingIntegrationId(null)
  }

  const syncNow = async (integrationId?: string) => {
    setSyncing(true)
    try {
      const res = await fetch('/api/integrations/kidplan/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId }),
      })

      const data = await res.json()

      if (!res.ok) {
        onMessage('error', data.error || 'Synkronisering feilet')
      } else {
        // Run AI extraction on new messages
        await fetch('/api/integrations/extract-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integrationId }),
        })

        const { summary } = data
        const message = `Synkronisert: ${summary.messagesTotal} meldinger, ${summary.photosTotal} bilder`
        onMessage('success', message)
        await loadIntegrations()
      }
    } catch (error) {
      console.error('Sync error:', error)
      onMessage('error', 'Synkronisering feilet')
    }
    setSyncing(false)
  }

  const disconnectIntegration = async (integrationId: string) => {
    if (!confirm('Er du sikker på at du vil koble fra Kidplan?')) return

    try {
      const { error } = await supabase
        .from('external_integrations')
        .delete()
        .eq('id', integrationId)

      if (error) {
        onMessage('error', 'Kunne ikke fjerne integrasjon')
      } else {
        onMessage('success', 'Kidplan frakoblet')
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

  // Child mapping selector component
  const ChildMappingRow = ({ child }: { child: Child }) => {
    const selectedKidplanId = childMappings.get(child.id) || ''

    return (
      <div
        className="flex items-center gap-3 p-3 rounded-lg"
        style={{ background: 'var(--sand)' }}
      >
        {/* Our child */}
        <div className="flex items-center gap-2 flex-1">
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm text-white flex-shrink-0"
            style={{ background: `var(--color-${child.color || 'sky'})` }}
          >
            {child.name?.charAt(0) || '?'}
          </span>
          <span className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
            {child.name}
          </span>
        </div>

        {/* Arrow */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ color: 'var(--muted)' }}
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>

        {/* Kidplan child selector */}
        <select
          value={selectedKidplanId}
          onChange={(e) => setChildMapping(child.id, e.target.value)}
          className="input flex-1"
          style={{ maxWidth: '200px' }}
        >
          <option value="">Ikke koblet</option>
          {kidplanChildren.map((kc) => (
            <option key={kc.id} value={kc.id}>
              {kc.name} ({kc.unit})
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="animate-pulse rounded-xl p-4" style={{ background: 'var(--sand)' }}>
        <div className="h-6 w-32 rounded" style={{ background: 'var(--border)' }} />
      </div>
    )
  }

  // Edit mode UI
  if (editingIntegrationId) {
    const integration = integrations.find((i) => i.id === editingIntegrationId)

    return (
      <div
        className="rounded-xl p-4 space-y-4"
        style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <h4 className="font-medium" style={{ color: 'var(--foreground)' }}>
            Rediger barnekoblinger
          </h4>
          <button onClick={resetForm} className="text-sm" style={{ color: 'var(--muted)' }}>
            Avbryt
          </button>
        </div>

        {loadingKidplanData ? (
          <div className="py-8 text-center" style={{ color: 'var(--muted)' }}>
            Henter barn fra Kidplan...
          </div>
        ) : (
          <>
            <div
              className="p-3 rounded-lg text-sm"
              style={{ background: 'rgba(232, 160, 136, 0.1)', color: 'var(--color-coral)' }}
            >
              Tilkoblet som {integration?.accountEmail}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Koble sammen barn
              </label>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Koble dine barn til barna i Kidplan for å synkronisere meldinger og bilder.
              </p>
              <div className="space-y-2">
                {children.map((child) => (
                  <ChildMappingRow key={child.id} child={child} />
                ))}
              </div>
            </div>

            <button
              onClick={saveEditedMappings}
              disabled={connecting || !hasAnyMapping()}
              className="btn btn-primary w-full"
            >
              {connecting ? 'Lagrer...' : 'Lagre og synkroniser'}
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Existing integrations */}
      {integrations.map((integration) => {
        const mappingsForDisplay = currentMappings

        return (
          <div
            key={integration.id}
            className="rounded-xl p-4"
            style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(232, 160, 136, 0.2)' }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-coral)"
                    strokeWidth="2"
                  >
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9,22 9,12 15,12 15,22" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {integration.displayName || 'Kidplan'}
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

            {/* Show mappings */}
            {mappingsForDisplay.length > 0 && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>
                  Koblede barn:
                </div>
                <div className="space-y-1">
                  {mappingsForDisplay.map((mapping) => {
                    const child = children.find((c) => c.id === mapping.childId)
                    if (!child) return null
                    return (
                      <div key={mapping.id} className="flex items-center gap-2 text-sm">
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white flex-shrink-0"
                          style={{ background: `var(--color-${child.color || 'sky'})` }}
                        >
                          {child.name?.charAt(0) || '?'}
                        </span>
                        <span style={{ color: 'var(--foreground)' }}>{child.name}</span>
                        <span style={{ color: 'var(--muted)' }}>=</span>
                        <span style={{ color: 'var(--muted)' }}>{mapping.kidplanChildName}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Last sync info and actions */}
            <div
              className="mt-3 pt-3 flex flex-wrap items-center justify-between gap-2"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {formatLastSync(integration.lastSyncAt)}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadKidplanDataForEdit(integration.id)}
                  className="btn btn-secondary text-sm"
                >
                  Rediger
                </button>
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
        )
      })}

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
          Koble til Kidplan (barnehage)
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
              Koble til Kidplan
            </h4>
            <button onClick={resetForm} className="text-sm" style={{ color: 'var(--muted)' }}>
              Avbryt
            </button>
          </div>

          {!connectionTested ? (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    E-post (Kidplan-konto)
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
                    placeholder="Ditt Kidplan-passord"
                  />
                </div>
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Passordet lagres kryptert og brukes kun til å hente data fra Kidplan.
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
                style={{ background: 'rgba(232, 160, 136, 0.1)', color: 'var(--color-coral)' }}
              >
                Tilkoblet {kindergartenInfo?.name} som {email}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  Koble sammen barn
                </label>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Koble dine barn til barna i Kidplan for å synkronisere meldinger og bilder.
                </p>
                <div className="space-y-2">
                  {children.map((child) => (
                    <ChildMappingRow key={child.id} child={child} />
                  ))}
                </div>
              </div>

              <button
                onClick={saveIntegration}
                disabled={connecting || !hasAnyMapping()}
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
