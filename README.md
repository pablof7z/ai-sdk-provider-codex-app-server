# ai-sdk-provider-codex-app-server

AI SDK provider for OpenAI Codex using app-server mode with mid-execution message injection support.

## Installation

```bash
npm install github:pablof7z/ai-sdk-provider-codex-app-server
```

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

const model = provider('gpt-5.1-codex');

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

## API

### `createCodexAppServer(options?)`

Creates a new provider instance.

```typescript
const provider = createCodexAppServer({
  defaultSettings: {
    cwd: '/path/to/project',
    approvalMode: 'on-request',
    sandboxMode: 'workspace-write',
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
  approvalMode?: 'never' | 'on-request' | 'on-failure' | 'always';
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  mcpServers?: Record<string, McpServerConfig>;
  verbose?: boolean;
  logger?: Logger | false;
  onSessionCreated?: (session: Session) => void;
  env?: Record<string, string>;
  baseInstructions?: string;
  configOverrides?: Record<string, unknown>;
  resume?: string;              // Thread ID to resume
}
```

## How It Works

This provider uses Codex's `app-server` mode which runs as a long-lived process communicating via JSON-RPC over stdio. Unlike `codex exec` which is one-shot (stdin ignored), the app-server mode supports:

1. **Persistent threads** - Multiple turns within a conversation
2. **Mid-execution injection** - Send additional messages while the agent is working via the pending input queue
3. **Streaming deltas** - Real-time output via notifications

## License

MIT
