/**
 * Spond Integration
 *
 * TypeScript client for the unofficial Spond API.
 * See README.md for documentation and troubleshooting.
 */

export { SpondClient } from './client'
export {
  // Types
  type SpondGroup,
  type SpondGroupMember,
  type SpondSubGroup,
  type SpondGuardian,
  type SpondEvent,
  type SpondLocation,
  type SpondEventResponse,
  type SpondTask,
  type SpondComment,
  type SpondChat,
  type SpondMessage,
  type SpondClientOptions,
  type GetEventsOptions,
  type GetChatsOptions,
  type MappedSpondEvent,
  type MappedSpondMessage,
  // Errors
  SpondError,
  SpondAuthError,
} from './types'
