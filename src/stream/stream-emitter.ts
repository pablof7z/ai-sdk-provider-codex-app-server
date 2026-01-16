/**
 * Stream emission utilities for AI SDK stream parts
 */

import type {
  LanguageModelV3StreamPart,
  LanguageModelV3FinishReason,
  LanguageModelV3Usage,
  SharedV3Warning,
  JSONObject,
  JSONValue,
} from '@ai-sdk/provider';
import { randomUUID } from 'node:crypto';

/**
 * Metadata about tool executions during a turn
 */
export interface ToolExecutionStats {
  /** Total number of tool calls executed */
  totalCalls: number;
  /** Breakdown by tool type */
  byType: {
    commands: number;
    fileChanges: number;
    mcpTools: number;
    webSearches: number;
  };
  /** Total execution time in milliseconds (when available) */
  totalDurationMs: number;
}

/**
 * Raw usage metadata from Codex app-server (JSON-serializable)
 *
 * Note: Codex app-server does not currently provide token counts.
 * This metadata includes what IS available from the protocol.
 *
 * Access via `usage.raw` and cast to `CodexUsageMetadata`:
 * ```typescript
 * const metadata = usage.raw as CodexUsageMetadata | undefined;
 * ```
 */
export interface CodexUsageMetadata {
  /** The model used for this turn */
  model: string;
  /** Thread identifier */
  threadId: string;
  /** Turn identifier */
  turnId: string;
  /** Turn completion status */
  status: string;
  /** Tool execution statistics */
  toolStats: ToolExecutionStats;
  /** Whether reasoning was used in this turn */
  hasReasoning: boolean;
  /** ISO timestamp when the turn completed */
  completedAt: string;
}

export function createUsage(metadata?: CodexUsageMetadata): LanguageModelV3Usage {
  const raw = metadata ? (JSON.parse(JSON.stringify(metadata)) as JSONObject) : undefined;
  return {
    inputTokens: { total: 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 0, text: undefined, reasoning: undefined },
    raw,
  };
}

export interface TurnError {
  code?: string;
  message?: string;
  codexErrorInfo?: string;
  additionalDetails?: unknown;
}

export function mapFinishReason(status?: string, error?: TurnError | null): LanguageModelV3FinishReason {
  switch (status) {
    case 'completed':
      return { unified: 'stop', raw: status };
    case 'interrupted':
      return { unified: 'stop', raw: status };
    case 'failed':
      return { unified: 'error', raw: error ? JSON.stringify(error) : status };
    default:
      return { unified: 'other', raw: status };
  }
}

export interface StreamEmitterOptions {
  threadId: string;
  turnId: string;
  modelId: string;
  includeRawChunks?: boolean;
}

export class StreamEmitter {
  private textId = randomUUID();
  private reasoningId = randomUUID();
  private textStarted = false;
  private reasoningStarted = false;

  // Tool execution tracking
  private toolStats: ToolExecutionStats = {
    totalCalls: 0,
    byType: { commands: 0, fileChanges: 0, mcpTools: 0, webSearches: 0 },
    totalDurationMs: 0,
  };

  constructor(
    private controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
    private options: StreamEmitterOptions
  ) {}

  /**
   * Record a tool execution for stats tracking
   */
  recordToolExecution(toolType: 'command' | 'fileChange' | 'mcpTool' | 'webSearch', durationMs?: number): void {
    this.toolStats.totalCalls++;
    switch (toolType) {
      case 'command':
        this.toolStats.byType.commands++;
        break;
      case 'fileChange':
        this.toolStats.byType.fileChanges++;
        break;
      case 'mcpTool':
        this.toolStats.byType.mcpTools++;
        break;
      case 'webSearch':
        this.toolStats.byType.webSearches++;
        break;
    }
    if (durationMs !== undefined && durationMs > 0) {
      this.toolStats.totalDurationMs += durationMs;
    }
  }

  emitStreamStart(warnings: SharedV3Warning[]): void {
    this.controller.enqueue({ type: 'stream-start', warnings });
    this.controller.enqueue({
      type: 'response-metadata',
      id: this.options.turnId,
      timestamp: new Date(),
      modelId: this.options.modelId,
      providerMetadata: {
        codex: { sessionId: this.options.threadId },
      },
    });
  }

  emitRaw(method: string, params: unknown): void {
    if (this.options.includeRawChunks) {
      this.controller.enqueue({ type: 'raw', rawValue: { method, params } });
    }
  }

  emitTextDelta(delta: string): void {
    if (!this.textStarted) {
      this.textStarted = true;
      this.controller.enqueue({ type: 'text-start', id: this.textId });
    }
    this.controller.enqueue({ type: 'text-delta', id: this.textId, delta });
  }

  emitReasoningDelta(delta: string, isSummary = false): void {
    if (!this.reasoningStarted) {
      this.reasoningStarted = true;
      this.controller.enqueue({ type: 'reasoning-start', id: this.reasoningId });
    }
    this.controller.enqueue({
      type: 'reasoning-delta',
      id: this.reasoningId,
      delta,
      ...(isSummary ? { providerMetadata: { codex: { isSummary: true } } } : {}),
    });
  }

  emitToolInput(toolCallId: string, toolName: string, input: string, dynamic?: boolean): void {
    this.controller.enqueue({
      type: 'tool-input-start',
      id: toolCallId,
      toolName,
      providerExecuted: true,
      ...(dynamic ? { dynamic: true } : {}),
    });
    if (input) {
      this.controller.enqueue({ type: 'tool-input-delta', id: toolCallId, delta: input });
    }
    this.controller.enqueue({ type: 'tool-input-end', id: toolCallId });
  }

  emitToolCall(toolCallId: string, toolName: string, input: string, dynamic?: boolean): void {
    this.controller.enqueue({
      type: 'tool-call',
      toolCallId,
      toolName,
      input,
      providerExecuted: true,
      ...(dynamic ? { dynamic: true } : {}),
    });
  }

  emitToolResult(
    toolCallId: string,
    toolName: string,
    result: Record<string, unknown>,
    isError?: boolean,
    dynamic?: boolean
  ): void {
    this.controller.enqueue({
      type: 'tool-result',
      toolCallId,
      toolName,
      result: (result ?? {}) as NonNullable<JSONValue>,
      ...(isError ? { isError: true } : {}),
      ...(dynamic ? { dynamic: true } : {}),
    });
  }

  emitApprovalRequest(itemId: string): void {
    this.controller.enqueue({
      type: 'tool-approval-request',
      approvalId: itemId,
      toolCallId: itemId,
    });
  }

  emitFinish(status?: string, error?: TurnError | null): void {
    // If there's an error with a message and no text was emitted, emit error as text
    if (error?.message && !this.textStarted) {
      const errorText = error.codexErrorInfo
        ? `Error: ${error.message}\n\n${error.codexErrorInfo}`
        : `Error: ${error.message}`;
      this.emitTextDelta(errorText);
    }

    if (this.textStarted) {
      this.controller.enqueue({ type: 'text-end', id: this.textId });
    }
    if (this.reasoningStarted) {
      this.controller.enqueue({ type: 'reasoning-end', id: this.reasoningId });
    }

    // Build usage metadata with what Codex provides
    const metadata: CodexUsageMetadata = {
      model: this.options.modelId,
      threadId: this.options.threadId,
      turnId: this.options.turnId,
      status: status ?? 'unknown',
      toolStats: this.toolStats,
      hasReasoning: this.reasoningStarted,
      completedAt: new Date().toISOString(),
    };

    this.controller.enqueue({
      type: 'finish',
      finishReason: mapFinishReason(status, error),
      usage: createUsage(metadata),
    });
  }

  close(): void {
    this.controller.close();
  }
}
