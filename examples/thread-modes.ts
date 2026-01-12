/**
 * Run with: npx tsx examples/thread-modes.ts
 */

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
    reasoningEffort: 'high',
  },
});

const model = provider('gpt-5.1-codex-max');

try {
  await generateText({
    model,
    prompt: 'Remember the word "tangerine" for the next question.',
  });

  const persistent = await generateText({
    model,
    prompt: 'What word did I ask you to remember?',
  });

  const stateless = await generateText({
    model,
    prompt: 'What word did I ask you to remember?',
    providerOptions: {
      'codex-app-server': {
        threadMode: 'stateless',
      },
    },
  });

  console.log('persistent:', persistent.text.trim());
  console.log('stateless:', stateless.text.trim());
} finally {
  model.dispose();
}
