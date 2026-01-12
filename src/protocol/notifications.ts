/**
 * Server notification types for Codex app-server protocol
 */

import type { Thread, Turn, TurnItem } from './messages.js';

// ============ Thread Notifications ============

export interface ThreadStartedNotification {
  method: 'thread/started';
  params: {
    thread: Thread;
  };
}

// ============ Turn Notifications ============

export interface TurnStartedNotification {
  method: 'turn/started';
  params: {
    threadId: string;
    turn: Turn;
  };
}

export interface TurnCompletedNotification {
  method: 'turn/completed';
  params: {
    threadId: string;
    turn: Turn;
  };
}

// ============ Item Notifications ============

export interface ItemStartedNotification {
  method: 'item/started';
  params: {
    item: TurnItem;
    threadId: string;
    turnId: string;
  };
}

export interface ItemCompletedNotification {
  method: 'item/completed';
  params: {
    item: TurnItem;
    threadId: string;
    turnId: string;
  };
}

// ============ Delta Notifications (Streaming) ============

export interface AgentMessageDeltaNotification {
  method: 'item/agentMessage/delta';
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    delta: string;
  };
}

export interface LegacyAgentMessageDeltaNotification {
  method: 'agentMessageDelta';
  params: AgentMessageDeltaNotification['params'];
}

export interface ReasoningTextDeltaNotification {
  method: 'item/reasoning/textDelta';
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    contentIndex: number;
    delta: string;
  };
}

export interface LegacyReasoningTextDeltaNotification {
  method: 'reasoningTextDelta';
  params: ReasoningTextDeltaNotification['params'];
}

export interface ReasoningSummaryTextDeltaNotification {
  method: 'item/reasoning/summaryTextDelta';
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    summaryIndex?: number;
    delta: string;
  };
}

export interface LegacyReasoningSummaryTextDeltaNotification {
  method: 'reasoningSummaryTextDelta';
  params: ReasoningSummaryTextDeltaNotification['params'];
}

export interface CommandExecutionOutputDeltaNotification {
  method: 'item/commandExecution/outputDelta';
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    delta: string;
  };
}

export interface LegacyCommandExecutionOutputDeltaNotification {
  method: 'commandExecutionOutputDelta';
  params: CommandExecutionOutputDeltaNotification['params'];
}

export interface FileChangeOutputDeltaNotification {
  method: 'item/fileChange/outputDelta';
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    delta: string;
  };
}

export interface LegacyFileChangeOutputDeltaNotification {
  method: 'fileChangeOutputDelta';
  params: FileChangeOutputDeltaNotification['params'];
}

// ============ Approval Requests ============

export interface CommandExecutionRequestApprovalNotification {
  method: 'item/commandExecution/requestApproval';
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    command: string;
    cwd: string;
    reason?: string;
  };
}

export interface FileChangeRequestApprovalNotification {
  method: 'item/fileChange/requestApproval';
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    changes: Array<{
      path: string;
      type: string;
      diff?: string;
    }>;
  };
}

// ============ Error Notification ============

export interface ErrorNotification {
  method: 'error';
  params: {
    threadId?: string;
    turnId?: string;
    itemId?: string;
    code: string;
    message: string;
    data?: Record<string, unknown>;
  };
}

// ============ Account Notifications ============

export interface AccountUpdatedNotification {
  method: 'account/updated';
  params: {
    account: {
      id: string;
      email: string;
      authMethods: string[];
      subscription?: string;
    };
  };
}

export interface AccountLoginCompletedNotification {
  method: 'account/loginCompleted';
  params: {
    loginId: string;
    success: boolean;
    error?: string;
  };
}

// ============ Union Type ============

export type ServerNotification =
  | ThreadStartedNotification
  | TurnStartedNotification
  | TurnCompletedNotification
  | ItemStartedNotification
  | ItemCompletedNotification
  | AgentMessageDeltaNotification
  | LegacyAgentMessageDeltaNotification
  | ReasoningTextDeltaNotification
  | LegacyReasoningTextDeltaNotification
  | ReasoningSummaryTextDeltaNotification
  | LegacyReasoningSummaryTextDeltaNotification
  | CommandExecutionOutputDeltaNotification
  | LegacyCommandExecutionOutputDeltaNotification
  | FileChangeOutputDeltaNotification
  | LegacyFileChangeOutputDeltaNotification
  | CommandExecutionRequestApprovalNotification
  | FileChangeRequestApprovalNotification
  | ErrorNotification
  | AccountUpdatedNotification
  | AccountLoginCompletedNotification;

export type NotificationMethod = ServerNotification['method'];
