/**
 * Provider factory for Codex App Server
 */

import type { ProviderV3 } from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { CodexAppServerLanguageModel } from './codex-app-server-language-model.js';
import { validateSettings } from './types/index.js';
import type { CodexAppServerSettings, CodexModelId } from './types/index.js';

/**
 * Provider interface for Codex App Server
 */
export interface CodexAppServerProvider extends ProviderV3 {
  /**
   * Create a language model for the given model ID
   */
  (modelId: CodexModelId, settings?: CodexAppServerSettings): CodexAppServerLanguageModel;

  /**
   * Create a language model (explicit method)
   */
  languageModel(modelId: CodexModelId, settings?: CodexAppServerSettings): CodexAppServerLanguageModel;

  /**
   * Alias for languageModel (AI SDK compatibility)
   */
  chat(modelId: CodexModelId, settings?: CodexAppServerSettings): CodexAppServerLanguageModel;

  /**
   * Embedding models are not supported
   */
  embeddingModel(modelId: string): never;

  /**
   * Image models are not supported
   */
  imageModel(modelId: string): never;
}

/**
 * Provider settings for creating a Codex App Server provider
 */
export interface CodexAppServerProviderSettings {
  /**
   * Default settings applied to all models created by this provider
   */
  defaultSettings?: CodexAppServerSettings;
}

/**
 * Create a Codex App Server provider
 *
 * @example
 * ```typescript
 * import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';
 * import { streamText } from 'ai';
 *
 * const provider = createCodexAppServer({
 *   defaultSettings: {
 *     onSessionCreated: (session) => {
 *       // Store session for mid-execution injection
 *       sessionStore.set(agentId, session);
 *     }
 *   }
 * });
 *
 * const model = provider('gpt-5.1-codex');
 *
 * const result = await streamText({
 *   model,
 *   prompt: 'Write a hello world in Python'
 * });
 * ```
 */
export function createCodexAppServer(
  options: CodexAppServerProviderSettings = {}
): CodexAppServerProvider {
  const defaultSettings = options.defaultSettings ?? {};

  const createModel = (
    modelId: CodexModelId,
    settings: CodexAppServerSettings = {}
  ): CodexAppServerLanguageModel => {
    const merged = { ...defaultSettings, ...settings };

    const validation = validateSettings(merged);
    if (!validation.valid) {
      throw new Error(`Invalid CodexAppServerSettings: ${validation.errors.join(', ')}`);
    }

    // Log warnings
    for (const warning of validation.warnings) {
      console.warn(`[codex-app-server] Warning: ${warning}`);
    }

    return new CodexAppServerLanguageModel(modelId, merged);
  };

  const provider = ((modelId: CodexModelId, settings?: CodexAppServerSettings) => {
    return createModel(modelId, settings);
  }) as CodexAppServerProvider;

  provider.languageModel = createModel;
  provider.chat = createModel;

  provider.embeddingModel = ((modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
  }) as never;

  provider.imageModel = ((modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
  }) as never;

  return provider;
}

/**
 * Pre-configured default Codex App Server provider instance
 *
 * @example
 * ```typescript
 * import { codexAppServer } from 'ai-sdk-provider-codex-app-server';
 * import { streamText } from 'ai';
 *
 * const result = await streamText({
 *   model: codexAppServer('gpt-5.1-codex'),
 *   prompt: 'Write a hello world'
 * });
 * ```
 */
export const codexAppServer = createCodexAppServer();
