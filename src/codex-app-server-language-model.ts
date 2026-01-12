/**
 * CodexAppServerLanguageModel - implements AI SDK LanguageModelV1 interface
 */

import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
  LanguageModelV1CallWarning,
  LanguageModelV1FinishReason,
} from '@ai-sdk/provider';
import { AppServerClient } from './app-server-client.js';
import { SessionImpl } from './session.js';
import type {
  CodexAppServerSettings,
  CodexModelId,
} from './types.js';
import type {
  ProtocolUserInput,
  ProtocolApprovalPolicy,
  ProtocolSandboxMode,
  AgentMessageDeltaNotification,
  TurnCompletedNotification,
  ItemStartedNotification,
  ItemCompletedNotification,
} from './protocol/index.js';

/**
 * Map public approval mode to protocol format
 */
function mapApprovalMode(mode?: string): ProtocolApprovalPolicy {
  const map: Record<string, ProtocolApprovalPolicy> = {
    never: 'Never',
    'on-request': 'OnRequest',
    'on-failure': 'OnFailure',
    always: 'Always',
  };
  return map[mode ?? 'on-request'] ?? 'OnRequest';
}

/**
 * Map public sandbox mode to protocol format
 */
function mapSandboxMode(mode?: string): ProtocolSandboxMode {
  const map: Record<string, ProtocolSandboxMode> = {
    'read-only': 'ReadOnly',
    'workspace-write': 'WorkspaceWrite',
    'danger-full-access': 'DangerFullAccess',
  };
  return map[mode ?? 'workspace-write'] ?? 'WorkspaceWrite';
}

/**
 * Convert AI SDK prompt to Codex UserInput format
 */
function convertPrompt(prompt: LanguageModelV1CallOptions['prompt']): {
  inputs: ProtocolUserInput[];
  systemPrompt?: string;
} {
  const inputs: ProtocolUserInput[] = [];
  let systemPrompt: string | undefined;

  for (const message of prompt) {
    if (message.role === 'system') {
      // Collect system messages as base instructions
      if (typeof message.content === 'string') {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${message.content}` : message.content;
      }
    } else if (message.role === 'user') {
      // Convert user message content
      for (const part of message.content) {
        if (part.type === 'text') {
          inputs.push({ type: 'text', text: part.text });
        } else if (part.type === 'image') {
          if ('url' in part && part.url) {
            // part.url may be a URL object or string
            const imageUrl = typeof part.url === 'string' ? part.url : part.url.toString();
            inputs.push({ type: 'image', imageUrl });
          }
        }
      }
    }
    // Assistant messages are part of thread history and handled by resume
  }

  return { inputs, systemPrompt };
}

/**
 * LanguageModelV1 implementation for Codex App Server
 */
export class CodexAppServerLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = 'v1' as const;
  readonly provider = 'codex-app-server';
  readonly defaultObjectGenerationMode = 'json' as const;

  private client: AppServerClient | null = null;
  private currentSession: SessionImpl | null = null;

  constructor(
    public readonly modelId: CodexModelId,
    private settings: CodexAppServerSettings
  ) {}

  private getClient(): AppServerClient {
    if (!this.client) {
      this.client = new AppServerClient(this.settings);
    }
    return this.client;
  }

  async doGenerate(
    options: LanguageModelV1CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV1['doGenerate']>>> {
    // Collect stream into single response
    const { stream } = await this.doStream(options);
    const reader = stream.getReader();
    let text = '';
    let finishReason: LanguageModelV1FinishReason = 'unknown';
    let usage = { promptTokens: 0, completionTokens: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value.type === 'text-delta') {
        text += value.textDelta;
      } else if (value.type === 'finish') {
        finishReason = value.finishReason;
        if (value.usage) {
          usage = value.usage;
        }
      }
    }

    return {
      text,
      finishReason,
      usage,
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: this.settings as Record<string, unknown>,
      },
    };
  }

  async doStream(
    options: LanguageModelV1CallOptions
  ): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
    warnings?: LanguageModelV1CallWarning[];
  }> {
    const client = this.getClient();
    const { inputs, systemPrompt } = convertPrompt(options.prompt);
    const warnings: LanguageModelV1CallWarning[] = [];

    // Start or resume thread
    let threadId: string;

    if (this.settings.resume) {
      // Resume existing thread
      const resumeResult = await client.resumeThread({
        threadId: this.settings.resume,
      });
      threadId = resumeResult.thread.id;
    } else if (this.currentSession?.threadId) {
      // Continue existing session
      threadId = this.currentSession.threadId;
    } else {
      // Start new thread
      const threadResult = await client.startThread({
        model: this.modelId,
        cwd: this.settings.cwd,
        approvalPolicy: mapApprovalMode(this.settings.approvalMode),
        sandbox: mapSandboxMode(this.settings.sandboxMode),
        baseInstructions: systemPrompt ?? this.settings.baseInstructions,
        configOverrides: this.settings.configOverrides as Record<string, unknown>,
      });
      threadId = threadResult.thread.id;
    }

    // Create session object
    const session = new SessionImpl(client, threadId);
    this.currentSession = session;

    // CRITICAL: Expose session to consumer for mid-execution injection
    this.settings.onSessionCreated?.(session);

    // Start turn
    const turnResult = await client.startTurn({
      threadId,
      input: inputs,
    });
    session._setTurnId(turnResult.turn.id);

    const turnId = turnResult.turn.id;

    // Create readable stream from notifications
    const stream = new ReadableStream<LanguageModelV1StreamPart>({
      start: (controller) => {
        // Track active tool calls
        const activeTools = new Map<string, { toolName: string; input: string }>();

        // Subscribe to delta notifications
        const unsubDelta = client.onNotification('agentMessageDelta', (params) => {
          const p = params as AgentMessageDeltaNotification['params'];
          if (p.threadId === threadId && p.turnId === turnId) {
            controller.enqueue({
              type: 'text-delta',
              textDelta: p.delta,
            });
          }
        });

        // Subscribe to item started (for tool calls)
        const unsubItemStarted = client.onNotification('item/started', (params) => {
          const p = params as ItemStartedNotification['params'];
          if (p.threadId === threadId && p.turnId === turnId) {
            const item = p.item;
            if (item.type === 'CommandExecution') {
              controller.enqueue({
                type: 'tool-call',
                toolCallType: 'function',
                toolCallId: item.id,
                toolName: 'command_execution',
                args: JSON.stringify({ command: item.command, cwd: item.cwd }),
              });
              activeTools.set(item.id, { toolName: 'command_execution', input: item.command });
            } else if (item.type === 'McpToolCall') {
              controller.enqueue({
                type: 'tool-call',
                toolCallType: 'function',
                toolCallId: item.id,
                toolName: `mcp__${item.server}__${item.tool}`,
                args: JSON.stringify(item.arguments),
              });
              activeTools.set(item.id, { toolName: item.tool, input: JSON.stringify(item.arguments) });
            }
          }
        });

        // Subscribe to item completed (for tracking active tools)
        // Note: LanguageModelV1 doesn't have a tool-result stream part type,
        // so we just track completion for cleanup purposes
        const unsubItemCompleted = client.onNotification('item/completed', (params) => {
          const p = params as ItemCompletedNotification['params'];
          if (p.threadId === threadId && p.turnId === turnId) {
            const item = p.item;
            if (item.type === 'CommandExecution' || item.type === 'McpToolCall') {
              activeTools.delete(item.id);
            }
          }
        });

        // Subscribe to turn completion
        const unsubComplete = client.onNotification('turn/completed', (params) => {
          const p = params as TurnCompletedNotification['params'];
          if (p.threadId === threadId && p.turn.id === turnId) {
            session._setInactive();

            const isInterrupted = p.turn.status === 'Interrupted';
            const isFailed = p.turn.status === 'Failed';

            controller.enqueue({
              type: 'finish',
              finishReason: isFailed ? 'error' : isInterrupted ? 'stop' : 'stop',
              usage: {
                promptTokens: 0, // Codex doesn't report token usage in the protocol
                completionTokens: 0,
              },
            });
            controller.close();

            // Cleanup subscriptions
            unsubDelta();
            unsubItemStarted();
            unsubItemCompleted();
            unsubComplete();
          }
        });

        // Handle abort signal
        options.abortSignal?.addEventListener('abort', async () => {
          try {
            await session.interrupt();
          } catch {
            // Ignore interrupt errors
          }
          unsubDelta();
          unsubItemStarted();
          unsubItemCompleted();
          unsubComplete();
          controller.close();
        });
      },
    });

    return {
      stream,
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: this.settings as Record<string, unknown>,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Get the current session for external access
   */
  getSession(): SessionImpl | null {
    return this.currentSession;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.client?.dispose();
    this.client = null;
    this.currentSession = null;
  }
}
