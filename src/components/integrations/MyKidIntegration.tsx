'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Child } from '@/lib/types'
import {
  SERVICE_CONFIGS,
  useIntegrationState,
  IntegrationCard,
  ConnectionForm,
  LoadingSkeleton,
  EmptyState,
  type IntegrationMapping,
} from './shared'

// MyKid-specific type for children from the service
interface MyKidChild {
  id: number
  name: string
}

interface Props {
  householdId: string
  children: Child[]
  onMessage: (type: 'success' | 'error', text: string) => void
}

const config = SERVICE_CONFIGS.mykid

export function MyKidIntegration({ householdId, children, onMessage }: Props) {
  const {
    integrations,
    currentMappings,
    loading,
    connecting,
    syncing,
    testingConnection,
    showConnectForm,
    connectionTested,
    editingIntegrationId,
    reconnectingIntegrationId,
    loadIntegrations,
    testConnection,
    saveIntegration,
    saveEditedMappings,
    reconnectIntegration,
    syncNow,
    removeIntegration,
    resetForm,
    setShowConnectForm,
    setEditingIntegrationId,
    setReconnectingIntegrationId,
  } = useIntegrationState({ config, householdId, onMessage })

  // MyKid-specific state
  const [mykidChildren, setMykidChildren] = useState<MyKidChild[]>([])
  const [loadingData, setLoadingData] = useState(false)

  // Child mapping state: Map<ourChildId, mykidChildId>
  const [childMappings, setChildMappings] = useState<Map<string, string>>(new Map())

  // Credentials state
  const [credentials, setCredentials] = useState<Record<string, string>>({
    phone: '',
    password: '',
  })

  useEffect(() => {
    loadIntegrations()
  }, [loadIntegrations])

  const handleTestConnection = async (creds: Record<string, string>) => {
    setCredentials(creds)
    const result = await testConnection(creds)
    if (result.success && result.data) {
      const data = result.data as { children?: MyKidChild[]; warning?: string }
      setMykidChildren(data.children || [])
      if (data.children?.length === 0 || data.warning) {
        onMessage('error', data.warning || 'Ingen barn funnet i MyKid-kontoen')
      } else {
        onMessage('success', `Fant ${data.children?.length || 0} barn i MyKid`)
      }
    }
  }

  const loadDataForEdit = async (integrationId: string) => {
    setLoadingData(true)
    setEditingIntegrationId(integrationId)

    try {
      const res = await fetch(`${config.groupsEndpoint}?integrationId=${integrationId}`)
      const data = await res.json()

      if (!res.ok) {
        onMessage('error', data.error || 'Kunne ikke hente barn fra MyKid')
        setEditingIntegrationId(null)
        return
      }

      setMykidChildren(data.children || [])

      // Initialize mappings from current data
      const mappings = new Map<string, string>()
      for (const mapping of data.currentMappings || []) {
        if (mapping.child_id && mapping.external_group_id) {
          mappings.set(mapping.child_id, mapping.external_group_id)
        }
      }
      setChildMappings(mappings)
    } catch (error) {
      console.error('Load MyKid data error:', error)
      onMessage('error', 'Nettverksfeil - prøv igjen')
      setEditingIntegrationId(null)
    }

    setLoadingData(false)
  }

  const setChildMapping = (ourChildId: string, mykidChildId: string) => {
    setChildMappings((prev) => {
      const newMap = new Map(prev)
      if (mykidChildId) {
        newMap.set(ourChildId, mykidChildId)
      } else {
        newMap.delete(ourChildId)
      }
      return newMap
    })
  }

  const hasAnyMapping = (): boolean => childMappings.size > 0

  const getMykidChildName = useCallback((mykidChildId: string): string => {
    const child = mykidChildren.find((c) => String(c.id) === mykidChildId)
    return child?.name || ''
  }, [mykidChildren])

  const buildMappings = useCallback(() => {
    const mappings: Array<{
      childId: string | null
      memberId: string | null
      externalGroupId: string
      externalGroupName: string
    }> = []

    for (const [ourChildId, mykidChildId] of childMappings.entries()) {
      mappings.push({
        childId: ourChildId,
        memberId: null,
        externalGroupId: mykidChildId,
        externalGroupName: getMykidChildName(mykidChildId),
      })
    }

    return mappings
  }, [childMappings, getMykidChildName])

  const handleSaveIntegration = async () => {
    if (!connectionTested || !hasAnyMapping()) {
      onMessage('error', 'Koble sammen minst ett barn')
      return
    }

    const success = await saveIntegration(credentials, buildMappings())
    if (success) {
      handleResetForm()
    }
  }

  const handleSaveEditedMappings = async () => {
    if (!editingIntegrationId || !hasAnyMapping()) {
      onMessage('error', 'Koble sammen minst ett barn')
      return
    }

    const success = await saveEditedMappings(editingIntegrationId, buildMappings())
    if (success) {
      handleResetForm()
    }
  }

  const handleSaveReconnect = async () => {
    if (!reconnectingIntegrationId || !connectionTested) return

    const success = await reconnectIntegration(reconnectingIntegrationId, credentials)
    if (success) {
      handleResetForm()
    }
  }

  const handleResetForm = () => {
    resetForm()
    setCredentials({ phone: '', password: '' })
    setMykidChildren([])
    setChildMappings(new Map())
  }

  const handleReconnect = (integrationId: string) => {
    resetForm()
    setCredentials({ phone: '', password: '' })
    setReconnectingIntegrationId(integrationId)
    onMessage('error', 'Logg inn på nytt for å oppdatere integrasjonen')
  }

  const handleRemove = async (integrationId: string) => {
    if (!confirm('Er du sikker på at du vil koble fra MyKid?')) return
    await removeIntegration(integrationId)
  }

  // Render mappings for IntegrationCard
  const renderMappings = (mappings: IntegrationMapping[]) => (
    <div className="space-y-1 text-sm">
      {mappings.map((mapping) => {
        const child = children.find((c) => c.id === mapping.childId)
        if (!child) return null
        return (
          <div key={mapping.id} className="flex items-center gap-2">
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white flex-shrink-0"
              style={{ background: `var(--color-${child.color || 'sky'})` }}
            >
              {child.name?.charAt(0) || '?'}
            </span>
            <span style={{ color: 'var(--foreground)' }}>{child.name}</span>
            <span style={{ color: 'var(--muted)' }}>=</span>
            <span style={{ color: 'var(--muted)' }}>{mapping.groupName}</span>
          </div>
        )
      })}
    </div>
  )

  // Render child mapping form content
  const renderChildMappingFormContent = (connectedAs?: string) => (
    <>
      <div
        className="p-3 rounded-lg text-sm"
        style={{ background: 'rgba(159, 205, 178, 0.2)', color: 'var(--color-sage)' }}
      >
        Tilkoblet som {connectedAs || credentials.phone}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          Koble sammen barn
        </label>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Koble dine barn til barna i MyKid for å synkronisere kalender, meldinger og bilder.
        </p>
        {mykidChildren.length === 0 ? (
          <div
            className="p-3 rounded-lg text-sm"
            style={{ background: 'rgba(232, 165, 144, 0.2)', color: 'var(--color-coral)' }}
          >
            Ingen barn funnet i MyKid-kontoen. Sjekk at du bruker riktig konto.
          </div>
        ) : (
          <div className="space-y-2">
            {children.map((child) => {
              const selectedMykidId = childMappings.get(child.id) || ''
              return (
                <div key={child.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--sand)' }}>
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

                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--muted)' }}>
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>

                  <select
                    value={selectedMykidId}
                    onChange={(e) => setChildMapping(child.id, e.target.value)}
                    className="input flex-1"
                    style={{ maxWidth: '200px' }}
                  >
                    <option value="">Ikke koblet</option>
                    {mykidChildren.map((mc) => (
                      <option key={mc.id} value={String(mc.id)}>
                        {mc.name}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <button
        onClick={editingIntegrationId ? handleSaveEditedMappings : handleSaveIntegration}
        disabled={connecting || !hasAnyMapping()}
        className="btn btn-primary w-full"
      >
        {connecting ? 'Lagrer...' : 'Lagre og synkroniser'}
      </button>
    </>
  )

  if (loading) {
    return <LoadingSkeleton />
  }

  // Edit mode
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
          <button onClick={handleResetForm} className="text-sm" style={{ color: 'var(--muted)' }}>
            Avbryt
          </button>
        </div>

        {loadingData ? (
          <div className="py-8 text-center" style={{ color: 'var(--muted)' }}>
            Henter barn fra MyKid...
          </div>
        ) : (
          renderChildMappingFormContent(integration?.accountEmail || undefined)
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Existing integrations */}
      {integrations.map((integration) => (
        <IntegrationCard
          key={integration.id}
          integration={integration}
          mappings={currentMappings}
          syncing={syncing}
          service="mykid"
          onSync={() => syncNow(integration.id)}
          onFullSync={() => syncNow(integration.id, true)}
          onEdit={() => loadDataForEdit(integration.id)}
          onRemove={() => handleRemove(integration.id)}
          onReconnect={() => handleReconnect(integration.id)}
          renderMappings={renderMappings}
        />
      ))}

      {/* Empty state */}
      {!showConnectForm && integrations.length === 0 && (
        <EmptyState
          serviceName={config.displayName}
          onAdd={() => setShowConnectForm(true)}
        />
      )}

      {/* Reconnect form */}
      {reconnectingIntegrationId && (
        <ConnectionForm
          fields={config.credentialFields}
          serviceName={config.displayName}
          title={`Koble til ${config.displayName} på nytt`}
          saveLabel="Oppdater innlogging"
          successText="Innlogging bekreftet"
          testing={testingConnection}
          tested={connectionTested}
          connecting={connecting}
          onTest={handleTestConnection}
          onSave={handleSaveReconnect}
          onCancel={handleResetForm}
        />
      )}

      {/* Connection form */}
      {showConnectForm && (
        <ConnectionForm
          fields={config.credentialFields}
          serviceName={config.displayName}
          testing={testingConnection}
          tested={connectionTested}
          connecting={connecting}
          onTest={handleTestConnection}
          onSave={() => handleSaveIntegration()}
          onCancel={handleResetForm}
          canSave={hasAnyMapping()}
        >
          {renderChildMappingFormContent()}
        </ConnectionForm>
      )}
    </div>
  )
}
