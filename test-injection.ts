/**
 * Test script for mid-execution message injection
 *
 * Run with: npx tsx test-injection.ts
 */

import { createCodexAppServer, type Session } from './src/index.js';
import { streamText } from 'ai';

async function main() {
  let session: Session | null = null;

  console.log('Creating Codex App Server provider...\n');

  const provider = createCodexAppServer({
    defaultSettings: {
      cwd: process.cwd(),
      approvalMode: 'never',
      sandboxMode: 'workspace-write',
      verbose: false,
      onSessionCreated: (s) => {
        session = s;
        console.log(`\n[Session created] threadId: ${s.threadId}\n`);
      },
    },
  });

  // Use the default model from codex config
  const model = provider('gpt-5.2-codex');

  console.log('Starting stream with prompt: "Write a simple Python function that adds two numbers"\n');
  console.log('---OUTPUT START---\n');

  // Start streaming
  const result = await streamText({
    model,
    prompt: 'Write a simple Python function that adds two numbers. Take your time and explain each step.',
  });

  // Set up injection after 3 seconds
  const injectionTimeout = setTimeout(async () => {
    if (session && session.isActive()) {
      console.log('\n\n[INJECTING MESSAGE: "Also add a multiply function"]\n\n');
      try {
        await session.injectMessage('Also add a multiply function');
      } catch (err) {
        console.error('[Injection error]', err);
      }
    } else {
      console.log('\n[Session not active, skipping injection]\n');
    }
  }, 3000);

  // Stream output
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }

  clearTimeout(injectionTimeout);

  console.log('\n\n---OUTPUT END---\n');
  console.log('Finish reason:', await result.finishReason);

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
