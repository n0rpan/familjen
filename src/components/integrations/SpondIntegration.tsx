'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Child, HouseholdMember } from '@/lib/types'

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

interface GroupMapping {
  id?: string
  childId: string | null
  memberId: string | null
  groupId: string
  groupName: string
}

interface Props {
  householdId: string
  children: Child[]
  members: HouseholdMember[]
  onMessage: (type: 'success' | 'error', text: string) => void
}

export function SpondIntegration({ householdId, children, members, onMessage }: Props) {
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
  const [connectionTested, setConnectionTested] = useState(false)

  // Edit mode state
  const [editingIntegrationId, setEditingIntegrationId] = useState<string | null>(null)
  const [loadingGroups, setLoadingGroups] = useState(false)

  // Multi-select state: Map<entityId, Set<groupId>>
  const [selectedChildGroups, setSelectedChildGroups] = useState<Map<string, Set<string>>>(new Map())
  const [selectedMemberGroups, setSelectedMemberGroups] = useState<Map<string, Set<string>>>(new Map())

  // Current mappings for display
  const [currentMappings, setCurrentMappings] = useState<GroupMapping[]>([])

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

        // Load mappings for each integration
        if (data.integrations?.length > 0) {
          const { data: mappings } = await supabase
            .from('external_integration_children')
            .select('id, integration_id, child_id, member_id, external_group_id, external_group_name')
            .in(
              'integration_id',
              data.integrations.map((i: Integration) => i.id)
            )

          setCurrentMappings(
            (mappings || []).map((m) => ({
              id: m.id,
              childId: m.child_id,
              memberId: m.member_id,
              groupId: m.external_group_id,
              groupName: m.external_group_name,
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

  const loadGroupsForEdit = async (integrationId: string) => {
    setLoadingGroups(true)
    setEditingIntegrationId(integrationId)

    try {
      const res = await fetch(`/api/integrations/spond/groups?integrationId=${integrationId}`)
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

  const toggleGroupSelection = (
    entityId: string,
    groupId: string,
    isChild: boolean
  ) => {
    if (isChild) {
      setSelectedChildGroups((prev) => {
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
    } else {
      setSelectedMemberGroups((prev) => {
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
  }

  const getGroupName = (groupId: string): string => {
    for (const group of availableGroups) {
      if (group.id === groupId) return group.name
      const subGroup = group.subGroups?.find((sg) => sg.id === groupId)
      if (subGroup) return `${group.name} > ${subGroup.name}`
    }
    return ''
  }

  const hasAnySelection = (): boolean => {
    for (const groups of selectedChildGroups.values()) {
      if (groups.size > 0) return true
    }
    for (const groups of selectedMemberGroups.values()) {
      if (groups.size > 0) return true
    }
    return false
  }

  const saveIntegration = async () => {
    if (!connectionTested || !hasAnySelection()) {
      onMessage('error', 'Velg minst én gruppe')
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

      await saveMappings(integrationId)

      // Reset form and reload
      resetForm()
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

  const saveEditedMappings = async () => {
    if (!editingIntegrationId || !hasAnySelection()) {
      onMessage('error', 'Velg minst én gruppe')
      return
    }

    setConnecting(true)
    try {
      await saveMappings(editingIntegrationId)

      // Reset and reload
      setEditingIntegrationId(null)
      setAvailableGroups([])
      setSelectedChildGroups(new Map())
      setSelectedMemberGroups(new Map())
      await loadIntegrations()

      onMessage('success', 'Gruppetilknytninger oppdatert')

      // Trigger sync to fetch data for new groups
      syncNow(editingIntegrationId)
    } catch (error) {
      console.error('Save mappings error:', error)
      onMessage('error', 'Kunne ikke lagre gruppetilknytninger')
    }
    setConnecting(false)
  }

  const saveMappings = async (integrationId: string) => {
    // Build mappings to insert
    const mappingsToInsert: Array<{
      integration_id: string
      child_id: string | null
      member_id: string | null
      external_group_id: string
      external_group_name: string
    }> = []

    // Child mappings
    for (const [childId, groupIds] of selectedChildGroups.entries()) {
      for (const groupId of groupIds) {
        mappingsToInsert.push({
          integration_id: integrationId,
          child_id: childId,
          member_id: null,
          external_group_id: groupId,
          external_group_name: getGroupName(groupId),
        })
      }
    }

    // Member mappings
    for (const [memberId, groupIds] of selectedMemberGroups.entries()) {
      for (const groupId of groupIds) {
        mappingsToInsert.push({
          integration_id: integrationId,
          child_id: null,
          member_id: memberId,
          external_group_id: groupId,
          external_group_name: getGroupName(groupId),
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
    setAvailableGroups([])
    setSelectedChildGroups(new Map())
    setSelectedMemberGroups(new Map())
    setConnectionTested(false)
    setEditingIntegrationId(null)
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
        let message = `Synkronisert: ${summary.eventsTotal} hendelser, ${summary.messagesTotal} meldinger`
        if (summary.suggestionsCreated > 0) {
          message += `, ${summary.suggestionsCreated} nye forslag`
        }
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

  // Get mappings for a specific integration
  const getMappingsForIntegration = (integrationId: string) => {
    return currentMappings.filter((m) => {
      // Find which integration this mapping belongs to
      // Since we load all mappings, we need to check by looking up the mapping
      return true // All loaded mappings are for the loaded integrations
    })
  }

  // Group selection UI component
  const GroupSelector = ({
    entityId,
    entityName,
    entityColor,
    isChild,
    selectedGroups,
  }: {
    entityId: string
    entityName: string
    entityColor?: string
    isChild: boolean
    selectedGroups: Set<string>
  }) => (
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
            {/* Parent group checkbox */}
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
            {/* Subgroups */}
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
            Rediger Spond-grupper
          </h4>
          <button
            onClick={resetForm}
            className="text-sm"
            style={{ color: 'var(--muted)' }}
          >
            Avbryt
          </button>
        </div>

        {loadingGroups ? (
          <div className="py-8 text-center" style={{ color: 'var(--muted)' }}>
            Henter grupper fra Spond...
          </div>
        ) : (
          <>
            <div
              className="p-3 rounded-lg text-sm"
              style={{ background: 'rgba(139, 168, 136, 0.1)', color: 'var(--color-sage)' }}
            >
              Tilkoblet som {integration?.accountEmail}
            </div>

            {/* Children section */}
            {children.length > 0 && (
              <div>
                <label className="text-sm font-medium block mb-2" style={{ color: 'var(--foreground)' }}>
                  Barn
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {children.map((child) => (
                    <GroupSelector
                      key={child.id}
                      entityId={child.id}
                      entityName={child.name}
                      entityColor={child.color}
                      isChild={true}
                      selectedGroups={selectedChildGroups.get(child.id) || new Set()}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Members section */}
            {members.length > 0 && (
              <div>
                <label className="text-sm font-medium block mb-2" style={{ color: 'var(--foreground)' }}>
                  Voksne
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {members.map((member) => (
                    <GroupSelector
                      key={member.id}
                      entityId={member.id}
                      entityName={member.name}
                      entityColor={undefined}
                      isChild={false}
                      selectedGroups={selectedMemberGroups.get(member.id) || new Set()}
                    />
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={saveEditedMappings}
              disabled={connecting || !hasAnySelection()}
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
        const integrationMappings = currentMappings
        const childMappingsList = integrationMappings.filter((m) => m.childId)
        const memberMappingsList = integrationMappings.filter((m) => m.memberId)

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

            {/* Show mappings grouped by child/member */}
            {(childMappingsList.length > 0 || memberMappingsList.length > 0) && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>
                  Tilknyttede grupper:
                </div>
                <div className="space-y-2">
                  {/* Group by child */}
                  {children.map((child) => {
                    const childGroups = childMappingsList.filter((m) => m.childId === child.id)
                    if (childGroups.length === 0) return null
                    return (
                      <div key={child.id} className="flex items-start gap-2 text-sm">
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
                  {/* Group by member */}
                  {members.map((member) => {
                    const memberGroups = memberMappingsList.filter((m) => m.memberId === member.id)
                    if (memberGroups.length === 0) return null
                    return (
                      <div key={member.id} className="flex items-start gap-2 text-sm">
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
                  onClick={() => loadGroupsForEdit(integration.id)}
                  className="btn btn-secondary text-sm"
                >
                  Rediger grupper
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
              onClick={resetForm}
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

              {/* Children section */}
              {children.length > 0 && (
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: 'var(--foreground)' }}>
                    Velg grupper for barna
                  </label>
                  <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
                    Hvert barn kan tilhøre flere grupper
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {children.map((child) => (
                      <GroupSelector
                        key={child.id}
                        entityId={child.id}
                        entityName={child.name}
                        entityColor={child.color}
                        isChild={true}
                        selectedGroups={selectedChildGroups.get(child.id) || new Set()}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Members section */}
              {members.length > 0 && (
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: 'var(--foreground)' }}>
                    Velg grupper for voksne (valgfritt)
                  </label>
                  <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
                    F.eks. foreldrekomitéer, dugnadsgrupper, etc.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {members.map((member) => (
                      <GroupSelector
                        key={member.id}
                        entityId={member.id}
                        entityName={member.name}
                        entityColor={undefined}
                        isChild={false}
                        selectedGroups={selectedMemberGroups.get(member.id) || new Set()}
                      />
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={saveIntegration}
                disabled={connecting || !hasAnySelection()}
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
