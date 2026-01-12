/**
 * Run with: npx tsx examples/generate-text.ts
 */

import { generateText } from 'ai';
import { codexAppServer } from 'ai-sdk-provider-codex-app-server';

const model = codexAppServer('gpt-5.1-codex', {
  approvalMode: 'never',
  sandboxMode: 'workspace-write',
});

const result = await generateText({
  model,
  prompt: 'Reply with a single sentence about deterministic builds.',
});

console.log(result.text);
console.log('finish:', result.finishReason);
