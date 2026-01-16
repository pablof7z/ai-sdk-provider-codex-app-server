/**
 * Demonstrates capturing sessionId from providerMetadata
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

  // Stream the text
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta' && part.text) {
      process.stdout.write(part.text);
    }
  }
  console.log();

  // Capture sessionId from providerMetadata after stream completes
  const providerMetadata = await result.providerMetadata;
  const sessionId = (providerMetadata?.codex as { sessionId?: string })?.sessionId;

  if (!sessionId) {
    throw new Error('No sessionId captured from providerMetadata');
  }

  console.log(`\nCaptured sessionId: ${sessionId}`);
  console.log('(In a real app, you would persist this to your database)\n');

  // Resume the session by creating a new provider with the resume setting
  console.log('--- Resuming session ---');
  const resumeProvider = createCodexAppServer({
    defaultSettings: {
      approvalMode: 'never',
      reasoningEffort: 'high',
      resume: sessionId,
    },
  });

  const resumedModel = resumeProvider('gpt-5.1-codex-max');

  try {
    const resumedResult = await streamText({
      model: resumedModel,
      prompt: 'What was the code word I told you to remember?',
    });

    for await (const part of resumedResult.fullStream) {
      if (part.type === 'text-delta' && part.text) {
        process.stdout.write(part.text);
      }
    }
    console.log();
  } finally {
    resumedModel.dispose();
  }
} finally {
  model.dispose();
}
