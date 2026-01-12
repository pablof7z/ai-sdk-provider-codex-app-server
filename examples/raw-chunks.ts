/**
 * Run with: npx tsx examples/raw-chunks.ts
 */

import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
    reasoningEffort: 'high',
  },
});

const model = provider('gpt-5.1-codex-max');

try {
  const result = await streamText({
    model,
    prompt: 'Explain what a JSON-RPC notification is in one paragraph.',
    includeRawChunks: true,
  });

  for await (const part of result.fullStream) {
    if (part.type === 'raw') {
      console.log('[raw]', part.rawValue);
  } else if (part.type === 'text-delta' && part.text) {
    process.stdout.write(part.text);
  }
}
} finally {
  model.dispose();
}
