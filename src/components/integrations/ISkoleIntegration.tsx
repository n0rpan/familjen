'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Child } from '@/lib/types'
import {
  SERVICE_CONFIGS,
  useIntegrationState,
  IntegrationCard,
  LoadingSkeleton,
  EmptyState,
  type IntegrationMapping,
} from './shared'

// iSkole-specific types
interface ISkoleChild {
  id: string
  name: string
  school: string
  class: string
  schoolYear: string
  fylkeid: string
  skoleid: string
}

interface Props {
  householdId: string
  children: Child[]
  onMessage: (type: 'success' | 'error', text: string) => void
}

const config = SERVICE_CONFIGS.iskole

export function ISkoleIntegration({ householdId, children, onMessage }: Props) {
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
    loadIntegrations,
    testConnection,
    saveIntegration,
    saveEditedMappings,
    syncNow,
    removeIntegration,
    resetForm,
    setShowConnectForm,
    setEditingIntegrationId,
  } = useIntegrationState({ config, householdId, onMessage })

  // iSkole-specific state
  const [iskoleChildren, setIskoleChildren] = useState<ISkoleChild[]>([])
  const [parentInfo, setParentInfo] = useState<{ name: string; personId: number } | null>(null)
  const [loadingData, setLoadingData] = useState(false)

  // Child mapping state: Record<iskoleChildId, ourChildId>
  const [childMappings, setChildMappings] = useState<Record<string, string>>({})

  // Credentials state
  const [credentials, setCredentials] = useState<Record<string, string>>({
    username: '',
    password: '',
  })

  useEffect(() => {
    loadIntegrations()
  }, [loadIntegrations])

  const handleTestConnection = async (creds: Record<string, string>) => {
    setCredentials(creds)
    const result = await testConnection(creds)
    if (result.success && result.data) {
      const data = result.data as {
        children?: ISkoleChild[]
        parent?: { name: string; personId: number }
        username?: string
      }
      setIskoleChildren(data.children || [])
      setParentInfo(data.parent || null)

      // Auto-match children by name
      const mappings: Record<string, string> = {}
      for (const iskoleChild of data.children || []) {
        const match = children.find(
          (c) => c.name.toLowerCase().includes(iskoleChild.name.split(' ')[0].toLowerCase())
        )
        if (match) {
          mappings[iskoleChild.id] = match.id
        }
      }
      setChildMappings(mappings)

      onMessage('success', `Tilkoblet som ${data.parent?.name || creds.username}`)
    }
  }

  const loadDataForEdit = async (integrationId: string) => {
    setLoadingData(true)
    setEditingIntegrationId(integrationId)

    try {
      const res = await fetch(`${config.groupsEndpoint}?integrationId=${integrationId}`)
      const data = await res.json()

      if (!res.ok) {
        onMessage('error', data.error || 'Kunne ikke hente barn fra iSkole')
        setEditingIntegrationId(null)
        return
      }

      setIskoleChildren(data.children || [])

      // Initialize mappings from current data
      const mappings: Record<string, string> = {}
      for (const mapping of data.currentMappings || []) {
        if (mapping.external_group_id && mapping.child_id) {
          mappings[mapping.external_group_id] = mapping.child_id
        }
      }
      setChildMappings(mappings)
    } catch (error) {
      console.error('Load iSkole data error:', error)
      onMessage('error', 'Nettverksfeil - prøv igjen')
      setEditingIntegrationId(null)
    }

    setLoadingData(false)
  }

  const hasAnyMapping = (): boolean => Object.values(childMappings).some((v) => v)

  const getIskoleChildName = useCallback((iskoleChildId: string): string => {
    const child = iskoleChildren.find((c) => c.id === iskoleChildId)
    return child?.name || ''
  }, [iskoleChildren])

  const buildMappings = useCallback(() => {
    const mappings: Array<{
      childId: string | null
      memberId: string | null
      externalGroupId: string
      externalGroupName: string
    }> = []

    for (const [iskoleId, ourChildId] of Object.entries(childMappings)) {
      if (ourChildId) {
        mappings.push({
          childId: ourChildId,
          memberId: null,
          externalGroupId: iskoleId,
          externalGroupName: getIskoleChildName(iskoleId),
        })
      }
    }

    return mappings
  }, [childMappings, getIskoleChildName])

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

  const handleResetForm = () => {
    resetForm()
    setCredentials({ username: '', password: '' })
    setIskoleChildren([])
    setParentInfo(null)
    setChildMappings({})
  }

  const handleRemove = async (integrationId: string) => {
    if (!confirm('Er du sikker på at du vil koble fra iSkole?')) return
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
        className="p-3 rounded-lg"
        style={{ background: 'rgba(131, 166, 151, 0.15)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--color-sage)' }}>
          Tilkobling vellykket!
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--foreground)' }}>
          Logget inn som: {connectedAs || parentInfo?.name || credentials.username}
        </p>
      </div>

      <div>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>
          Koble iSkole-elever til dine barn:
        </p>
        <div className="space-y-3">
          {iskoleChildren.map((iskoleChild) => (
            <div
              key={iskoleChild.id}
              className="p-3 rounded-lg"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
                    {iskoleChild.name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {iskoleChild.school} - {iskoleChild.class}
                  </p>
                </div>
                <select
                  value={childMappings[iskoleChild.id] || ''}
                  onChange={(e) => setChildMappings({ ...childMappings, [iskoleChild.id]: e.target.value })}
                  className="input text-sm py-1"
                  style={{ minWidth: '150px' }}
                >
                  <option value="">-- Velg barn --</option>
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
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
            Henter barn fra iSkole...
          </div>
        ) : (
          renderChildMappingFormContent(integration?.accountEmail?.substring(0, 6) + '***')
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
          service="iskole"
          onSync={() => syncNow(integration.id)}
          onFullSync={() => syncNow(integration.id, true)}
          onEdit={() => loadDataForEdit(integration.id)}
          onRemove={() => handleRemove(integration.id)}
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

      {/* Custom connection form for iSkole (special SSN input) */}
      {showConnectForm && (
        <div
          className="rounded-xl p-4 space-y-4"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <h4 className="font-medium" style={{ color: 'var(--foreground)' }}>
              Koble til iSkole
            </h4>
            <button onClick={handleResetForm} className="text-sm" style={{ color: 'var(--muted)' }}>
              Avbryt
            </button>
          </div>

          {!connectionTested ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>
                  Fødselsnummer (11 siffer)
                </label>
                <input
                  type="text"
                  value={credentials.username}
                  onChange={(e) => setCredentials({
                    ...credentials,
                    username: e.target.value.replace(/\D/g, '').slice(0, 11)
                  })}
                  placeholder="12345678901"
                  className="input"
                  maxLength={11}
                />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>
                  Passord
                </label>
                <input
                  type="password"
                  value={credentials.password}
                  onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                  placeholder="Ditt iSkole-passord"
                  className="input"
                />
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Bruk samme innlogging som på iskole.net/forelder. Passordet lagres kryptert.
              </p>
              <button
                onClick={() => handleTestConnection(credentials)}
                disabled={testingConnection || credentials.username.length !== 11 || !credentials.password}
                className="btn btn-primary w-full"
              >
                {testingConnection ? 'Kobler til...' : 'Test tilkobling'}
              </button>
            </div>
          ) : (
            renderChildMappingFormContent()
          )}
        </div>
      )}

      {/* Sync all button */}
      {integrations.length > 0 && !showConnectForm && !editingIntegrationId && (
        <button
          onClick={() => syncNow()}
          disabled={syncing}
          className="btn btn-secondary text-sm w-full"
        >
          {syncing ? 'Synkroniserer...' : 'Synkroniser alle iSkole-kontoer'}
        </button>
      )}
    </div>
  )
}
