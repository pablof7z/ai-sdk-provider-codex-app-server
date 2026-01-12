/**
 * Run with: npx tsx examples/tool-streaming.ts
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
    prompt: 'List files in the project root and report the largest one.',
  });

  for await (const part of result.fullStream) {
    if (part.type === 'tool-call') {
      console.log(`\n[tool-call] ${part.toolName}: ${part.input}`);
    } else if (part.type === 'tool-result') {
      console.log(`\n[tool-result] ${part.toolName}:`, part.output);
    } else if (part.type === 'text-delta' && part.text) {
      process.stdout.write(part.text);
    }
  }
} finally {
  model.dispose();
}
