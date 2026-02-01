'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/lib/i18n/context'
import type { ApiKeyScope } from '@/lib/types'

interface ApiKey {
  id: string
  key_prefix: string
  name: string
  scopes: ApiKeyScope[]
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

interface Webhook {
  id: string
  url: string
  events: string[]
  name: string | null
  created_at: string
  last_triggered_at: string | null
  last_status: number | null
  failure_count: number
  disabled_at: string | null
}

interface FamilyApiSectionProps {
  householdId: string
  isDemo: boolean
  onMessage: (type: 'success' | 'error', text: string) => void
}

const AVAILABLE_SCOPES: ApiKeyScope[] = [
  'pickups:read',
  'pickups:write',
  'children:read',
  'members:read',
  'meals:read',
  'meals:write',
  'tasks:read',
  'tasks:write',
  'events:read',
  'events:write',
]

// Currently implemented webhook events (pickup-only for now)
// Future: meal.*, task.*, event.* will be added when those features dispatch webhooks
const AVAILABLE_EVENTS = [
  'pickup.created',
  'pickup.updated',
  'pickup.deleted',
]

// Helper to get translated scope label
function getScopeLabel(scope: ApiKeyScope, t: ReturnType<typeof useLanguage>['t']): string {
  const labels: Record<ApiKeyScope, string> = {
    'pickups:read': t.familyApi?.scopePickupsRead || 'Read pickups',
    'pickups:write': t.familyApi?.scopePickupsWrite || 'Write pickups',
    'children:read': t.familyApi?.scopeChildrenRead || 'Read children',
    'members:read': t.familyApi?.scopeMembersRead || 'Read members',
    'meals:read': t.familyApi?.scopeMealsRead || 'Read meals',
    'meals:write': t.familyApi?.scopeMealsWrite || 'Write meals',
    'tasks:read': t.familyApi?.scopeTasksRead || 'Read tasks',
    'tasks:write': t.familyApi?.scopeTasksWrite || 'Write tasks',
    'events:read': t.familyApi?.scopeEventsRead || 'Read events',
    'events:write': t.familyApi?.scopeEventsWrite || 'Write events',
  }
  return labels[scope] || scope
}

// Helper to get translated event label
function getEventLabel(event: string, t: ReturnType<typeof useLanguage>['t']): string {
  const labels: Record<string, string> = {
    'pickup.created': t.familyApi?.eventPickupCreated || 'Pickup created',
    'pickup.updated': t.familyApi?.eventPickupUpdated || 'Pickup updated',
    'pickup.deleted': t.familyApi?.eventPickupDeleted || 'Pickup deleted',
  }
  return labels[event] || event
}

// API Documentation component
function ApiDocumentation({ baseUrl, onCopy }: { baseUrl: string; onCopy: (text: string) => void }) {
  const [showDocs, setShowDocs] = useState(false)
  const { t } = useLanguage()

  const endpoints = [
    {
      method: 'GET',
      path: '/api/family/context',
      description: t.familyApi?.docsContextDesc || 'Get API documentation and household context for AI assistants',
      scope: null,
    },
    {
      method: 'GET',
      path: '/api/family/children',
      description: t.familyApi?.docsChildrenDesc || 'List all children in the household',
      scope: 'children:read',
    },
    {
      method: 'GET',
      path: '/api/family/members',
      description: t.familyApi?.docsMembersDesc || 'List all household members',
      scope: 'members:read',
    },
    {
      method: 'GET',
      path: '/api/family/pickups',
      description: t.familyApi?.docsPickupsGetDesc || 'Get pickups for a date range',
      scope: 'pickups:read',
      params: '?from=YYYY-MM-DD&to=YYYY-MM-DD',
    },
    {
      method: 'POST',
      path: '/api/family/pickups',
      description: t.familyApi?.docsPickupsPostDesc || 'Create or update a pickup assignment',
      scope: 'pickups:write',
    },
    {
      method: 'DELETE',
      path: '/api/family/pickups',
      description: t.familyApi?.docsPickupsDeleteDesc || 'Delete a pickup',
      scope: 'pickups:write',
      params: '?id=UUID',
    },
  ]

  const exampleCode = `# Get API context (for AI assistants)
curl -H "Authorization: Bearer fam_xxxxx" \\
  "${baseUrl}/api/family/context"

# Get children
curl -H "Authorization: Bearer fam_xxxxx" \\
  "${baseUrl}/api/family/children"

# Get this week's pickups
curl -H "Authorization: Bearer fam_xxxxx" \\
  "${baseUrl}/api/family/pickups?from=2024-01-15&to=2024-01-21"

# Assign a pickup
curl -X POST -H "Authorization: Bearer fam_xxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"child_id": "uuid", "date": "2024-01-15", "picker_id": "uuid"}' \\
  "${baseUrl}/api/family/pickups"`

  return (
    <div className="pt-6" style={{ borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setShowDocs(!showDocs)}
        className="flex items-center justify-between w-full"
      >
        <div className="text-left">
          <h3 className="text-lg font-medium" style={{ color: 'var(--foreground)' }}>
            {t.familyApi?.apiDocs || 'API Documentation'}
          </h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t.familyApi?.apiDocsDescription || 'Endpoints and examples for integrating with the API'}
          </p>
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          style={{
            transform: showDocs ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {showDocs && (
        <div className="mt-4 space-y-6">
          {/* Base URL */}
          <div>
            <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.familyApi?.baseUrl || 'Base URL'}
            </h4>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 px-3 py-2 rounded-lg text-sm font-mono"
                style={{ background: 'var(--card-alt)', color: 'var(--foreground)' }}
              >
                {baseUrl}
              </code>
              <button onClick={() => onCopy(baseUrl)} className="btn btn-secondary text-sm">
                {t.familyApi?.copyKey || 'Copy'}
              </button>
            </div>
          </div>

          {/* Authentication */}
          <div>
            <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.familyApi?.authentication || 'Authentication'}
            </h4>
            <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--card-alt)' }}>
              <p style={{ color: 'var(--foreground)' }}>
                {t.familyApi?.authDescription || 'Include your API key in the Authorization header:'}
              </p>
              <code className="block mt-2 font-mono text-xs" style={{ color: 'var(--muted)' }}>
                Authorization: Bearer fam_xxxxx
              </code>
            </div>
          </div>

          {/* Endpoints */}
          <div>
            <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.familyApi?.endpoints || 'Endpoints'}
            </h4>
            <div className="space-y-2">
              {endpoints.map((ep, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg"
                  style={{ background: 'var(--card-alt)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        background: ep.method === 'GET' ? 'var(--color-sage)' :
                                   ep.method === 'POST' ? 'var(--color-sky)' :
                                   'var(--color-coral)',
                        color: 'white',
                      }}
                    >
                      {ep.method}
                    </span>
                    <code className="text-sm font-mono" style={{ color: 'var(--foreground)' }}>
                      {ep.path}{ep.params || ''}
                    </code>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {ep.description}
                  </p>
                  {ep.scope && (
                    <span
                      className="inline-block mt-1 px-2 py-0.5 rounded text-xs"
                      style={{ background: 'var(--background)', color: 'var(--muted)' }}
                    >
                      {t.familyApi?.requiresScope || 'Requires'}: {ep.scope}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Examples */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                {t.familyApi?.examples || 'Examples'}
              </h4>
              <button onClick={() => onCopy(exampleCode)} className="btn btn-secondary text-xs">
                {t.familyApi?.copyAll || 'Copy All'}
              </button>
            </div>
            <pre
              className="p-3 rounded-lg overflow-x-auto text-xs font-mono"
              style={{ background: 'var(--card-alt)', color: 'var(--muted)' }}
            >
              {exampleCode}
            </pre>
          </div>

          {/* Response format */}
          <div>
            <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.familyApi?.responseFormat || 'Response Format'}
            </h4>
            <pre
              className="p-3 rounded-lg overflow-x-auto text-xs font-mono"
              style={{ background: 'var(--card-alt)', color: 'var(--muted)' }}
            >
{`{
  "data": { ... },  // Response data
  "meta": {         // Optional metadata
    "count": 5,
    "from": "2024-01-15",
    "to": "2024-01-21"
  }
}`}
            </pre>
          </div>

          {/* Webhook details */}
          <div>
            <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              {t.familyApi?.webhookSignature || 'Webhook Verification'}
            </h4>
            <div className="p-3 rounded-lg text-sm space-y-3" style={{ background: 'var(--card-alt)' }}>
              <div>
                <p className="font-medium text-xs mb-1" style={{ color: 'var(--foreground)' }}>Headers</p>
                <ul className="text-xs space-y-1" style={{ color: 'var(--muted)' }}>
                  <li><code>X-Familjen-Signature</code> - HMAC signature (sha256=...)</li>
                  <li><code>X-Familjen-Timestamp</code> - Unix timestamp (seconds)</li>
                  <li><code>X-Familjen-Event</code> - Event type</li>
                  <li><code>X-Familjen-Delivery</code> - UUID for idempotency</li>
                  <li><code>X-Familjen-Retry</code> - Retry count (0 = first attempt)</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-xs mb-1" style={{ color: 'var(--foreground)' }}>Signature verification</p>
                <pre className="text-xs font-mono overflow-x-auto" style={{ color: 'var(--muted)' }}>
{`const crypto = require('crypto')
const timestamp = req.headers['x-familjen-timestamp']
const rawBody = req.body  // Raw string, not parsed

// Reject old timestamps (replay protection)
if (Math.abs(Date.now() / 1000 - timestamp) > 300) {
  return res.status(401).send('Timestamp too old')
}

const expected = crypto
  .createHmac('sha256', webhookSecret)
  .update(\`\${timestamp}.\${rawBody}\`)
  .digest('hex')
const isValid = req.headers['x-familjen-signature'] === \`sha256=\${expected}\``}
                </pre>
              </div>
              <div>
                <p className="font-medium text-xs mb-1" style={{ color: 'var(--foreground)' }}>Retry behavior</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Failed deliveries retry up to 3 times with exponential backoff (1s, 2s, 4s).
                  5xx and 429 errors trigger retries. 4xx errors (except 429) do not retry.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function FamilyApiSection({ householdId, isDemo, onMessage }: FamilyApiSectionProps) {
  const { t, language } = useLanguage()
  const supabase = useMemo(() => createClient(), [])

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loadingKeys, setLoadingKeys] = useState(true)
  const [showNewKeyForm, setShowNewKeyForm] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyScopes, setNewKeyScopes] = useState<ApiKeyScope[]>([])
  const [creatingKey, setCreatingKey] = useState(false)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)

  // Webhooks state
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loadingWebhooks, setLoadingWebhooks] = useState(true)
  const [showNewWebhookForm, setShowNewWebhookForm] = useState(false)
  const [newWebhookUrl, setNewWebhookUrl] = useState('')
  const [newWebhookName, setNewWebhookName] = useState('')
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>(['pickup.created', 'pickup.updated', 'pickup.deleted'])
  const [creatingWebhook, setCreatingWebhook] = useState(false)
  const [newlyCreatedSecret, setNewlyCreatedSecret] = useState<string | null>(null)

  // Load API keys
  useEffect(() => {
    if (isDemo) {
      setLoadingKeys(false)
      setLoadingWebhooks(false)
      return
    }

    const loadKeys = async () => {
      try {
        const response = await fetch('/api/family/keys')
        if (response.ok) {
          const data = await response.json()
          setApiKeys(data.data || [])
        }
      } catch (error) {
        console.error('Failed to load API keys:', error)
      } finally {
        setLoadingKeys(false)
      }
    }

    const loadWebhooks = async () => {
      try {
        const response = await fetch('/api/family/webhooks')
        if (response.ok) {
          const data = await response.json()
          setWebhooks(data.data || [])
        }
      } catch (error) {
        console.error('Failed to load webhooks:', error)
      } finally {
        setLoadingWebhooks(false)
      }
    }

    loadKeys()
    loadWebhooks()
  }, [isDemo])

  // Create API key
  const createApiKey = async () => {
    if (isDemo) {
      onMessage('error', t.common.viewOnly || 'View only in demo mode')
      return
    }
    if (!newKeyName.trim()) {
      onMessage('error', t.familyApi?.nameRequired || 'Name is required')
      return
    }
    if (newKeyScopes.length === 0) {
      onMessage('error', t.familyApi?.scopeRequired || 'At least one scope is required')
      return
    }

    setCreatingKey(true)
    try {
      const response = await fetch('/api/family/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          scopes: newKeyScopes,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create API key')
      }

      const result = await response.json()
      setNewlyCreatedKey(result.data.key)
      setApiKeys([...apiKeys, {
        id: result.data.id,
        key_prefix: result.data.prefix,
        name: result.data.name,
        scopes: result.data.scopes,
        created_at: new Date().toISOString(),
        last_used_at: null,
        revoked_at: null,
      }])
      setShowNewKeyForm(false)
      setNewKeyName('')
      setNewKeyScopes([])
      onMessage('success', t.familyApi?.keyCreated || 'API key created')
    } catch (error) {
      onMessage('error', error instanceof Error ? error.message : 'Failed to create API key')
    } finally {
      setCreatingKey(false)
    }
  }

  // Revoke API key
  const revokeApiKey = async (keyId: string) => {
    if (isDemo) {
      onMessage('error', t.common.viewOnly || 'View only in demo mode')
      return
    }
    if (!confirm(t.familyApi?.revokeKeyConfirm || 'Are you sure you want to revoke this API key?')) return

    try {
      const response = await fetch(`/api/family/keys?id=${keyId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to revoke API key')
      }

      setApiKeys(apiKeys.filter(k => k.id !== keyId))
      onMessage('success', t.familyApi?.keyRevoked || 'API key revoked')
    } catch (error) {
      onMessage('error', error instanceof Error ? error.message : 'Failed to revoke API key')
    }
  }

  // Create webhook
  const createWebhook = async () => {
    if (isDemo) {
      onMessage('error', t.common.viewOnly || 'View only in demo mode')
      return
    }
    if (!newWebhookUrl.trim()) {
      onMessage('error', t.familyApi?.urlRequired || 'URL is required')
      return
    }
    if (newWebhookEvents.length === 0) {
      onMessage('error', t.familyApi?.eventRequired || 'At least one event is required')
      return
    }

    setCreatingWebhook(true)
    try {
      const response = await fetch('/api/family/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newWebhookUrl.trim(),
          events: newWebhookEvents,
          name: newWebhookName.trim() || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create webhook')
      }

      const result = await response.json()
      setNewlyCreatedSecret(result.data.secret)
      setWebhooks([...webhooks, {
        id: result.data.id,
        url: result.data.url,
        events: result.data.events,
        name: result.data.name,
        created_at: new Date().toISOString(),
        last_triggered_at: null,
        last_status: null,
        failure_count: 0,
        disabled_at: null,
      }])
      setShowNewWebhookForm(false)
      setNewWebhookUrl('')
      setNewWebhookName('')
      setNewWebhookEvents(['*'])
      onMessage('success', t.familyApi?.webhookCreated || 'Webhook created')
    } catch (error) {
      onMessage('error', error instanceof Error ? error.message : 'Failed to create webhook')
    } finally {
      setCreatingWebhook(false)
    }
  }

  // Delete webhook
  const deleteWebhook = async (webhookId: string) => {
    if (isDemo) {
      onMessage('error', t.common.viewOnly || 'View only in demo mode')
      return
    }
    if (!confirm(t.familyApi?.deleteWebhookConfirm || 'Are you sure you want to delete this webhook?')) return

    try {
      const response = await fetch(`/api/family/webhooks?id=${webhookId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete webhook')
      }

      setWebhooks(webhooks.filter(w => w.id !== webhookId))
      onMessage('success', t.familyApi?.webhookDeleted || 'Webhook deleted')
    } catch (error) {
      onMessage('error', error instanceof Error ? error.message : 'Failed to delete webhook')
    }
  }

  // Toggle scope
  const toggleScope = (scope: ApiKeyScope) => {
    if (newKeyScopes.includes(scope)) {
      setNewKeyScopes(newKeyScopes.filter(s => s !== scope))
    } else {
      setNewKeyScopes([...newKeyScopes, scope])
    }
  }

  // Toggle event
  const toggleEvent = (event: string) => {
    if (newWebhookEvents.includes(event)) {
      setNewWebhookEvents(newWebhookEvents.filter(e => e !== event))
    } else {
      setNewWebhookEvents([...newWebhookEvents, event])
    }
  }

  // Copy to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onMessage('success', t.success?.copied || 'Copied to clipboard')
    } catch {
      onMessage('error', 'Failed to copy')
    }
  }

  // Format date
  const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString(language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-6">
      {/* API Keys Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium" style={{ color: 'var(--foreground)' }}>
              {t.familyApi?.apiKeys || 'API Keys'}
            </h3>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {t.familyApi?.apiKeysDescription || 'Allow external AI assistants to access your family data'}
            </p>
          </div>
          {!showNewKeyForm && !newlyCreatedKey && (
            <button
              onClick={() => setShowNewKeyForm(true)}
              className="btn btn-secondary text-sm"
            >
              {t.familyApi?.createKey || 'Create Key'}
            </button>
          )}
        </div>

        {/* New key form */}
        {showNewKeyForm && (
          <div className="p-4 rounded-xl mb-4" style={{ background: 'var(--card-alt)' }}>
            <div className="space-y-4">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                  {t.familyApi?.keyName || 'Key Name'}
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder={t.familyApi?.keyNamePlaceholder || 'My AI Assistant'}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>
                  {t.familyApi?.scopes || 'Permissions'}
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_SCOPES.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => toggleScope(scope)}
                      className="px-3 py-1.5 rounded-lg text-sm transition-colors"
                      style={{
                        background: newKeyScopes.includes(scope)
                          ? 'var(--accent)'
                          : 'var(--background)',
                        color: newKeyScopes.includes(scope)
                          ? 'white'
                          : 'var(--foreground)',
                        border: `1px solid ${newKeyScopes.includes(scope) ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      {getScopeLabel(scope, t)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowNewKeyForm(false)
                    setNewKeyName('')
                    setNewKeyScopes([])
                  }}
                  className="btn btn-secondary"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={createApiKey}
                  disabled={creatingKey || !newKeyName.trim() || newKeyScopes.length === 0}
                  className="btn btn-primary"
                >
                  {creatingKey ? t.common.loading : t.common.add}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Newly created key (show once) */}
        {newlyCreatedKey && (
          <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(168, 199, 168, 0.2)', border: '1px solid var(--color-sage)' }}>
            <div className="flex items-start gap-3 mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <div>
                <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                  {t.familyApi?.keyCreated || 'API Key Created'}
                </p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  {t.familyApi?.keyCreatedWarning || 'Save this key now - it will only be shown once!'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 px-3 py-2 rounded-lg text-sm font-mono"
                style={{ background: 'var(--background)', color: 'var(--foreground)' }}
              >
                {newlyCreatedKey}
              </code>
              <button
                onClick={() => copyToClipboard(newlyCreatedKey)}
                className="btn btn-secondary text-sm"
              >
                {t.familyApi?.copyKey || 'Copy'}
              </button>
            </div>
            <button
              onClick={() => setNewlyCreatedKey(null)}
              className="btn btn-secondary text-sm mt-3"
            >
              {t.common.dismiss}
            </button>
          </div>
        )}

        {/* API keys list */}
        {loadingKeys ? (
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-current border-t-transparent" />
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="text-center py-6 px-4 rounded-xl" style={{ background: 'var(--card-alt)' }}>
            <svg className="mx-auto mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {t.familyApi?.noKeys || 'No API keys yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {apiKeys.filter(k => !k.revoked_at).map((key) => (
              <div
                key={key.id}
                className="p-4 rounded-xl flex items-center justify-between"
                style={{ background: 'var(--card-alt)' }}
              >
                <div>
                  <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {key.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--background)' }}>
                      {key.key_prefix}...
                    </code>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      {key.last_used_at
                        ? `${t.familyApi?.lastUsed || 'Last used'}: ${formatDate(key.last_used_at)}`
                        : t.familyApi?.neverUsed || 'Never used'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {key.scopes.map(scope => (
                      <span
                        key={scope}
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ background: 'var(--background)', color: 'var(--muted)' }}
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => revokeApiKey(key.id)}
                  className="text-sm transition-opacity hover:opacity-70"
                  style={{ color: 'var(--color-coral)' }}
                >
                  {t.familyApi?.revokeKey || 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhooks Section */}
      <div className="pt-6" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium" style={{ color: 'var(--foreground)' }}>
              {t.familyApi?.webhooks || 'Webhooks'}
            </h3>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {t.familyApi?.webhooksDescription || 'Receive notifications when data changes'}
            </p>
          </div>
          {!showNewWebhookForm && !newlyCreatedSecret && (
            <button
              onClick={() => setShowNewWebhookForm(true)}
              className="btn btn-secondary text-sm"
            >
              {t.familyApi?.createWebhook || 'Create Webhook'}
            </button>
          )}
        </div>

        {/* New webhook form */}
        {showNewWebhookForm && (
          <div className="p-4 rounded-xl mb-4" style={{ background: 'var(--card-alt)' }}>
            <div className="space-y-4">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                  {t.familyApi?.webhookUrl || 'Endpoint URL'}
                </label>
                <input
                  type="url"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  placeholder={t.familyApi?.webhookUrlPlaceholder || 'https://your-server.com/webhook'}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                  {t.familyApi?.webhookName || 'Name (optional)'}
                </label>
                <input
                  type="text"
                  value={newWebhookName}
                  onChange={(e) => setNewWebhookName(e.target.value)}
                  placeholder={t.familyApi?.webhookNamePlaceholder || 'My notification service'}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-xs mb-2" style={{ color: 'var(--muted)' }}>
                  {t.familyApi?.webhookEvents || 'Events'}
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_EVENTS.map((event) => (
                    <button
                      key={event}
                      type="button"
                      onClick={() => toggleEvent(event)}
                      className="px-3 py-1.5 rounded-lg text-sm transition-colors"
                      style={{
                        background: newWebhookEvents.includes(event)
                          ? 'var(--accent)'
                          : 'var(--background)',
                        color: newWebhookEvents.includes(event)
                          ? 'white'
                          : 'var(--foreground)',
                        border: `1px solid ${newWebhookEvents.includes(event) ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      {getEventLabel(event, t)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowNewWebhookForm(false)
                    setNewWebhookUrl('')
                    setNewWebhookName('')
                    setNewWebhookEvents(['pickup.created', 'pickup.updated', 'pickup.deleted'])
                  }}
                  className="btn btn-secondary"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={createWebhook}
                  disabled={creatingWebhook || !newWebhookUrl.trim() || newWebhookEvents.length === 0}
                  className="btn btn-primary"
                >
                  {creatingWebhook ? t.common.loading : t.common.add}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Newly created secret (show once) */}
        {newlyCreatedSecret && (
          <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(168, 199, 168, 0.2)', border: '1px solid var(--color-sage)' }}>
            <div className="flex items-start gap-3 mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <div>
                <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                  {t.familyApi?.webhookCreated || 'Webhook Created'}
                </p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  {t.familyApi?.webhookCreatedWarning || 'Save the secret now - it will only be shown once!'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 px-3 py-2 rounded-lg text-sm font-mono truncate"
                style={{ background: 'var(--background)', color: 'var(--foreground)' }}
              >
                {newlyCreatedSecret}
              </code>
              <button
                onClick={() => copyToClipboard(newlyCreatedSecret)}
                className="btn btn-secondary text-sm"
              >
                {t.familyApi?.copySecret || 'Copy'}
              </button>
            </div>
            <button
              onClick={() => setNewlyCreatedSecret(null)}
              className="btn btn-secondary text-sm mt-3"
            >
              {t.common.dismiss}
            </button>
          </div>
        )}

        {/* Webhooks list */}
        {loadingWebhooks ? (
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-current border-t-transparent" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="text-center py-6 px-4 rounded-xl" style={{ background: 'var(--card-alt)' }}>
            <svg className="mx-auto mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {t.familyApi?.noWebhooks || 'No webhooks yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {webhooks.map((webhook) => (
              <div
                key={webhook.id}
                className="p-4 rounded-xl"
                style={{
                  background: 'var(--card-alt)',
                  opacity: webhook.disabled_at ? 0.6 : 1,
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate" style={{ color: 'var(--foreground)' }}>
                        {webhook.name || webhook.url}
                      </p>
                      {webhook.disabled_at && (
                        <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--color-coral)', color: 'white' }}>
                          {t.familyApi?.disabled || 'Disabled'}
                        </span>
                      )}
                    </div>
                    {webhook.name && (
                      <p className="text-xs truncate mt-1" style={{ color: 'var(--muted)' }}>
                        {webhook.url}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                      <span>
                        {webhook.last_triggered_at
                          ? `${t.familyApi?.lastTriggered || 'Last triggered'}: ${formatDate(webhook.last_triggered_at)}`
                          : t.familyApi?.neverTriggered || 'Never triggered'}
                      </span>
                      {webhook.last_status && (
                        <span style={{ color: webhook.last_status < 400 ? 'var(--color-sage)' : 'var(--color-coral)' }}>
                          HTTP {webhook.last_status}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {webhook.events.map(event => (
                        <span
                          key={event}
                          className="px-2 py-0.5 rounded text-xs"
                          style={{ background: 'var(--background)', color: 'var(--muted)' }}
                        >
                          {event}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteWebhook(webhook.id)}
                    className="text-sm transition-opacity hover:opacity-70"
                    style={{ color: 'var(--color-coral)' }}
                  >
                    {t.familyApi?.deleteWebhook || 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* API Documentation */}
      <ApiDocumentation
        baseUrl={typeof window !== 'undefined' ? window.location.origin : 'https://familjen.eu'}
        onCopy={copyToClipboard}
      />
    </div>
  )
}
