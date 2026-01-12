/**
 * Run with: npx tsx examples/stream-text.ts
 */

import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
    sandboxMode: 'workspace-write',
    reasoningEffort: 'high',
  },
});

const model = provider('gpt-5.1-codex-max');

try {
  const result = await streamText({
    model,
    prompt: 'Write a short haiku about refactoring.',
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }

  console.log('\nfinish:', await result.finishReason);
} finally {
  model.dispose();
}
