'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Child } from '@/lib/types'
import { useLanguage } from '@/lib/i18n/context'

interface Integration {
  id: string
  display_name: string
  account_email: string | null
  last_sync_at: string | null
  last_sync_status: string
  last_sync_error: string | null
}

interface ISkoleChild {
  id: string
  name: string
  school: string
  class: string
  schoolYear: string
  fylkeid: string
  skoleid: string
}

interface ChildMapping {
  id: string
  child_id: string | null
  external_group_id: string
  external_group_name: string | null
}

interface Props {
  householdId: string
  children: Child[]
  onMessage: (type: 'success' | 'error', text: string) => void
}

export function ISkoleIntegration({ householdId, children, onMessage }: Props) {
  const supabase = useMemo(() => createClient(), [])

  // State
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  // Connection form state
  const [showConnectForm, setShowConnectForm] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [connectionError, setConnectionError] = useState<string | null>(null)

  // Test connection result
  const [testResult, setTestResult] = useState<{
    success: boolean
    username: string
    parent: { name: string; personId: number }
    children: ISkoleChild[]
  } | null>(null)

  // Child mapping state
  const [selectedMappings, setSelectedMappings] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editMappings, setEditMappings] = useState<Record<string, string>>({})
  const [iskoleChildren, setIskoleChildren] = useState<ISkoleChild[]>([])
  const [loadingChildren, setLoadingChildren] = useState(false)

  const { t } = useLanguage()

  // Load existing integrations
  const loadIntegrations = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('external_integrations')
        .select('*')
        .eq('household_id', householdId)
        .eq('service', 'iskole')
        .order('created_at', { ascending: false })

      if (error) throw error
      setIntegrations(data || [])
    } catch (error) {
      console.error('Error loading iSkole integrations:', error)
    } finally {
      setLoading(false)
    }
  }, [supabase, householdId])

  useEffect(() => {
    loadIntegrations()
  }, [loadIntegrations])

  // Test connection
  const handleTestConnection = async (e: React.FormEvent) => {
    e.preventDefault()
    setConnecting(true)
    setConnectionError(null)
    setTestResult(null)

    try {
      const response = await fetch('/api/integrations/iskole/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        setConnectionError(data.error || 'Connection failed')
        return
      }

      setTestResult(data)

      // Pre-select mappings based on name matching
      const mappings: Record<string, string> = {}
      for (const iskoleChild of data.children) {
        const match = children.find(
          (c) => c.name.toLowerCase().includes(iskoleChild.name.split(' ')[0].toLowerCase())
        )
        if (match) {
          mappings[iskoleChild.id] = match.id
        }
      }
      setSelectedMappings(mappings)
    } catch (error) {
      console.error('Test connection error:', error)
      setConnectionError('Failed to connect. Please try again.')
    } finally {
      setConnecting(false)
    }
  }

  // Save integration
  const handleSaveIntegration = async () => {
    if (!testResult) return

    setSaving(true)
    try {
      // Create/update integration via RPC
      const { data: integrationData, error: integrationError } = await supabase.rpc(
        'upsert_external_integration',
        {
          p_household_id: householdId,
          p_service: 'iskole',
          p_display_name: `iSkole - ${testResult.parent.name}`,
          p_account_email: username,
          p_credentials: { username, password },
        }
      )

      if (integrationError) throw integrationError

      const integrationId = integrationData

      // Save child mappings
      const mappingsToInsert = Object.entries(selectedMappings)
        .filter(([_, childId]) => childId)
        .map(([iskoleId, childId]) => {
          const iskoleChild = testResult.children.find((c) => c.id === iskoleId)
          return {
            integration_id: integrationId,
            child_id: childId,
            external_group_id: iskoleId,
            external_group_name: iskoleChild?.name || null,
          }
        })

      if (mappingsToInsert.length > 0) {
        const { error: mappingError } = await supabase
          .from('external_integration_children')
          .insert(mappingsToInsert)

        if (mappingError) throw mappingError
      }

      onMessage('success', 'iSkole-tilkobling opprettet')
      setShowConnectForm(false)
      setTestResult(null)
      setUsername('')
      setPassword('')
      setSelectedMappings({})
      loadIntegrations()
    } catch (error) {
      console.error('Save integration error:', error)
      onMessage('error', 'Kunne ikke lagre tilkoblingen')
    } finally {
      setSaving(false)
    }
  }

  // Sync integration
  const handleSync = async (integrationId?: string) => {
    setSyncing(true)
    try {
      const response = await fetch('/api/integrations/iskole/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId }),
      })

      const data = await response.json()

      if (!response.ok) {
        onMessage('error', data.error || 'Synkronisering feilet')
        return
      }

      // Run AI extraction on new messages
      await fetch('/api/integrations/extract-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId }),
      })

      const { summary } = data
      onMessage(
        'success',
        `Synkronisert: ${summary.messagesTotal} meldinger`
      )
      loadIntegrations()
    } catch (error) {
      console.error('Sync error:', error)
      onMessage('error', 'Synkronisering feilet')
    } finally {
      setSyncing(false)
    }
  }

  // Edit integration - load children
  const handleStartEdit = async (integration: Integration) => {
    setEditingId(integration.id)
    setLoadingChildren(true)

    try {
      const response = await fetch(
        `/api/integrations/iskole/groups?integrationId=${integration.id}`
      )
      const data = await response.json()

      if (!response.ok) {
        onMessage('error', data.error || 'Could not load children')
        setEditingId(null)
        return
      }

      setIskoleChildren(data.children || [])

      // Set current mappings
      const mappings: Record<string, string> = {}
      for (const mapping of data.currentMappings || []) {
        if (mapping.external_group_id && mapping.child_id) {
          mappings[mapping.external_group_id] = mapping.child_id
        }
      }
      setEditMappings(mappings)
    } catch (error) {
      console.error('Error loading children:', error)
      onMessage('error', 'Could not load children')
      setEditingId(null)
    } finally {
      setLoadingChildren(false)
    }
  }

  // Save edit mappings
  const handleSaveEdit = async () => {
    if (!editingId) return

    setSaving(true)
    try {
      // Delete existing mappings
      await supabase
        .from('external_integration_children')
        .delete()
        .eq('integration_id', editingId)

      // Insert new mappings
      const mappingsToInsert = Object.entries(editMappings)
        .filter(([_, childId]) => childId)
        .map(([iskoleId, childId]) => {
          const iskoleChild = iskoleChildren.find((c) => c.id === iskoleId)
          return {
            integration_id: editingId,
            child_id: childId,
            external_group_id: iskoleId,
            external_group_name: iskoleChild?.name || null,
          }
        })

      if (mappingsToInsert.length > 0) {
        const { error } = await supabase
          .from('external_integration_children')
          .insert(mappingsToInsert)

        if (error) throw error
      }

      onMessage('success', 'Mappinger oppdatert')
      setEditingId(null)
      setIskoleChildren([])
      setEditMappings({})
    } catch (error) {
      console.error('Save edit error:', error)
      onMessage('error', 'Kunne ikke oppdatere mappinger')
    } finally {
      setSaving(false)
    }
  }

  // Delete integration
  const handleDelete = async (integrationId: string) => {
    if (!confirm('Er du sikker på at du vil slette denne tilkoblingen?')) return

    try {
      const { error } = await supabase
        .from('external_integrations')
        .delete()
        .eq('id', integrationId)

      if (error) throw error

      onMessage('success', 'Tilkobling slettet')
      loadIntegrations()
    } catch (error) {
      console.error('Delete error:', error)
      onMessage('error', 'Kunne ikke slette tilkoblingen')
    }
  }

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Aldri'
    return new Date(dateStr).toLocaleString('nb-NO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Status badge
  const StatusBadge = ({ status }: { status: string }) => {
    const styles: Record<string, { bg: string; text: string }> = {
      ok: { bg: 'rgba(131, 166, 151, 0.2)', text: 'var(--color-sage)' },
      auth_failed: { bg: 'rgba(232, 120, 109, 0.2)', text: 'var(--color-coral)' },
      error: { bg: 'rgba(232, 120, 109, 0.2)', text: 'var(--color-coral)' },
      pending: { bg: 'rgba(229, 185, 94, 0.2)', text: 'var(--color-honey)' },
    }
    const style = styles[status] || styles.pending

    const labels: Record<string, string> = {
      ok: 'OK',
      auth_failed: 'Autentisering feilet',
      error: 'Feil',
      pending: 'Venter',
    }

    return (
      <span
        className="text-xs px-2 py-1 rounded-full font-medium"
        style={{ background: style.bg, color: style.text }}
      >
        {labels[status] || status}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-20 rounded-xl" style={{ background: 'var(--background)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Existing integrations */}
      {integrations.map((integration) => (
        <div
          key={integration.id}
          className="p-4 rounded-xl"
          style={{ background: 'var(--background)' }}
        >
          {editingId === integration.id ? (
            // Edit mode
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium" style={{ color: 'var(--foreground)' }}>
                  Rediger barnekoblinger
                </h4>
                <button
                  onClick={() => {
                    setEditingId(null)
                    setIskoleChildren([])
                    setEditMappings({})
                  }}
                  className="text-sm"
                  style={{ color: 'var(--muted)' }}
                >
                  Avbryt
                </button>
              </div>

              {loadingChildren ? (
                <div className="animate-pulse h-24 rounded-lg" style={{ background: 'var(--card)' }} />
              ) : (
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
                          value={editMappings[iskoleChild.id] || ''}
                          onChange={(e) =>
                            setEditMappings({ ...editMappings, [iskoleChild.id]: e.target.value })
                          }
                          className="input text-sm py-1"
                          style={{ minWidth: '150px' }}
                        >
                          <option value="">-- Ikke koblet --</option>
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
              )}

              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="btn btn-primary text-sm"
              >
                {saving ? 'Lagrer...' : 'Lagre endringer'}
              </button>
            </div>
          ) : (
            // View mode
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-medium" style={{ color: 'var(--foreground)' }}>
                      {integration.display_name}
                    </h4>
                    <StatusBadge status={integration.last_sync_status} />
                  </div>
                  <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                    Bruker: {integration.account_email?.substring(0, 6)}***
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    Sist synkronisert: {formatDate(integration.last_sync_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSync(integration.id)}
                    disabled={syncing}
                    className="btn btn-secondary text-sm"
                  >
                    {syncing ? 'Synker...' : 'Synk'}
                  </button>
                  <button
                    onClick={() => handleStartEdit(integration)}
                    className="p-2 rounded-lg transition-colors hover:bg-[var(--sand)]"
                    style={{ color: 'var(--muted)' }}
                    title="Rediger"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(integration.id)}
                    className="p-2 rounded-lg transition-colors hover:bg-red-50"
                    style={{ color: 'var(--color-coral)' }}
                    title="Slett"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3,6 5,6 21,6" />
                      <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ))}

      {/* Connect form */}
      {showConnectForm ? (
        <div
          className="p-4 rounded-xl space-y-4"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <h4 className="font-medium" style={{ color: 'var(--foreground)' }}>
              Koble til iSkole
            </h4>
            <button
              onClick={() => {
                setShowConnectForm(false)
                setTestResult(null)
                setUsername('')
                setPassword('')
                setConnectionError(null)
              }}
              className="text-sm"
              style={{ color: 'var(--muted)' }}
            >
              Avbryt
            </button>
          </div>

          {!testResult ? (
            // Step 1: Enter credentials
            <form onSubmit={handleTestConnection} className="space-y-4">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>
                  Fødselsnummer (11 siffer)
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="12345678901"
                  className="input"
                  maxLength={11}
                  pattern="\d{11}"
                  required
                />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>
                  Passord
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ditt iSkole-passord"
                  className="input"
                  required
                />
              </div>

              {connectionError && (
                <p className="text-sm" style={{ color: 'var(--color-coral)' }}>
                  {connectionError}
                </p>
              )}

              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Bruk samme innlogging som på iskole.net/forelder. Passordet lagres kryptert.
              </p>

              <button
                type="submit"
                disabled={connecting || username.length !== 11 || !password}
                className="btn btn-primary"
              >
                {connecting ? 'Kobler til...' : 'Test tilkobling'}
              </button>
            </form>
          ) : (
            // Step 2: Map children
            <div className="space-y-4">
              <div
                className="p-3 rounded-lg"
                style={{ background: 'rgba(131, 166, 151, 0.15)' }}
              >
                <p className="text-sm font-medium" style={{ color: 'var(--color-sage)' }}>
                  Tilkobling vellykket!
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--foreground)' }}>
                  Logget inn som: {testResult.parent.name}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>
                  Koble iSkole-elever til dine barn:
                </p>
                <div className="space-y-3">
                  {testResult.children.map((iskoleChild) => (
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
                          value={selectedMappings[iskoleChild.id] || ''}
                          onChange={(e) =>
                            setSelectedMappings({
                              ...selectedMappings,
                              [iskoleChild.id]: e.target.value,
                            })
                          }
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

              <div className="flex gap-2">
                <button
                  onClick={handleSaveIntegration}
                  disabled={saving}
                  className="btn btn-primary"
                >
                  {saving ? 'Lagrer...' : 'Lagre tilkobling'}
                </button>
                <button
                  onClick={() => setTestResult(null)}
                  className="btn btn-secondary"
                >
                  Tilbake
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Add new button
        <button
          onClick={() => setShowConnectForm(true)}
          className="w-full p-4 rounded-xl border-2 border-dashed transition-colors hover:border-[var(--accent)] hover:bg-[var(--sand)]"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-center gap-2" style={{ color: 'var(--muted)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Koble til iSkole-konto</span>
          </div>
        </button>
      )}

      {/* Sync all button */}
      {integrations.length > 0 && !showConnectForm && (
        <div className="pt-2">
          <button
            onClick={() => handleSync()}
            disabled={syncing}
            className="btn btn-secondary text-sm w-full"
          >
            {syncing ? 'Synkroniserer...' : 'Synkroniser alle iSkole-kontoer'}
          </button>
        </div>
      )}
    </div>
  )
}
