/**
 * Run with: npx tsx examples/raw-chunks.ts
 */

import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
  },
});

const model = provider('gpt-5.1-codex');

const result = await streamText({
  model,
  prompt: 'Explain what a JSON-RPC notification is in one paragraph.',
  includeRawChunks: true,
});

for await (const part of result.fullStream) {
  if (part.type === 'raw') {
    console.log('[raw]', part.rawValue);
  } else if (part.type === 'text-delta') {
    process.stdout.write(part.delta);
  }
}
