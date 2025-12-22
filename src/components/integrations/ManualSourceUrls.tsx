'use client'

import { memo, useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Child } from '@/lib/types'

type UrlType = 'calendar_page' | 'pdf' | 'ics'

interface SourceUrl {
  id: string
  url: string
  display_name: string
  url_type: UrlType
  auto_sync: boolean
  sync_frequency_days: number
  last_sync_at: string | null
  last_sync_status: string | null
  child_id: string | null
  created_at: string
}

interface ManualSourceUrlsProps {
  householdId: string
  children: Child[]
  onMessage: (type: 'success' | 'error', text: string) => void
}

export const ManualSourceUrls = memo(function ManualSourceUrls({
  householdId,
  children,
  onMessage,
}: ManualSourceUrlsProps) {
  const [sourceUrls, setSourceUrls] = useState<SourceUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<UrlType>('calendar_page')
  const [newChildId, setNewChildId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    loadSourceUrls()
  }, [householdId])

  const loadSourceUrls = async () => {
    const { data, error } = await supabase
      .from('external_source_urls')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })

    if (!error && data) {
      setSourceUrls(data)
    }
    setLoading(false)
  }

  const addSourceUrl = async () => {
    if (!newUrl || !newName) return

    // Validate URL
    try {
      new URL(newUrl)
    } catch {
      onMessage('error', 'Ugyldig URL')
      return
    }

    setSaving(true)

    const { error } = await supabase
      .from('external_source_urls')
      .insert({
        household_id: householdId,
        url: newUrl,
        display_name: newName,
        url_type: newType,
        child_id: newChildId,
        auto_sync: true,
        sync_frequency_days: 7,
      })

    if (error) {
      if (error.code === '23505') {
        onMessage('error', 'Denne URL-en er allerede lagt til')
      } else {
        onMessage('error', 'Kunne ikke legge til kilde')
      }
    } else {
      onMessage('success', 'Kilde lagt til')
      setNewUrl('')
      setNewName('')
      setNewType('calendar_page')
      setNewChildId(null)
      setShowAddForm(false)
      loadSourceUrls()
    }

    setSaving(false)
  }

  const syncSourceUrl = async (id: string) => {
    setSyncing(id)

    try {
      const response = await fetch('/api/integrations/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrlId: id }),
      })

      const data = await response.json()

      if (response.ok) {
        onMessage('success', data.eventsFound
          ? `${data.eventsFound} hendelser funnet`
          : 'Synkronisert')
        loadSourceUrls()
      } else {
        onMessage('error', data.error || 'Synkronisering feilet')
      }
    } catch {
      onMessage('error', 'Synkronisering feilet')
    }

    setSyncing(null)
  }

  const deleteSourceUrl = async (id: string) => {
    if (!confirm('Er du sikker på at du vil fjerne denne kilden?')) return

    const { error } = await supabase
      .from('external_source_urls')
      .delete()
      .eq('id', id)

    if (error) {
      onMessage('error', 'Kunne ikke fjerne kilde')
    } else {
      onMessage('success', 'Kilde fjernet')
      loadSourceUrls()
    }
  }

  const formatSyncTime = (time: string | null) => {
    if (!time) return 'Aldri'
    const date = new Date(time)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return 'Nettopp'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min siden`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} t siden`
    return `${Math.floor(diff / 86400000)} d siden`
  }

  const getTypeLabel = (type: UrlType) => {
    switch (type) {
      case 'calendar_page':
        return 'Kalenderside'
      case 'pdf':
        return 'PDF'
      case 'ics':
        return 'ICS-kalender'
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-12 rounded-lg" style={{ background: 'var(--sand)' }} />
        <div className="h-12 rounded-lg" style={{ background: 'var(--sand)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Existing source URLs */}
      {sourceUrls.map((source) => (
        <div
          key={source.id}
          className="p-4 rounded-xl"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate" style={{ color: 'var(--foreground)' }}>
                {source.display_name}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                {source.url}
              </p>
            </div>
            <div className="text-right shrink-0">
              <span
                className="inline-block px-2 py-1 rounded-lg text-xs font-medium"
                style={{
                  background: source.last_sync_status === 'ok'
                    ? 'rgba(139, 178, 139, 0.2)'
                    : source.last_sync_status === 'error'
                      ? 'rgba(232, 120, 109, 0.2)'
                      : 'var(--sand)',
                  color: source.last_sync_status === 'ok'
                    ? 'var(--color-sage)'
                    : source.last_sync_status === 'error'
                      ? 'var(--color-coral)'
                      : 'var(--muted)',
                }}
              >
                {source.last_sync_status === 'ok' ? 'OK' : source.last_sync_status === 'error' ? 'Feil' : 'Venter'}
              </span>
              {source.last_sync_at && (
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  {formatSyncTime(source.last_sync_at)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs mb-3" style={{ color: 'var(--muted)' }}>
            <span className="px-2 py-0.5 rounded" style={{ background: 'var(--sand)' }}>
              {getTypeLabel(source.url_type)}
            </span>
            {source.child_id && children.find(c => c.id === source.child_id) && (
              <span className="px-2 py-0.5 rounded" style={{ background: 'var(--sand)' }}>
                {children.find(c => c.id === source.child_id)?.name}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => syncSourceUrl(source.id)}
              disabled={syncing === source.id}
              className="btn btn-secondary text-sm"
            >
              {syncing === source.id ? (
                <>
                  <svg width="14" height="14" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Synkroniserer...
                </>
              ) : (
                'Synkroniser'
              )}
            </button>
            <button
              onClick={() => deleteSourceUrl(source.id)}
              className="btn text-sm"
              style={{ color: 'var(--color-coral)' }}
            >
              Fjern
            </button>
          </div>
        </div>
      ))}

      {/* Add new source URL */}
      {showAddForm ? (
        <div
          className="p-4 rounded-xl space-y-4"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
        >
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              URL
            </label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://skole.no/kalender"
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              Navn
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Skolerute 2025-2026"
              className="input w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                Type
              </label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as UrlType)}
                className="input w-full"
              >
                <option value="calendar_page">Kalenderside</option>
                <option value="pdf">PDF-dokument</option>
                <option value="ics">ICS-kalender</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                Barn (valgfritt)
              </label>
              <select
                value={newChildId || ''}
                onChange={(e) => setNewChildId(e.target.value || null)}
                className="input w-full"
              >
                <option value="">Velg barn</option>
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={addSourceUrl}
              disabled={saving || !newUrl || !newName}
              className="btn btn-primary text-sm"
            >
              {saving ? 'Lagrer...' : 'Legg til'}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false)
                setNewUrl('')
                setNewName('')
                setNewType('calendar_page')
                setNewChildId(null)
              }}
              className="btn btn-secondary text-sm"
            >
              Avbryt
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full p-4 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          style={{
            background: 'var(--background)',
            border: '1px dashed var(--border)',
            color: 'var(--muted)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Legg til kalenderkilde
        </button>
      )}
    </div>
  )
})
