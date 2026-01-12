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
  onTurnCompleted: (status: string) => void;
}

export class NotificationRouter {
  private unsubscribers: (() => void)[] = [];
  private toolTracker = new ToolTracker();

  constructor(
    private client: AppServerClient,
    private emitter: StreamEmitter,
    private options: NotificationRouterOptions
  ) {}

  subscribe(): void {
    const { threadId, turnId } = this.options;

    // Text delta handlers
    const handleTextDelta = (params: unknown) => {
      const p = params as AgentMessageDeltaNotification['params'];
      if (p.threadId !== threadId || p.turnId !== turnId) return;
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
      if (p.threadId !== threadId || p.turnId !== turnId) return;
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
        if (p.threadId !== threadId || p.turnId !== turnId) return;
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
        if (p.threadId !== threadId || p.turnId !== turnId) return;
        if (!isToolItem(p.item)) return;

        const item = p.item as ToolItem;
        const existing = this.toolTracker.complete(item.id);
        const resolved = existing ?? resolveToolName(item);
        const toolName = resolved.toolName;
        const dynamic = resolved.dynamic;

        const { result, isError } = buildToolResultPayload(item);
        this.emitter.emitToolResult(item.id, toolName, result, isError, dynamic);
      })
    );

    // Approval handlers
    this.unsubscribers.push(
      this.client.onNotification('item/commandExecution/requestApproval', (params) => {
        this.emitter.emitRaw('item/commandExecution/requestApproval', params);
        const p = params as CommandExecutionRequestApprovalNotification['params'];
        if (p.threadId !== threadId || p.turnId !== turnId) return;
        this.emitter.emitApprovalRequest(p.itemId);
      })
    );

    this.unsubscribers.push(
      this.client.onNotification('item/fileChange/requestApproval', (params) => {
        this.emitter.emitRaw('item/fileChange/requestApproval', params);
        const p = params as FileChangeRequestApprovalNotification['params'];
        if (p.threadId !== threadId || p.turnId !== turnId) return;
        this.emitter.emitApprovalRequest(p.itemId);
      })
    );

    // Turn completed handler
    this.unsubscribers.push(
      this.client.onNotification('turn/completed', (params) => {
        this.emitter.emitRaw('turn/completed', params);
        const p = params as TurnCompletedNotification['params'];
        if (p.threadId !== threadId || p.turn.id !== turnId) return;
        this.options.onTurnCompleted(p.turn.status);
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
