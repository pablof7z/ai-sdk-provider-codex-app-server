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

try {
  const result = await streamText({
    model,
    prompt:
      'Use the shell to list files in the project root, then summarize what you see in 3 bullet points. Do not write or modify files.',
  });

  let injected = false;

  for await (const part of result.fullStream) {
    if (!injected && part.type === 'tool-call' && session?.isActive()) {
      injected = true;
      console.log('\n[session] injecting update...\n');
      await session.injectMessage('Also call out any README or markdown files explicitly.');
    }
    if (part.type === 'text-delta' && part.text) {
      process.stdout.write(part.text);
    } else if (part.type === 'tool-call') {
      console.log(`\n[tool-call] ${part.toolName}: ${part.input}`);
    } else if (part.type === 'tool-result') {
      console.log(`\n[tool-result] ${part.toolName}:`, part.output);
    }
  }

  console.log('\nfinish:', await result.finishReason);
} finally {
  model.dispose();
}
