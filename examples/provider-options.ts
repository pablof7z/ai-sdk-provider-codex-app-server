/**
 * Run with: npx tsx examples/provider-options.ts
 */

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
    reasoningEffort: 'low',
  },
});

const model = provider('gpt-5.1-codex-max');

const result = await generateText({
  model,
  prompt: 'Summarize the concept of idempotency in two sentences.',
  providerOptions: {
    'codex-app-server': {
      reasoningEffort: 'high',
      threadMode: 'stateless',
      configOverrides: {
        sandbox_workspace_write: {
          network_access: true,
        },
      },
    },
  },
});

console.log(result.text.trim());
