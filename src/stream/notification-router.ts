/**
 * Routes app-server notifications to stream emitter
 */

import type { AppServerClient } from '../app-server-client.js';
import type {
  AgentMessageDeltaNotification,
  ReasoningTextDeltaNotification,
  ReasoningSummaryTextDeltaNotification,
  ItemStartedNotification,
  ItemCompletedNotification,
  CommandExecutionRequestApprovalNotification,
  FileChangeRequestApprovalNotification,
  TurnCompletedNotification,
  TurnError,
  CommandExecution,
  FileChange,
  McpToolCall,
  WebSearch,
} from '../protocol/index.js';
import { StreamEmitter } from './stream-emitter.js';
import { ToolTracker, resolveToolName, buildToolResultPayload, isToolItem } from './tool-tracker.js';

type ToolItem = CommandExecution | FileChange | McpToolCall | WebSearch;

export interface NotificationRouterOptions {
  threadId: string;
  turnId: string;
  onTurnCompleted: (status: string, error?: TurnError | null) => void;
}

export class NotificationRouter {
  private unsubscribers: (() => void)[] = [];
  private toolTracker = new ToolTracker();
  private textItemIdsWithDelta = new Set<string>();
  private reasoningItemIdsWithDelta = new Set<string>();

  constructor(
    private client: AppServerClient,
    private emitter: StreamEmitter,
    private options: NotificationRouterOptions
  ) {}

  subscribe(): void {
    const { threadId, turnId } = this.options;
    const sameThread = (a: string, b: string) => String(a) === String(b);
    const sameTurn = (a: string, b: string) => String(a) === String(b);
    const normalizeType = (type: string) => type.toLowerCase();
    const isAgentMessage = (item: { type: string }): item is { id: string; text: string } =>
      normalizeType(item.type) === 'agentmessage';
    const isReasoning = (
      item: { type: string }
    ): item is { id: string; summary: string[] | string; content: string[] | string } =>
      normalizeType(item.type) === 'reasoning';

    // Text delta handlers
    const handleTextDelta = (params: unknown) => {
      const p = params as AgentMessageDeltaNotification['params'];
      if (!sameThread(p.threadId, threadId) || !sameTurn(p.turnId, turnId)) return;
      this.textItemIdsWithDelta.add(String(p.itemId));
      this.emitter.emitTextDelta(p.delta);
    };

    this.unsubscribers.push(
      this.client.onNotification('item/agentMessage/delta', (params) => {
        this.emitter.emitRaw('item/agentMessage/delta', params);
        handleTextDelta(params);
      })
    );

    this.unsubscribers.push(
      this.client.onNotification('agentMessageDelta', (params) => {
        this.emitter.emitRaw('agentMessageDelta', params);
        handleTextDelta(params);
      })
    );

    // Reasoning delta handlers
    const handleReasoningDelta = (params: unknown, isSummary: boolean) => {
      const p =
        params as ReasoningTextDeltaNotification['params'] | ReasoningSummaryTextDeltaNotification['params'];
      if (!sameThread(p.threadId, threadId) || !sameTurn(p.turnId, turnId)) return;
      this.reasoningItemIdsWithDelta.add(String(p.itemId));
      const delta = 'delta' in p ? p.delta : '';
      this.emitter.emitReasoningDelta(delta, isSummary);
    };

    this.unsubscribers.push(
      this.client.onNotification('reasoningTextDelta', (params) => {
        this.emitter.emitRaw('reasoningTextDelta', params);
        handleReasoningDelta(params, false);
      })
    );

    this.unsubscribers.push(
      this.client.onNotification('reasoningSummaryTextDelta', (params) => {
        this.emitter.emitRaw('reasoningSummaryTextDelta', params);
        handleReasoningDelta(params, true);
      })
    );

    this.unsubscribers.push(
      this.client.onNotification('item/reasoning/textDelta', (params) => {
        this.emitter.emitRaw('item/reasoning/textDelta', params);
        handleReasoningDelta(params, false);
      })
    );

    this.unsubscribers.push(
      this.client.onNotification('item/reasoning/summaryTextDelta', (params) => {
        this.emitter.emitRaw('item/reasoning/summaryTextDelta', params);
        handleReasoningDelta(params, true);
      })
    );

    // Item started handler
    this.unsubscribers.push(
      this.client.onNotification('item/started', (params) => {
        this.emitter.emitRaw('item/started', params);
        const p = params as ItemStartedNotification['params'];
        if (!sameThread(p.threadId, threadId) || !sameTurn(p.turnId, turnId)) return;
        if (!isToolItem(p.item)) return;

        const item = p.item as ToolItem;
        const info = this.toolTracker.start(item);
        this.emitter.emitToolInput(item.id, info.toolName, info.input, info.dynamic);
        this.emitter.emitToolCall(item.id, info.toolName, info.input, info.dynamic);
      })
    );

    // Item completed handler
    this.unsubscribers.push(
      this.client.onNotification('item/completed', (params) => {
        this.emitter.emitRaw('item/completed', params);
        const p = params as ItemCompletedNotification['params'];
        if (!sameThread(p.threadId, threadId) || !sameTurn(p.turnId, turnId)) return;
        if (isToolItem(p.item)) {
          const item = p.item as ToolItem;
          const existing = this.toolTracker.complete(item.id);
          const resolved = existing ?? resolveToolName(item);
          const toolName = resolved.toolName;
          const dynamic = resolved.dynamic;

          const { result, isError } = buildToolResultPayload(item);
          this.emitter.emitToolResult(item.id, toolName, result, isError, dynamic);
          return;
        }

        if (isAgentMessage(p.item)) {
          const itemId = String(p.item.id);
          if (!this.textItemIdsWithDelta.has(itemId) && p.item.text) {
            this.emitter.emitTextDelta(p.item.text);
          }
          return;
        }

        if (isReasoning(p.item)) {
          const itemId = String(p.item.id);
          if (!this.reasoningItemIdsWithDelta.has(itemId)) {
            const summary = Array.isArray(p.item.summary)
              ? p.item.summary.join('\n')
              : p.item.summary;
            const content = Array.isArray(p.item.content)
              ? p.item.content.join('\n')
              : p.item.content;
            if (summary) this.emitter.emitReasoningDelta(summary, true);
            if (content) this.emitter.emitReasoningDelta(content, false);
          }
        }
      })
    );

    // Approval handlers
    this.unsubscribers.push(
      this.client.onNotification('item/commandExecution/requestApproval', (params) => {
        this.emitter.emitRaw('item/commandExecution/requestApproval', params);
        const p = params as CommandExecutionRequestApprovalNotification['params'];
        if (!sameThread(p.threadId, threadId) || !sameTurn(p.turnId, turnId)) return;
        this.emitter.emitApprovalRequest(p.itemId);
      })
    );

    this.unsubscribers.push(
      this.client.onNotification('item/fileChange/requestApproval', (params) => {
        this.emitter.emitRaw('item/fileChange/requestApproval', params);
        const p = params as FileChangeRequestApprovalNotification['params'];
        if (!sameThread(p.threadId, threadId) || !sameTurn(p.turnId, turnId)) return;
        this.emitter.emitApprovalRequest(p.itemId);
      })
    );

    // Turn completed handler
    this.unsubscribers.push(
      this.client.onNotification('turn/completed', (params) => {
        this.emitter.emitRaw('turn/completed', params);
        const p = params as TurnCompletedNotification['params'];
        if (!sameThread(p.threadId, threadId) || !sameTurn(p.turn.id, turnId)) return;
        this.textItemIdsWithDelta.clear();
        this.reasoningItemIdsWithDelta.clear();
        this.options.onTurnCompleted(p.turn.status, p.turn.error);
      })
    );
  }

  unsubscribe(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}
