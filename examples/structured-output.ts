/**
 * Run with: npx tsx examples/structured-output.ts
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
    reasoningEffort: 'high',
  },
});

const model = provider('gpt-5.1-codex-max');

const schema = z.object({
  title: z.string(),
  owner: z.string(),
  steps: z.array(z.string()),
});

try {
  const { object } = await generateObject({
    model,
    schema,
    prompt: 'Return a small onboarding checklist for a new engineer.',
  });

  console.log(object);
} finally {
  model.dispose();
}
