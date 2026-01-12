/**
 * Run with: npx tsx examples/resume-thread.ts
 */

import { generateText } from 'ai';
import { createCodexAppServer, type Session } from 'ai-sdk-provider-codex-app-server';

let session: Session | null = null;

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
    reasoningEffort: 'high',
    onSessionCreated: (s) => {
      session = s;
    },
  },
});

const model = provider('gpt-5.1-codex-max');
let resumedModel: ReturnType<typeof provider> | null = null;

try {
  await generateText({
    model,
    prompt: 'Remember the phrase "orange notebook".',
  });

  if (!session) {
    throw new Error('No session created; cannot resume.');
  }

  const resumeProvider = createCodexAppServer({
    defaultSettings: {
      approvalMode: 'never',
      reasoningEffort: 'high',
      resume: session.threadId,
    },
  });

  resumedModel = resumeProvider('gpt-5.1-codex-max');
  const followUp = await generateText({
    model: resumedModel,
    prompt: 'What phrase did I ask you to remember?',
  });

  console.log(followUp.text.trim());
} finally {
  resumedModel?.dispose();
  model.dispose();
}
