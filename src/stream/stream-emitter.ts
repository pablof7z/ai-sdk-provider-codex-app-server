/**
 * Stream emission utilities for AI SDK stream parts
 */

import type {
  LanguageModelV3StreamPart,
  LanguageModelV3FinishReason,
  LanguageModelV3Usage,
  SharedV3Warning,
  JSONValue,
} from '@ai-sdk/provider';
import { randomUUID } from 'node:crypto';

export function createEmptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: 0,
      noCache: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 0,
      text: undefined,
      reasoning: undefined,
    },
    raw: undefined,
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
      return { unified: 'error', raw: error ?? status };
    default:
      return { unified: 'other', raw: status };
  }
}

export interface StreamEmitterOptions {
  turnId: string;
  modelId: string;
  includeRawChunks?: boolean;
}

export class StreamEmitter {
  private textId = randomUUID();
  private reasoningId = randomUUID();
  private textStarted = false;
  private reasoningStarted = false;

  constructor(
    private controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
    private options: StreamEmitterOptions
  ) {}

  emitStreamStart(warnings: SharedV3Warning[]): void {
    this.controller.enqueue({ type: 'stream-start', warnings });
    this.controller.enqueue({
      type: 'response-metadata',
      id: this.options.turnId,
      timestamp: new Date(),
      modelId: this.options.modelId,
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
    const prefix = isSummary ? '[summary] ' : '';
    this.controller.enqueue({ type: 'reasoning-delta', id: this.reasoningId, delta: `${prefix}${delta}` });
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
    this.controller.enqueue({
      type: 'finish',
      finishReason: mapFinishReason(status, error),
      usage: createEmptyUsage(),
    });
  }

  close(): void {
    this.controller.close();
  }
}
