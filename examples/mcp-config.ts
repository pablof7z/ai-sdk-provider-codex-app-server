/**
 * Run with: npx tsx examples/mcp-config.ts
 */

import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
    rmcpClient: true,
    mcpServers: {
      local: {
        transport: 'stdio',
        command: 'node',
        args: ['tools/mcp-server.js'],
      },
      docs: {
        transport: 'http',
        url: 'https://mcp.example.com',
        bearerTokenEnvVar: 'MCP_TOKEN',
      },
    },
  },
});

const model = provider('gpt-5.1-codex-max');

const result = await streamText({
  model,
  prompt: 'Use MCP tools to fetch a short summary of our internal docs.',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
