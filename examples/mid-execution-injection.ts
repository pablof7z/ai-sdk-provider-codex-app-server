/**
 * Run with: npx tsx examples/mid-execution-injection.ts
 */

import { streamText } from 'ai';
import { createCodexAppServer, type Session } from 'ai-sdk-provider-codex-app-server';

let session: Session | null = null;

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
    sandboxMode: 'workspace-write',
    reasoningEffort: 'high',
    onSessionCreated: (s) => {
      session = s;
      console.log(`[session] threadId=${s.threadId}`);
    },
  },
});

const model = provider('gpt-5.1-codex-max');

const timer = setTimeout(async () => {
  if (!session || !session.isActive()) return;
  await session.injectMessage('Also include a square root operation.');
}, 2000);

try {
  const result = await streamText({
    model,
    prompt: 'Write a simple JavaScript calculator function.',
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }

  console.log('\nfinish:', await result.finishReason);
} finally {
  clearTimeout(timer);
  model.dispose();
}
