/**
 * Usage and Metadata Example
 *
 * Demonstrates how to access usage information and metadata from Codex responses.
 *
 * Note: Codex app-server does not currently provide token counts like traditional
 * LLM APIs. Instead, it provides metadata about the execution including:
 * - Model and thread/turn identifiers
 * - Tool execution statistics (counts and timing)
 * - Reasoning usage indicators
 *
 * Run with: npx tsx examples/usage-metadata.ts
 */

import { streamText, generateText } from 'ai';
import { createCodexAppServer, type CodexUsageMetadata } from 'ai-sdk-provider-codex-app-server';

const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'never',
    reasoningEffort: 'high',
  },
});

const model = provider('gpt-5.1-codex-max');

// Helper to display metadata
function displayMetadata(usage: { raw?: unknown }): void {
  const metadata = usage.raw as CodexUsageMetadata | undefined;

  if (!metadata) {
    console.log('No metadata available');
    return;
  }

  console.log('\n=== Usage Metadata ===');
  console.log('Model:', metadata.model);
  console.log('Thread ID:', metadata.threadId);
  console.log('Turn ID:', metadata.turnId);
  console.log('Status:', metadata.status);
  console.log('Has Reasoning:', metadata.hasReasoning);
  console.log('Completed At:', metadata.completedAt);

  console.log('\n--- Tool Execution Stats ---');
  console.log('Total Tool Calls:', metadata.toolStats.totalCalls);
  console.log('  Commands:', metadata.toolStats.byType.commands);
  console.log('  File Changes:', metadata.toolStats.byType.fileChanges);
  console.log('  MCP Tools:', metadata.toolStats.byType.mcpTools);
  console.log('  Web Searches:', metadata.toolStats.byType.webSearches);
  if (metadata.toolStats.totalDurationMs > 0) {
    console.log('  Total Duration:', `${metadata.toolStats.totalDurationMs}ms`);
  }
}

try {
  // Example 1: Using streamText
  console.log('=== Example 1: streamText ===\n');

  const streamResult = await streamText({
    model,
    prompt: 'List the files in the current directory using ls.',
  });

  // Consume the stream
  for await (const chunk of streamResult.textStream) {
    process.stdout.write(chunk);
  }

  // Access usage after stream completes
  const usage = await streamResult.usage;
  displayMetadata(usage);

  // Example 2: Using generateText
  console.log('\n\n=== Example 2: generateText ===\n');

  const generateResult = await generateText({
    model,
    prompt: 'What is 2 + 2? Just give me the number.',
  });

  console.log('Response:', generateResult.text);
  displayMetadata(generateResult.usage);

  // Example 3: Accessing response metadata
  console.log('\n\n=== Example 3: Response Metadata ===');
  const response = await streamResult.response;
  console.log('Response ID:', response.id);
  console.log('Response Model:', response.modelId);
  console.log('Response Timestamp:', response.timestamp);

} finally {
  model.dispose();
}
