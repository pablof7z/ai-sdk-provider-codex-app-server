/**
 * JSON-RPC message types for Codex app-server protocol
 *
 * Note: The protocol uses simplified JSON-RPC without the "jsonrpc": "2.0" field
 */

export type RequestId = string | number;

/**
 * JSON-RPC request (client -> server)
 */
export interface JSONRPCRequest {
  id: RequestId;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC notification (no response expected)
 */
export interface JSONRPCNotification {
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC success response
 */
export interface JSONRPCResponse {
  id: RequestId;
  result?: unknown;
}

/**
 * JSON-RPC error response
 */
export interface JSONRPCError {
  id: RequestId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResponse | JSONRPCError;

// ============ Initialize ============

export interface InitializeParams {
  clientInfo: {
    name: string;
    title?: string;
    version: string;
  };
}

export interface InitializeResult {
  serverInfo?: {
    name: string;
    version: string;
  };
}

// ============ Thread Management ============

export type ProtocolApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'untrusted';
export type ProtocolSandboxMode = 'read-only' | 'workspace-write' | 'full-access';

export interface ThreadStartParams {
  model?: string;
  modelProvider?: string;
  cwd?: string;
  approvalPolicy?: ProtocolApprovalPolicy;
  sandbox?: ProtocolSandboxMode;
  baseInstructions?: string;
  configOverrides?: Record<string, unknown>;
}

export interface ThreadStartResult {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
  approvalPolicy: ProtocolApprovalPolicy;
  sandbox: ProtocolSandboxMode;
  reasoningEffort?: string;
}

export interface ThreadResumeParams {
  threadId?: string;
  path?: string;
}

export interface ThreadForkParams {
  threadId: string;
  modelOverride?: string;
  sandboxOverride?: ProtocolSandboxMode;
}

export interface ThreadRollbackParams {
  threadId: string;
  toTurnId: string;
}

export interface ThreadArchiveParams {
  threadId: string;
}

export interface ThreadListParams {
  cursor?: string;
  limit?: number;
  modelProviders?: string[];
}

export interface Thread {
  id: string;
  preview: string;
  modelProvider: string;
  createdAt: number;
  path?: string;
  cwd?: string;
  cliVersion?: string;
  source?: 'NewSession' | 'ResumedSession' | 'ForkedSession';
  gitInfo?: {
    branch: string;
    sha: string;
    isDirty: boolean;
  };
  turns: Turn[];
}

// ============ Turn Management ============

export interface UserInputText {
  type: 'text';
  text: string;
}

export interface UserInputImage {
  type: 'image';
  imageUrl: string;
}

export interface UserInputLocalImage {
  type: 'localImage';
  path: string;
}

export interface UserInputSkill {
  type: 'skill';
  name: string;
  path?: string;
}

export type ProtocolUserInput = UserInputText | UserInputImage | UserInputLocalImage | UserInputSkill;

export interface TurnStartParams {
  threadId: string;
  input: ProtocolUserInput[];
  cwd?: string;
  approvalPolicy?: ProtocolApprovalPolicy;
  sandboxPolicy?: ProtocolSandboxMode;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  outputSchema?: Record<string, unknown>;
}

export interface TurnStartResult {
  turn: Turn;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface Turn {
  id: string;
  items: TurnItem[];
  status: 'Completed' | 'Interrupted' | 'Failed';
  error?: {
    code: string;
    message: string;
  };
}

// ============ Turn Items ============

export interface UserMessage {
  type: 'UserMessage';
  id: string;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; imageUrl: string }
    | { type: 'image'; base64: string; mimeType: string }
  >;
}

export interface AgentMessage {
  type: 'AgentMessage';
  id: string;
  text: string;
}

export interface Reasoning {
  type: 'Reasoning';
  id: string;
  summary: string;
  content: string;
}

export interface CommandExecution {
  type: 'CommandExecution';
  id: string;
  command: string;
  cwd: string;
  processId?: number;
  status: 'Running' | 'Completed';
  aggregatedOutput?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface FileChange {
  type: 'FileChange';
  id: string;
  changes: Array<{
    path: string;
    type: 'Created' | 'Modified' | 'Deleted';
    content?: string;
    diff?: string;
  }>;
  status: 'Running' | 'Completed';
}

export interface McpToolCall {
  type: 'McpToolCall';
  id: string;
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: 'Running' | 'Completed';
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface WebSearch {
  type: 'WebSearch';
  id: string;
  query: string;
}

export interface ImageView {
  type: 'ImageView';
  id: string;
  path: string;
}

export type TurnItem =
  | UserMessage
  | AgentMessage
  | Reasoning
  | CommandExecution
  | FileChange
  | McpToolCall
  | WebSearch
  | ImageView;
