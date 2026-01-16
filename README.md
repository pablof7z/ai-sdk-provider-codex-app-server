# ai-sdk-provider-codex-app-server

AI SDK v6 provider for OpenAI Codex using app-server mode with mid-execution message injection support.

## Installation

```bash
npm install github:pablof7z/ai-sdk-provider-codex-app-server
```

Requires AI SDK v6 (LanguageModelV3).

## Usage

```typescript
import { createCodexAppServer, type Session } from 'ai-sdk-provider-codex-app-server';
import { streamText } from 'ai';

let session: Session;

const provider = createCodexAppServer({
  defaultSettings: {
    onSessionCreated: (s) => { session = s; }
  }
});

const model = provider('gpt-5.1-codex-max');

// Start streaming
const resultPromise = streamText({
  model,
  prompt: 'Write a calculator in Python'
});

// Mid-execution injection - send additional instructions while agent is working
setTimeout(async () => {
  await session.injectMessage('Also add a square root function');
}, 2000);

// Get result
const result = await resultPromise;
console.log(await result.text);
```

## Examples

See `examples/README.md` for runnable scripts covering streaming, structured output, images, tool events, MCP config, thread modes, and mid-execution injection.

## API

### `createCodexAppServer(options?)`

Creates a new provider instance.

```typescript
const provider = createCodexAppServer({
  defaultSettings: {
    cwd: '/path/to/project',
    approvalMode: 'on-request',
    sandboxMode: 'workspace-write',
    threadMode: 'persistent',
    onSessionCreated: (session) => {
      // Store session for mid-execution injection
    }
  }
});
```

### `Session`

The session object exposed via `onSessionCreated` callback.

```typescript
interface Session {
  readonly threadId: string;
  readonly turnId: string | null;

  // Inject a message mid-execution
  injectMessage(content: string | UserInput[]): Promise<void>;

  // Interrupt the current turn
  interrupt(): Promise<void>;

  // Check if a turn is active
  isActive(): boolean;
}
```

### Settings

```typescript
interface CodexAppServerSettings {
  codexPath?: string;           // Path to codex binary
  cwd?: string;                 // Working directory
  approvalMode?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  threadMode?: 'persistent' | 'stateless';
  mcpServers?: Record<string, McpServerConfig>;
  rmcpClient?: boolean;
  verbose?: boolean;
  logger?: Logger | false;
  onSessionCreated?: (session: Session) => void;
  env?: Record<string, string>;
  baseInstructions?: string;
  configOverrides?: Record<string, string | number | boolean | object>;
  resume?: string;              // Thread ID to resume
}
```

### Per-call overrides

Use `providerOptions` to override a subset of settings per call:

```typescript
const result = await streamText({
  model,
  prompt: 'Summarize the latest changes',
  providerOptions: {
    'codex-app-server': {
      reasoningEffort: 'high',
      threadMode: 'stateless',
    }
  }
});
```

### Session Resumption

Capture the `sessionId` from `result.providerMetadata` after streaming to persist and resume sessions later:

```typescript
import { createCodexAppServer } from 'ai-sdk-provider-codex-app-server';
import { streamText } from 'ai';

const provider = createCodexAppServer();
const model = provider('gpt-5.1-codex-max');

// First conversation
const result = await streamText({
  model,
  prompt: 'Create a new React project'
});

// Consume the stream
for await (const part of result.fullStream) {
  if (part.type === 'text-delta' && part.text) {
    process.stdout.write(part.text);
  }
}

// Capture sessionId from providerMetadata after stream completes
const providerMetadata = await result.providerMetadata;
const sessionId = (providerMetadata?.codex as { sessionId?: string })?.sessionId;

// Persist sessionId to your database...
await db.saveSession(userId, sessionId);

// Later: Resume the session by creating a new provider with the resume setting
const savedSessionId = await db.getSession(userId);

const resumeProvider = createCodexAppServer({
  defaultSettings: {
    resume: savedSessionId,
  }
});
const resumedModel = resumeProvider('gpt-5.1-codex-max');

const resumedResult = await streamText({
  model: resumedModel,
  prompt: 'Now add authentication to it',
});
```

The `sessionId` is the Codex thread ID. When you pass it via `resume` in the provider settings, the conversation continues from where it left off, preserving context and any files the agent created.

### `listModels(options?)`

Discover available models and their capabilities. Spawns a temporary app-server process, queries models, then disposes.

```typescript
import { listModels } from 'ai-sdk-provider-codex-app-server';

const { models, defaultModel } = await listModels();

for (const model of models) {
  console.log(`${model.id}: ${model.description}`);
  const efforts = model.supportedReasoningEfforts.map(e => e.reasoningEffort);
  console.log(`  Reasoning: ${efforts.join(', ')} (default: ${model.defaultReasoningEffort})`);
}
```

**Options:**

```typescript
interface ListModelsOptions {
  codexPath?: string;           // Path to codex binary
  modelProviders?: string[];    // Filter by provider(s)
  env?: Record<string, string>; // Environment variables
}
```

**Returns:**

```typescript
interface ListModelsResult {
  models: ModelInfo[];
  defaultModel: ModelInfo | undefined;
}

interface ModelInfo {
  id: string;                           // Model ID to use with provider
  model: string;                        // Model identifier
  displayName: string;                  // Human-readable name
  description: string;                  // Model description
  supportedReasoningEfforts: Array<{
    reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
    description: string;
  }>;
  defaultReasoningEffort: string;       // Default reasoning level
  isDefault: boolean;                   // Whether this is the default model
}
```

## How It Works

This provider uses Codex's `app-server` mode which runs as a long-lived process communicating via JSON-RPC over stdio. Unlike `codex exec` which is one-shot (stdin ignored), the app-server mode supports:

1. **Persistent or stateless threads** - Reuse a thread or start fresh per call
2. **Mid-execution injection** - Send additional messages while the agent is working via the pending input queue
3. **Streaming deltas** - Real-time output via notifications

## License

MIT
