/**
 * Centralized AI model configuration.
 *
 * This module provides functions to get the configured AI model with proper fallbacks.
 * Models are configured in the admin panel (app_settings table) with environment
 * variable fallbacks.
 *
 * All models MUST support structured outputs (json_schema) as the app relies on this.
 * See: https://openrouter.ai/docs/guides/features/structured-outputs
 */

import { SupabaseClient } from '@supabase/supabase-js'

export type ModelType = 'text' | 'vision'

interface ModelConfig {
  settingKey: string
  envVar: string
  description: string
}

const MODEL_CONFIG: Record<ModelType, ModelConfig> = {
  text: {
    settingKey: 'openrouter_model',
    envVar: 'OPENROUTER_DEFAULT_MODEL',
    description: 'text/chat completions',
  },
  vision: {
    settingKey: 'openrouter_vision_model',
    envVar: 'OPENROUTER_DEFAULT_VISION_MODEL',
    description: 'vision/image analysis',
  },
}

/**
 * Get the configured AI model for a given type.
 *
 * Priority:
 * 1. app_settings table (configured in admin panel)
 * 2. Environment variable fallback
 * 3. Throws error if neither is configured (no hardcoded defaults)
 *
 * @param supabase - Supabase client instance
 * @param type - 'text' or 'vision'
 * @returns The model ID string
 * @throws Error if no model is configured
 */
export async function getModel(
  supabase: SupabaseClient,
  type: ModelType
): Promise<string> {
  const config = MODEL_CONFIG[type]

  // Try app_settings first
  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', config.settingKey)
    .single()

  if (setting?.value) {
    return setting.value
  }

  // Fall back to environment variable
  const envModel = process.env[config.envVar]
  if (envModel) {
    return envModel
  }

  // No configuration found - throw helpful error
  throw new Error(
    `No AI model configured for ${config.description}. ` +
      `Set '${config.settingKey}' in admin panel or '${config.envVar}' environment variable.`
  )
}

/**
 * Get the configured AI model, returning null instead of throwing if not configured.
 * Useful for optional AI features.
 */
export async function getModelOrNull(
  supabase: SupabaseClient,
  type: ModelType
): Promise<string | null> {
  try {
    return await getModel(supabase, type)
  } catch {
    return null
  }
}

/**
 * Get model from environment variable only (for use in contexts without DB access).
 * Returns null if not configured.
 */
export function getModelFromEnv(type: ModelType): string | null {
  const config = MODEL_CONFIG[type]
  return process.env[config.envVar] || null
}

/**
 * OpenRouter API call options for structured outputs.
 * Use this to ensure provider supports json_schema.
 */
export const STRUCTURED_OUTPUT_PROVIDER_OPTIONS = {
  provider: {
    require_parameters: true,
  },
} as const
