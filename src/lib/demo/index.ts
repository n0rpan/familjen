/**
 * Demo Mode exports
 */

export { DemoDataProvider, useDemo, useIsDemo } from './context'
export { generateDemoState, DEMO_IDS } from './generator'
export { loadDemoState, saveDemoState, clearDemoState, isDemoMode } from './storage'
export type { DemoState, DemoDataContextValue, DemoRateLimitState, ShoppingListWithItems, AdminHousehold } from './types'
export { DEMO_STATE_VERSION, DEMO_STORAGE_KEY } from './types'
