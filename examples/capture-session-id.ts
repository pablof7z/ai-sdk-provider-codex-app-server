/**
 * Demonstrates capturing sessionId from the finish event's providerMetadata
 * for persisting and resuming sessions.
 *
 * Run with: npx tsx examples/capture-session-id.ts
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
  // First conversation
  console.log('--- First conversation ---');
  const result = await streamText({
    model,
    prompt: 'Remember the code word "purple elephant". Just acknowledge.',
  });

  // Capture sessionId from the finish event's providerMetadata
  let sessionId: string | undefined;
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      process.stdout.write(part.textDelta);
    }
    if (part.type === 'finish') {
      sessionId = (part.providerMetadata?.codex as { sessionId?: string })?.sessionId;
    }
  }
  console.log('\n');

  if (!sessionId) {
    throw new Error('No sessionId captured from finish event');
  }

  console.log(`Captured sessionId: ${sessionId}`);
  console.log('(In a real app, you would persist this to your database)\n');

  // Resume the session using the captured sessionId
  console.log('--- Resuming session ---');
  const resumedResult = await streamText({
    model,
    prompt: 'What was the code word I told you to remember?',
    providerOptions: {
      'codex-app-server': {
        resume: sessionId,
      },
    },
  });

  for await (const part of resumedResult.fullStream) {
    if (part.type === 'text-delta') {
      process.stdout.write(part.textDelta);
    }
  }
  console.log('\n');
} finally {
  model.dispose();
}
