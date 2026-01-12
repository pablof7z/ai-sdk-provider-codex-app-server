/**
 * Core type definitions for ai-sdk-provider-codex-app-server
 */

/**
 * Logger interface for custom logging
 */
export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Approval mode for tool/command execution
 */
export type ApprovalMode = 'never' | 'on-request' | 'on-failure' | 'always';

/**
 * Sandbox mode for file system access
 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Reasoning effort level
 */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * User input content types
 */
export type UserInput =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string }
  | { type: 'localImage'; path: string };

/**
 * MCP server transport configuration
 */
export interface McpServerStdio {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  enabledTools?: string[];
  disabledTools?: string[];
}

export interface McpServerHttp {
  transport: 'http';
  url: string;
  bearerToken?: string;
  bearerTokenEnvVar?: string;
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
  enabled?: boolean;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  enabledTools?: string[];
  disabledTools?: string[];
}

export type McpServerConfig = McpServerStdio | McpServerHttp;

/**
 * Session interface for mid-execution control
 *
 * The Session object is exposed via the `onSessionCreated` callback and provides
 * methods for injecting messages mid-execution and interrupting active turns.
 */
export interface Session {
  /** The thread ID for this session */
  readonly threadId: string;

  /** The current turn ID, or null if no turn is active */
  readonly turnId: string | null;

  /**
   * Inject a message into the active execution.
   * If a turn is active, the message is queued in the pending input buffer.
   * If no turn is active, a new turn is started with this message.
   */
  injectMessage(content: string | UserInput[]): Promise<void>;

  /**
   * Interrupt the current turn if one is active.
   */
  interrupt(): Promise<void>;

  /**
   * Check if a turn is currently active.
   */
  isActive(): boolean;
}

/**
 * Settings for the Codex App Server provider
 */
export interface CodexAppServerSettings {
  /**
   * Path to the codex binary. If not specified, uses PATH lookup.
   */
  codexPath?: string;

  /**
   * Working directory for the agent.
   */
  cwd?: string;

  /**
   * Approval mode for tool/command execution.
   * @default 'on-request'
   */
  approvalMode?: ApprovalMode;

  /**
   * Sandbox mode for file system access.
   * @default 'workspace-write'
   */
  sandboxMode?: SandboxMode;

  /**
   * Reasoning effort level for reasoning-capable models.
   */
  reasoningEffort?: ReasoningEffort;

  /**
   * MCP servers configuration.
   */
  mcpServers?: Record<string, McpServerConfig>;

  /**
   * Enable verbose logging.
   */
  verbose?: boolean;

  /**
   * Custom logger. Set to false to disable logging.
   */
  logger?: Logger | false;

  /**
   * Callback invoked when a Session is created.
   *
   * Use this to store the session for later injection via session.injectMessage().
   *
   * @example
   * ```typescript
   * const provider = createCodexAppServer({
   *   defaultSettings: {
   *     onSessionCreated: (session) => {
   *       // Store session for later use
   *       mySessionStore.set(agentId, session);
   *     }
   *   }
   * });
   * ```
   */
  onSessionCreated?: (session: Session) => void;

  /**
   * Environment variables to pass to the codex process.
   */
  env?: Record<string, string>;

  /**
   * Base instructions (system prompt) for the agent.
   */
  baseInstructions?: string;

  /**
   * Generic config overrides for codex CLI.
   * Each entry maps to: `-c <key>=<value>`
   */
  configOverrides?: Record<string, string | number | boolean | object>;

  /**
   * Resume an existing thread by ID.
   */
  resume?: string;
}

/**
 * Supported Codex model IDs
 */
export type CodexModelId =
  | 'gpt-5.1-codex'
  | 'gpt-5.1-codex-mini'
  | 'gpt-5.1-codex-max'
  | 'gpt-5.1'
  | 'gpt-5'
  | 'o3'
  | 'o4-mini'
  | (string & {});
