'use client'

import { useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Integration, IntegrationMapping, IntegrationConfig } from './types'

interface UseIntegrationStateOptions {
  config: IntegrationConfig
  householdId: string
  onMessage: (type: 'success' | 'error', text: string) => void
}

interface UseIntegrationStateReturn {
  // Data
  integrations: Integration[]
  currentMappings: IntegrationMapping[]

  // Loading states
  loading: boolean
  connecting: boolean
  syncing: boolean
  testingConnection: boolean

  // Form states
  showConnectForm: boolean
  connectionTested: boolean
  editingIntegrationId: string | null

  // Actions
  loadIntegrations: () => Promise<void>
  testConnection: (credentials: Record<string, string>) => Promise<{ success: boolean; data?: unknown }>
  saveIntegration: (credentials: Record<string, string>, mappings: MappingInput[]) => Promise<boolean>
  saveEditedMappings: (integrationId: string, mappings: MappingInput[]) => Promise<boolean>
  syncNow: (integrationId?: string, fullSync?: boolean) => Promise<void>
  removeIntegration: (integrationId: string) => Promise<boolean>
  resetForm: () => void
  setShowConnectForm: (show: boolean) => void
  setConnectionTested: (tested: boolean) => void
  setEditingIntegrationId: (id: string | null) => void

  // Supabase client
  supabase: ReturnType<typeof createClient>
}

interface MappingInput {
  childId: string | null
  memberId: string | null
  externalGroupId: string
  externalGroupName: string
}

export function useIntegrationState({
  config,
  householdId,
  onMessage,
}: UseIntegrationStateOptions): UseIntegrationStateReturn {
  const supabase = useMemo(() => createClient(), [])

  // Data states
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [currentMappings, setCurrentMappings] = useState<IntegrationMapping[]>([])

  // Loading states
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)

  // Form states
  const [showConnectForm, setShowConnectForm] = useState(false)
  const [connectionTested, setConnectionTested] = useState(false)
  const [editingIntegrationId, setEditingIntegrationId] = useState<string | null>(null)

  const loadIntegrations = useCallback(async () => {
    setLoading(true)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

      const res = await fetch(config.syncEndpoint, { signal: controller.signal })
      clearTimeout(timeoutId)

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
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[${config.service}] Timeout loading integrations`)
      } else {
        console.error(`[${config.service}] Error loading integrations:`, error)
      }
    }
    setLoading(false)
  }, [config.syncEndpoint, config.service, supabase])

  const testConnection = useCallback(
    async (credentials: Record<string, string>): Promise<{ success: boolean; data?: unknown }> => {
      setTestingConnection(true)
      try {
        const res = await fetch(config.testConnectionEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        })

        const data = await res.json()

        if (!res.ok) {
          onMessage('error', data.error || `Kunne ikke koble til ${config.displayName}`)
          return { success: false }
        }

        setConnectionTested(true)
        return { success: true, data }
      } catch (error) {
        console.error('Test connection error:', error)
        onMessage('error', 'Nettverksfeil - prøv igjen')
        return { success: false }
      } finally {
        setTestingConnection(false)
      }
    },
    [config.testConnectionEndpoint, config.displayName, onMessage]
  )

  const saveMappingsToDb = useCallback(
    async (integrationId: string, mappings: MappingInput[]) => {
      // Delete existing mappings first
      await supabase
        .from('external_integration_children')
        .delete()
        .eq('integration_id', integrationId)

      // Insert new mappings
      if (mappings.length > 0) {
        const mappingsToInsert = mappings.map((m) => ({
          integration_id: integrationId,
          child_id: m.childId,
          member_id: m.memberId,
          external_group_id: m.externalGroupId,
          external_group_name: m.externalGroupName,
        }))

        const { error: mappingError } = await supabase
          .from('external_integration_children')
          .insert(mappingsToInsert)

        if (mappingError) {
          console.error('Save mappings error:', mappingError)
          throw new Error('Could not save mappings')
        }
      }
    },
    [supabase]
  )

  const saveIntegration = useCallback(
    async (credentials: Record<string, string>, mappings: MappingInput[]): Promise<boolean> => {
      setConnecting(true)
      try {
        // Save integration credentials
        const { data: integrationId, error: saveError } = await supabase.rpc(
          'upsert_external_integration',
          {
            p_household_id: householdId,
            p_service: config.service,
            p_display_name: config.displayName,
            p_credentials: credentials,
            p_account_email: credentials.email || credentials.phone || credentials.username || null,
          }
        )

        if (saveError) {
          console.error('Save integration error:', saveError)
          if (saveError.message?.includes('not enabled')) {
            onMessage('error', 'Integrasjoner er ikke aktivert for din husstand')
          } else if (saveError.message?.includes('Access denied')) {
            onMessage('error', 'Du har ikke tilgang til denne husstanden')
          } else {
            onMessage('error', `Kunne ikke lagre: ${saveError.message || 'Ukjent feil'}`)
          }
          return false
        }

        await saveMappingsToDb(integrationId, mappings)
        onMessage('success', `${config.displayName}-integrasjon lagret`)

        // Trigger initial sync
        syncNow(integrationId)

        return true
      } catch (error) {
        console.error('Save integration error:', error)
        onMessage('error', 'Kunne ikke lagre integrasjon')
        return false
      } finally {
        setConnecting(false)
      }
    },
    [config.service, config.displayName, householdId, onMessage, saveMappingsToDb, supabase]
  )

  const saveEditedMappings = useCallback(
    async (integrationId: string, mappings: MappingInput[]): Promise<boolean> => {
      setConnecting(true)
      try {
        await saveMappingsToDb(integrationId, mappings)
        onMessage('success', 'Koblinger oppdatert')

        // Trigger sync
        syncNow(integrationId)

        return true
      } catch (error) {
        console.error('Save mappings error:', error)
        onMessage('error', 'Kunne ikke lagre koblinger')
        return false
      } finally {
        setConnecting(false)
      }
    },
    [onMessage, saveMappingsToDb]
  )

  const syncNow = useCallback(
    async (integrationId?: string, fullSync?: boolean) => {
      setSyncing(true)
      try {
        const res = await fetch(config.syncEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integrationId, fullSync: fullSync === true }),
        })

        const data = await res.json()

        if (!res.ok) {
          onMessage('error', data.error || 'Synkronisering feilet')
        } else {
          // Run AI extraction on new messages
          if (integrationId) {
            fetch('/api/integrations/extract-actions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ integrationId }),
            }).catch(() => {}) // Non-blocking
          }

          const { summary } = data
          const parts: string[] = []
          if (summary?.eventsTotal > 0) parts.push(`${summary.eventsTotal} hendelser`)
          if (summary?.messagesTotal > 0) parts.push(`${summary.messagesTotal} meldinger`)
          if (summary?.photosTotal > 0) parts.push(`${summary.photosTotal} bilder`)

          const message = parts.length > 0
            ? `Synkronisert: ${parts.join(', ')}`
            : 'Synkronisering fullført'

          onMessage('success', message)
          await loadIntegrations()
        }
      } catch (error) {
        console.error('Sync error:', error)
        onMessage('error', 'Synkronisering feilet')
      } finally {
        setSyncing(false)
      }
    },
    [config.syncEndpoint, onMessage, loadIntegrations]
  )

  const removeIntegration = useCallback(
    async (integrationId: string): Promise<boolean> => {
      try {
        // Delete mappings first
        await supabase
          .from('external_integration_children')
          .delete()
          .eq('integration_id', integrationId)

        // Delete integration
        const { error } = await supabase
          .from('external_integrations')
          .delete()
          .eq('id', integrationId)

        if (error) {
          console.error('Delete integration error:', error)
          onMessage('error', 'Kunne ikke slette integrasjon')
          return false
        }

        onMessage('success', 'Integrasjon fjernet')
        await loadIntegrations()
        return true
      } catch (error) {
        console.error('Remove integration error:', error)
        onMessage('error', 'Kunne ikke slette integrasjon')
        return false
      }
    },
    [supabase, onMessage, loadIntegrations]
  )

  const resetForm = useCallback(() => {
    setShowConnectForm(false)
    setConnectionTested(false)
    setEditingIntegrationId(null)
  }, [])

  return {
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
    setConnectionTested,
    setEditingIntegrationId,
    supabase,
  }
}
