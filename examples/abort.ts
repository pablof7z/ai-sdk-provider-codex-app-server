/**
 * Run with: npx tsx examples/abort.ts
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

const controller = new AbortController();
setTimeout(() => controller.abort('Stopped by user'), 1500);

try {
  const result = await streamText({
    model,
    prompt: 'Write a detailed explanation of TCP congestion control.',
    abortSignal: controller.signal,
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
} catch (error) {
  console.error('Stream aborted:', error);
} finally {
  model.dispose();
}
