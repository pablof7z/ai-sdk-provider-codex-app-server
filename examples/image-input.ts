/**
 * Run with: npx tsx examples/image-input.ts
 */

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
  },
});

const model = provider('gpt-5.1-codex-max');

const imageDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

const result = await generateText({
  model,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe the image in one sentence.' },
        { type: 'file', mediaType: 'image/png', data: imageDataUrl },
      ],
    },
  ],
});

console.log(result.text.trim());
