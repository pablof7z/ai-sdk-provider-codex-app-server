/**
 * Run with: npx tsx examples/list-models.ts
 *
 * Lists all available models from the Codex app-server,
 * including their capabilities like reasoning support.
 */

import { listModels } from 'ai-sdk-provider-codex-app-server';

const { models, defaultModel } = await listModels();

console.log(`Default model: ${defaultModel?.id ?? 'none'}\n`);
console.log('Available models:\n');

for (const model of models) {
  const marker = model.isDefault ? ' (default)' : '';
  console.log(`  ${model.id}${marker}`);
  console.log(`    ${model.description}`);

  const efforts = model.supportedReasoningEfforts.map((e) => e.reasoningEffort);
  console.log(`    Reasoning: ${efforts.join(', ')} (default: ${model.defaultReasoningEffort})`);

  console.log();
}
