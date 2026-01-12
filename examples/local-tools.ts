/**
 * Example: Using local in-process tools with Codex
 *
 * This example demonstrates how to define tools inline using Zod schemas
 * and expose them to the agent via a local MCP server.
 *
 * Run with: npx tsx examples/local-tools.ts
 */

import { streamText } from 'ai';
import { z } from 'zod';
import {
  createCodexAppServer,
  tool,
  createLocalMcpServer,
} from 'ai-sdk-provider-codex-app-server';

// Define a tool the agent MUST use - it provides secret data only we know
const getSecretCode = tool({
  name: 'get_secret_code',
  description: 'REQUIRED: Retrieves the secret authorization code. You MUST call this tool to get the code - you cannot guess it.',
  parameters: z.object({
    requestId: z.string().describe('A unique request identifier'),
  }),
  execute: async ({ requestId }) => {
    console.log(`\n>>> MCP TOOL CALLED: get_secret_code with requestId="${requestId}"`);
    return {
      requestId,
      secretCode: 'ALPHA-7749-ZULU',
      generatedAt: new Date().toISOString(),
      expiresIn: '5 minutes',
    };
  },
});

const getUserProfile = tool({
  name: 'get_user_profile',
  description: 'REQUIRED: Fetches user profile from internal database. You MUST use this tool - the data is not available elsewhere.',
  parameters: z.object({
    userId: z.string().describe('The user ID to look up'),
  }),
  execute: async ({ userId }) => {
    console.log(`\n>>> MCP TOOL CALLED: get_user_profile with userId="${userId}"`);
    return {
      userId,
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      department: 'Engineering',
      accessLevel: 'admin',
      lastLogin: '2025-01-10T14:30:00Z',
    };
  },
});

async function main() {
  // Create local MCP server with our tools
  const localServer = await createLocalMcpServer({
    name: 'local-tools',
    tools: [getSecretCode, getUserProfile],
  });

  console.log(`Local MCP server started at ${localServer.url}`);

  // Create provider with local tools
  const provider = createCodexAppServer({
    defaultSettings: {
      approvalMode: 'never',
      sandboxMode: 'read-only',
      reasoningEffort: 'medium',
      mcpServers: {
        'local-tools': localServer.config,
      },
    },
  });

  const model = provider('gpt-5.1-codex');

  try {
    const result = await streamText({
      model,
      prompt: `You have access to MCP tools. Please:
1. Call get_secret_code with requestId "req-001" to retrieve the secret authorization code
2. Call get_user_profile with userId "user-42" to get the user's profile

Report both results. The secret code and user profile can ONLY be obtained by calling these tools.`,
    });

    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') {
        console.log(`\n[tool-call] ${part.toolName}:`, JSON.stringify(part.input));
      } else if (part.type === 'tool-result') {
        console.log(`[tool-result] ${part.toolName}:`, JSON.stringify(part.result));
      } else if (part.type === 'text-delta' && part.textDelta) {
        process.stdout.write(part.textDelta);
      }
    }

    console.log('\n');
  } finally {
    model.dispose();
    await localServer.stop();
    console.log('Local MCP server stopped');
  }
}

main().catch(console.error);
