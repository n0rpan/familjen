/**
 * Shared types for integration components
 */

export interface Integration {
  id: string
  displayName: string
  accountEmail: string | null
  lastSyncAt: string | null
  lastSyncStatus: string
  lastSyncError?: string | null
}

export interface IntegrationMapping {
  id?: string
  childId: string | null
  memberId: string | null
  groupId: string | null
  groupName: string | null
}

export type ServiceName = 'spond' | 'mykid' | 'kidplan' | 'iskole'

export interface IntegrationConfig {
  service: ServiceName
  displayName: string
  syncEndpoint: string
  testConnectionEndpoint: string
  groupsEndpoint: string
  credentialFields: CredentialField[]
  supportsChildMapping: boolean
  supportsMemberMapping: boolean
}

export interface CredentialField {
  key: string
  label: string
  type: 'email' | 'text' | 'password' | 'tel'
  placeholder: string
}

// Service configurations
export const SERVICE_CONFIGS: Record<ServiceName, IntegrationConfig> = {
  spond: {
    service: 'spond',
    displayName: 'Spond',
    syncEndpoint: '/api/integrations/spond/sync',
    testConnectionEndpoint: '/api/integrations/spond/test-connection',
    groupsEndpoint: '/api/integrations/spond/groups',
    credentialFields: [
      { key: 'email', label: 'E-post', type: 'email', placeholder: 'din@epost.no' },
      { key: 'password', label: 'Passord', type: 'password', placeholder: '••••••••' },
    ],
    supportsChildMapping: true,
    supportsMemberMapping: true,
  },
  mykid: {
    service: 'mykid',
    displayName: 'MyKid',
    syncEndpoint: '/api/integrations/mykid/sync',
    testConnectionEndpoint: '/api/integrations/mykid/test-connection',
    groupsEndpoint: '/api/integrations/mykid/groups',
    credentialFields: [
      { key: 'phone', label: 'Mobilnummer', type: 'tel', placeholder: '12345678' },
      { key: 'password', label: 'Passord', type: 'password', placeholder: '••••••••' },
    ],
    supportsChildMapping: true,
    supportsMemberMapping: false,
  },
  kidplan: {
    service: 'kidplan',
    displayName: 'Kidplan',
    syncEndpoint: '/api/integrations/kidplan/sync',
    testConnectionEndpoint: '/api/integrations/kidplan/test-connection',
    groupsEndpoint: '/api/integrations/kidplan/groups',
    credentialFields: [
      { key: 'email', label: 'E-post', type: 'email', placeholder: 'din@epost.no' },
      { key: 'password', label: 'Passord', type: 'password', placeholder: '••••••••' },
    ],
    supportsChildMapping: true,
    supportsMemberMapping: false,
  },
  iskole: {
    service: 'iskole',
    displayName: 'iSkole',
    syncEndpoint: '/api/integrations/iskole/sync',
    testConnectionEndpoint: '/api/integrations/iskole/test-connection',
    groupsEndpoint: '/api/integrations/iskole/groups',
    credentialFields: [
      { key: 'username', label: 'Brukernavn', type: 'text', placeholder: 'brukernavn' },
      { key: 'password', label: 'Passord', type: 'password', placeholder: '••••••••' },
    ],
    supportsChildMapping: true,
    supportsMemberMapping: false,
  },
}
