/**
 * CodexAppServerLanguageModel - implements AI SDK LanguageModelV2 interface
 */

import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2Content,
  LanguageModelV2Usage,
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
 * Note: Protocol uses lowercase values like 'never', 'on-request', etc.
 */
function mapApprovalMode(mode?: string): ProtocolApprovalPolicy {
  const validModes: ProtocolApprovalPolicy[] = ['never', 'on-request', 'on-failure', 'untrusted'];
  const normalized = mode?.toLowerCase() ?? 'on-request';
  return validModes.includes(normalized as ProtocolApprovalPolicy)
    ? (normalized as ProtocolApprovalPolicy)
    : 'on-request';
}

/**
 * Map public sandbox mode to protocol format
 */
function mapSandboxMode(mode?: string): ProtocolSandboxMode {
  const validModes: ProtocolSandboxMode[] = ['read-only', 'workspace-write', 'full-access'];
  const normalized = mode?.toLowerCase() ?? 'workspace-write';
  return validModes.includes(normalized as ProtocolSandboxMode)
    ? (normalized as ProtocolSandboxMode)
    : 'workspace-write';
}

/**
 * Convert AI SDK prompt to Codex UserInput format
 */
function convertPrompt(prompt: LanguageModelV2CallOptions['prompt']): {
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
        } else if (part.type === 'file') {
          // V2 uses 'file' type for images
          if (typeof part.data === 'string' && part.mediaType?.startsWith('image/')) {
            inputs.push({ type: 'image', imageUrl: part.data });
          }
        }
      }
    }
    // Assistant messages are part of thread history and handled by resume
  }

  return { inputs, systemPrompt };
}

/**
 * Generate a unique ID for stream parts
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * LanguageModelV2 implementation for Codex App Server
 */
export class CodexAppServerLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly provider = 'codex-app-server';
  readonly supportedUrls: Record<string, RegExp[]> = {};

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
    options: LanguageModelV2CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    // Collect stream into single response
    const { stream } = await this.doStream(options);
    const reader = stream.getReader();
    let text = '';
    let finishReason: LanguageModelV2FinishReason = 'unknown';
    let usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const warnings: LanguageModelV2CallWarning[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value.type === 'text-delta') {
        text += value.delta;
      } else if (value.type === 'stream-start' && value.warnings) {
        warnings.push(...value.warnings);
      } else if (value.type === 'finish') {
        finishReason = value.finishReason;
        usage = value.usage;
      }
    }

    const content: LanguageModelV2Content[] = text ? [{ type: 'text', text }] : [];

    return {
      content,
      finishReason,
      usage,
      warnings,
    };
  }

  async doStream(
    options: LanguageModelV2CallOptions
  ): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>;
    request?: { body?: unknown };
    response?: { headers?: Record<string, string> };
  }> {
    const client = this.getClient();
    const { inputs, systemPrompt } = convertPrompt(options.prompt);
    const warnings: LanguageModelV2CallWarning[] = [];

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
    const textId = generateId();

    // Create readable stream from notifications
    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: (controller) => {
        // Emit stream-start with warnings
        controller.enqueue({
          type: 'stream-start',
          warnings,
        });

        // Track if we've started text output
        let textStarted = false;

        // Track active tool calls
        const activeTools = new Map<string, { toolName: string; input: string }>();

        // Subscribe to delta notifications
        const unsubDelta = client.onNotification('item/agentMessage/delta', (params) => {
          const p = params as AgentMessageDeltaNotification['params'];
          // Note: turnId from protocol is a sequence number like "0", not a UUID
          if (p.threadId === threadId) {
            // Emit text-start on first delta
            if (!textStarted) {
              textStarted = true;
              controller.enqueue({
                type: 'text-start',
                id: textId,
              });
            }
            controller.enqueue({
              type: 'text-delta',
              id: textId,
              delta: p.delta,
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
                type: 'tool-input-start',
                id: item.id,
                toolName: 'command_execution',
              });
              controller.enqueue({
                type: 'tool-input-delta',
                id: item.id,
                delta: JSON.stringify({ command: item.command, cwd: item.cwd }),
              });
              controller.enqueue({
                type: 'tool-input-end',
                id: item.id,
              });
              activeTools.set(item.id, { toolName: 'command_execution', input: item.command });
            } else if (item.type === 'McpToolCall') {
              controller.enqueue({
                type: 'tool-input-start',
                id: item.id,
                toolName: `mcp__${item.server}__${item.tool}`,
              });
              controller.enqueue({
                type: 'tool-input-delta',
                id: item.id,
                delta: JSON.stringify(item.arguments),
              });
              controller.enqueue({
                type: 'tool-input-end',
                id: item.id,
              });
              activeTools.set(item.id, { toolName: item.tool, input: JSON.stringify(item.arguments) });
            }
          }
        });

        // Subscribe to item completed (for tool results)
        const unsubItemCompleted = client.onNotification('item/completed', (params) => {
          const p = params as ItemCompletedNotification['params'];
          if (p.threadId === threadId && p.turnId === turnId) {
            const item = p.item;
            if (item.type === 'CommandExecution') {
              controller.enqueue({
                type: 'tool-result',
                toolCallId: item.id,
                toolName: 'command_execution',
                result: {
                  output: item.aggregatedOutput,
                  exitCode: item.exitCode,
                },
              });
              activeTools.delete(item.id);
            } else if (item.type === 'McpToolCall') {
              controller.enqueue({
                type: 'tool-result',
                toolCallId: item.id,
                toolName: `mcp__${item.server}__${item.tool}`,
                result: item.result ?? item.error,
              });
              activeTools.delete(item.id);
            }
          }
        });

        // Subscribe to turn completion
        const unsubComplete = client.onNotification('turn/completed', (params) => {
          const p = params as TurnCompletedNotification['params'];
          if (p.threadId === threadId && p.turn.id === turnId) {
            session._setInactive();

            // Emit text-end if we started text
            if (textStarted) {
              controller.enqueue({
                type: 'text-end',
                id: textId,
              });
            }

            const isInterrupted = p.turn.status === 'Interrupted';
            const isFailed = p.turn.status === 'Failed';

            controller.enqueue({
              type: 'finish',
              finishReason: isFailed ? 'error' : isInterrupted ? 'stop' : 'stop',
              usage: {
                inputTokens: 0, // Codex doesn't report token usage in the protocol
                outputTokens: 0,
                totalTokens: 0,
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
