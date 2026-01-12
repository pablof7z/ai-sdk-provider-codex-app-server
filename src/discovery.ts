/**
 * Discovery APIs for Codex app-server
 */

import { AppServerClient } from './app-server-client.js';
import type { ModelInfo, ModelListResult } from './protocol/index.js';

export interface ListModelsOptions {
  /**
   * Path to the codex binary. If not specified, uses PATH lookup.
   */
  codexPath?: string;

  /**
   * Filter models by provider(s). If not specified, returns all.
   */
  modelProviders?: string[];

  /**
   * Environment variables to pass to the codex process.
   */
  env?: Record<string, string>;
}

export interface ListModelsResult {
  models: ModelInfo[];
  defaultModel: ModelInfo | undefined;
}

/**
 * List available models from the Codex app-server.
 *
 * This is a standalone function that spawns a temporary app-server process
 * to query available models, then disposes of it.
 *
 * @example
 * ```typescript
 * import { listModels } from 'ai-sdk-provider-codex-app-server';
 *
 * const { models, defaultModel } = await listModels();
 *
 * for (const model of models) {
 *   console.log(`${model.id}: ${model.description}`);
 *   const efforts = model.supportedReasoningEfforts.map(e => e.reasoningEffort);
 *   console.log(`  Reasoning: ${efforts.join(', ')} (default: ${model.defaultReasoningEffort})`);
 * }
 * ```
 */
export async function listModels(options: ListModelsOptions = {}): Promise<ListModelsResult> {
  const client = new AppServerClient({
    codexPath: options.codexPath,
    env: options.env,
    logger: false,
  });

  try {
    const result: ModelListResult = await client.listModels({
      modelProviders: options.modelProviders,
    });

    const models = result.data;
    const defaultModel = models.find((m) => m.isDefault);

    return { models, defaultModel };
  } finally {
    client.dispose();
  }
}
