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
export type ProtocolSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ProtocolNetworkAccess = 'restricted' | 'enabled';
export type ProtocolSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly' }
  | { type: 'externalSandbox'; networkAccess?: ProtocolNetworkAccess }
  | {
      type: 'workspaceWrite';
      writableRoots?: string[];
      networkAccess?: boolean;
      excludeTmpdirEnvVar?: boolean;
      excludeSlashTmp?: boolean;
    };

export interface ThreadStartParams {
  model?: string;
  modelProvider?: string;
  cwd?: string;
  approvalPolicy?: ProtocolApprovalPolicy;
  sandbox?: ProtocolSandboxMode;
  baseInstructions?: string;
  developerInstructions?: string;
  experimentalRawEvents?: boolean;
  config?: Record<string, unknown>;
}

export interface ThreadStartResult {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
  approvalPolicy: ProtocolApprovalPolicy;
  sandbox: ProtocolSandboxPolicy;
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
  source?: string;
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
  sandboxPolicy?: ProtocolSandboxPolicy;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
  outputSchema?: Record<string, unknown>;
}

export interface TurnStartResult {
  turn: Turn;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface TurnError {
  code?: string;
  message?: string;
  codexErrorInfo?: string;
  additionalDetails?: unknown;
}

export interface Turn {
  id: string;
  items: TurnItem[];
  status:
    | 'completed'
    | 'interrupted'
    | 'failed'
    | 'inProgress'
    | 'Completed'
    | 'Interrupted'
    | 'Failed';
  error?: TurnError | null;
}

// ============ Turn Items ============

export interface UserMessage {
  type: 'userMessage' | 'UserMessage';
  id: string;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; imageUrl: string }
    | { type: 'image'; base64: string; mimeType: string }
  >;
}

export interface AgentMessage {
  type: 'agentMessage' | 'AgentMessage';
  id: string;
  text: string;
}

export interface Reasoning {
  type: 'reasoning' | 'Reasoning';
  id: string;
  summary: string[] | string;
  content: string[] | string;
}

export interface CommandExecution {
  type: 'commandExecution' | 'CommandExecution';
  id: string;
  command: string;
  cwd: string;
  processId?: string | number | null;
  status:
    | 'running'
    | 'completed'
    | 'inProgress'
    | 'failed'
    | 'declined'
    | 'Running'
    | 'Completed';
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
}

export interface FileChange {
  type: 'fileChange' | 'FileChange';
  id: string;
  changes: Array<Record<string, unknown>>;
  status:
    | 'running'
    | 'completed'
    | 'inProgress'
    | 'failed'
    | 'declined'
    | 'Running'
    | 'Completed';
}

export interface McpToolCall {
  type: 'mcpToolCall' | 'McpToolCall';
  id: string;
  server: string;
  tool: string;
  arguments: unknown;
  status: 'running' | 'completed' | 'inProgress' | 'failed' | 'Running' | 'Completed';
  result?: unknown | null;
  error?: unknown | null;
  durationMs?: number | null;
}

export interface WebSearch {
  type: 'webSearch' | 'WebSearch';
  id: string;
  query: string;
}

export interface ImageView {
  type: 'imageView' | 'ImageView';
  id: string;
  path: string;
}

// ============ Model Discovery ============

export interface ModelListParams {
  modelProviders?: string[];
}

export interface ReasoningEffortOption {
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
  description: string;
}

export interface ModelInfo {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: ReasoningEffortOption[];
  defaultReasoningEffort: string;
  isDefault: boolean;
}

export interface ModelListResult {
  data: ModelInfo[];
  nextCursor: string | null;
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
