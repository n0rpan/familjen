'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Child, HouseholdMember } from '@/lib/types'
import {
  SERVICE_CONFIGS,
  useIntegrationState,
  IntegrationCard,
  ConnectionForm,
  LoadingSkeleton,
  EmptyState,
  type IntegrationMapping,
} from './shared'

// Spond-specific types for hierarchical groups
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

interface Props {
  householdId: string
  children: Child[]
  members: HouseholdMember[]
  onMessage: (type: 'success' | 'error', text: string) => void
}

const config = SERVICE_CONFIGS.spond

export function SpondIntegration({ householdId, children, members, onMessage }: Props) {
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
    supabase,
  } = useIntegrationState({ config, householdId, onMessage })

  // Spond-specific state for groups
  const [availableGroups, setAvailableGroups] = useState<SpondGroup[]>([])
  const [loadingGroups, setLoadingGroups] = useState(false)

  // Multi-select state: Map<entityId, Set<groupId>>
  const [selectedChildGroups, setSelectedChildGroups] = useState<Map<string, Set<string>>>(new Map())
  const [selectedMemberGroups, setSelectedMemberGroups] = useState<Map<string, Set<string>>>(new Map())

  // Credentials state - stored to pass to save after group selection
  const [credentials, setCredentials] = useState<Record<string, string>>({
    email: '',
    password: '',
  })

  useEffect(() => {
    loadIntegrations()
  }, [loadIntegrations])

  const handleTestConnection = async (creds: Record<string, string>) => {
    setCredentials(creds)
    const result = await testConnection(creds)
    if (result.success && result.data) {
      const data = result.data as { groups?: SpondGroup[]; email?: string }
      setAvailableGroups(data.groups || [])
      onMessage('success', `Koblet til Spond som ${data.email}`)
    }
  }

  const loadGroupsForEdit = async (integrationId: string) => {
    setLoadingGroups(true)
    setEditingIntegrationId(integrationId)

    try {
      const res = await fetch(`${config.groupsEndpoint}?integrationId=${integrationId}`)
      const data = await res.json()

      if (!res.ok) {
        onMessage('error', data.error || 'Kunne ikke hente grupper')
        setEditingIntegrationId(null)
        return
      }

      setAvailableGroups(data.groups || [])

      // Initialize selections from current mappings
      const childGroups = new Map<string, Set<string>>()
      const memberGroups = new Map<string, Set<string>>()

      for (const mapping of data.currentMappings || []) {
        if (mapping.child_id && mapping.external_group_id) {
          const existing = childGroups.get(mapping.child_id) || new Set()
          existing.add(mapping.external_group_id)
          childGroups.set(mapping.child_id, existing)
        }
        if (mapping.member_id && mapping.external_group_id) {
          const existing = memberGroups.get(mapping.member_id) || new Set()
          existing.add(mapping.external_group_id)
          memberGroups.set(mapping.member_id, existing)
        }
      }

      setSelectedChildGroups(childGroups)
      setSelectedMemberGroups(memberGroups)
    } catch (error) {
      console.error('Load groups error:', error)
      onMessage('error', 'Nettverksfeil - prøv igjen')
      setEditingIntegrationId(null)
    }

    setLoadingGroups(false)
  }

  const toggleGroupSelection = (entityId: string, groupId: string, isChild: boolean) => {
    const setter = isChild ? setSelectedChildGroups : setSelectedMemberGroups
    setter((prev) => {
      const newMap = new Map(prev)
      const existing = newMap.get(entityId) || new Set()
      if (existing.has(groupId)) {
        existing.delete(groupId)
      } else {
        existing.add(groupId)
      }
      newMap.set(entityId, existing)
      return newMap
    })
  }

  const getGroupName = useCallback((groupId: string): string => {
    for (const group of availableGroups) {
      if (group.id === groupId) return group.name
      const subGroup = group.subGroups?.find((sg) => sg.id === groupId)
      if (subGroup) return `${group.name} > ${subGroup.name}`
    }
    return ''
  }, [availableGroups])

  const hasAnySelection = (): boolean => {
    for (const groups of selectedChildGroups.values()) {
      if (groups.size > 0) return true
    }
    for (const groups of selectedMemberGroups.values()) {
      if (groups.size > 0) return true
    }
    return false
  }

  const buildMappings = useCallback(() => {
    const mappings: Array<{
      childId: string | null
      memberId: string | null
      externalGroupId: string
      externalGroupName: string
    }> = []

    for (const [childId, groupIds] of selectedChildGroups.entries()) {
      for (const groupId of groupIds) {
        mappings.push({
          childId,
          memberId: null,
          externalGroupId: groupId,
          externalGroupName: getGroupName(groupId),
        })
      }
    }

    for (const [memberId, groupIds] of selectedMemberGroups.entries()) {
      for (const groupId of groupIds) {
        mappings.push({
          childId: null,
          memberId,
          externalGroupId: groupId,
          externalGroupName: getGroupName(groupId),
        })
      }
    }

    return mappings
  }, [selectedChildGroups, selectedMemberGroups, getGroupName])

  const handleSaveIntegration = async () => {
    if (!connectionTested || !hasAnySelection()) {
      onMessage('error', 'Velg minst én gruppe')
      return
    }

    const success = await saveIntegration(credentials, buildMappings())
    if (success) {
      handleResetForm()
    }
  }

  const handleSaveEditedMappings = async () => {
    if (!editingIntegrationId || !hasAnySelection()) {
      onMessage('error', 'Velg minst én gruppe')
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
    setCredentials({ email: '', password: '' })
    setAvailableGroups([])
    setSelectedChildGroups(new Map())
    setSelectedMemberGroups(new Map())
  }

  const handleReconnect = (integrationId: string) => {
    resetForm()
    setCredentials({ email: '', password: '' })
    setReconnectingIntegrationId(integrationId)
    onMessage('error', 'Logg inn på nytt for å oppdatere integrasjonen')
  }

  const handleRemove = async (integrationId: string) => {
    if (!confirm('Er du sikker på at du vil koble fra Spond?')) return
    await removeIntegration(integrationId)
  }

  // Render mappings for IntegrationCard
  const renderMappings = (mappings: IntegrationMapping[]) => {
    const childMappings = mappings.filter((m) => m.childId)
    const memberMappings = mappings.filter((m) => m.memberId)

    return (
      <div className="space-y-2 text-sm">
        {children.map((child) => {
          const childGroups = childMappings.filter((m) => m.childId === child.id)
          if (childGroups.length === 0) return null
          return (
            <div key={child.id} className="flex items-start gap-2">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white flex-shrink-0 mt-0.5"
                style={{ background: `var(--color-${child.color || 'sky'})` }}
              >
                {child.name?.charAt(0) || '?'}
              </span>
              <div>
                <span style={{ color: 'var(--foreground)' }}>{child.name}:</span>
                <span className="ml-1" style={{ color: 'var(--muted)' }}>
                  {childGroups.map((m) => m.groupName).join(', ')}
                </span>
              </div>
            </div>
          )
        })}
        {members.map((member) => {
          const memberGroups = memberMappings.filter((m) => m.memberId === member.id)
          if (memberGroups.length === 0) return null
          return (
            <div key={member.id} className="flex items-start gap-2">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white flex-shrink-0 mt-0.5"
                style={{ background: 'var(--color-sage)' }}
              >
                {member.name?.charAt(0) || '?'}
              </span>
              <div>
                <span style={{ color: 'var(--foreground)' }}>{member.name}:</span>
                <span className="ml-1" style={{ color: 'var(--muted)' }}>
                  {memberGroups.map((m) => m.groupName).join(', ')}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Render group selector for an entity
  const renderGroupSelector = (
    entityId: string,
    entityName: string,
    entityColor: string | undefined,
    isChild: boolean,
    selectedGroups: Set<string>
  ) => (
    <div className="border rounded-lg p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs text-white flex-shrink-0"
          style={{ background: entityColor ? `var(--color-${entityColor})` : 'var(--color-sage)' }}
        >
          {entityName?.charAt(0) || '?'}
        </span>
        <span className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
          {entityName}
        </span>
        {selectedGroups.size > 0 && (
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {selectedGroups.size}
          </span>
        )}
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {availableGroups.map((group) => (
          <div key={group.id}>
            <label className="flex items-center gap-2 py-1 px-2 rounded hover:bg-black/5 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedGroups.has(group.id)}
                onChange={() => toggleGroupSelection(entityId, group.id, isChild)}
                className="rounded"
              />
              <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                {group.name}
              </span>
            </label>
            {group.subGroups?.map((subGroup) => (
              <label
                key={subGroup.id}
                className="flex items-center gap-2 py-1 px-2 pl-6 rounded hover:bg-black/5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedGroups.has(subGroup.id)}
                  onChange={() => toggleGroupSelection(entityId, subGroup.id, isChild)}
                  className="rounded"
                />
                <span className="text-sm" style={{ color: 'var(--muted)' }}>
                  {subGroup.name}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  )

  // Render entity selection form content
  const renderEntitySelectionFormContent = (connectedEmail?: string) => (
    <>
      <div
        className="p-3 rounded-lg text-sm"
        style={{ background: 'rgba(139, 168, 136, 0.1)', color: 'var(--color-sage)' }}
      >
        Tilkoblet som {connectedEmail || credentials.email}
      </div>

      {children.length > 0 && (
        <div>
          <label className="text-sm font-medium block mb-2" style={{ color: 'var(--foreground)' }}>
            {editingIntegrationId ? 'Barn' : 'Velg grupper for barna'}
          </label>
          {!editingIntegrationId && (
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
              Hvert barn kan tilhøre flere grupper
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {children.map((child) => (
              <div key={child.id}>
                {renderGroupSelector(
                  child.id,
                  child.name,
                  child.color,
                  true,
                  selectedChildGroups.get(child.id) || new Set()
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {members.length > 0 && (
        <div>
          <label className="text-sm font-medium block mb-2" style={{ color: 'var(--foreground)' }}>
            {editingIntegrationId ? 'Voksne' : 'Velg grupper for voksne (valgfritt)'}
          </label>
          {!editingIntegrationId && (
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
              F.eks. foreldrekomitéer, dugnadsgrupper, etc.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {members.map((member) => (
              <div key={member.id}>
                {renderGroupSelector(
                  member.id,
                  member.name,
                  undefined,
                  false,
                  selectedMemberGroups.get(member.id) || new Set()
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={editingIntegrationId ? handleSaveEditedMappings : handleSaveIntegration}
        disabled={connecting || !hasAnySelection()}
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
            Rediger Spond-grupper
          </h4>
          <button onClick={handleResetForm} className="text-sm" style={{ color: 'var(--muted)' }}>
            Avbryt
          </button>
        </div>

        {loadingGroups ? (
          <div className="py-8 text-center" style={{ color: 'var(--muted)' }}>
            Henter grupper fra Spond...
          </div>
        ) : (
          renderEntitySelectionFormContent(integration?.accountEmail || undefined)
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
          service="spond"
          onSync={() => syncNow(integration.id)}
          onFullSync={() => syncNow(integration.id, true)}
          onEdit={() => loadGroupsForEdit(integration.id)}
          onRemove={() => handleRemove(integration.id)}
          onReconnect={() => handleReconnect(integration.id)}
          renderMappings={renderMappings}
        />
      ))}

      {/* Empty state / Connect button */}
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
          canSave={hasAnySelection()}
        >
          {renderEntitySelectionFormContent()}
        </ConnectionForm>
      )}
    </div>
  )
}
