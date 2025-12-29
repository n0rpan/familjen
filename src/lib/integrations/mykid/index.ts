/**
 * MyKid Integration
 *
 * Exports for the MyKid.no kindergarten integration.
 */

export { MyKidClient } from './client'
export {
  // Types
  type MyKidCredentials,
  type MyKidSession,
  type MyKidChild,
  type MyKidCalendarEvent,
  type MyKidNewsletterSummary,
  type MyKidNewsletter,
  type MyKidAttachment,
  type MyKidPhoto,
  type MyKidPhotoJwt,
  type MyKidUnseenCounts,
  type MyKidConversationMessage,
  type MyKidInfoBusTopic,
  type MappedMyKidMessage,
  type MappedMyKidEvent,
  type MappedMyKidPhoto,
  type MyKidClientOptions,
  // Errors
  MyKidError,
  MyKidAuthError,
  MyKidCsrfError,
} from './types'
