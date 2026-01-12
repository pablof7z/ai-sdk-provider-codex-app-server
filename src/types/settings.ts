/**
 * Public type definitions for ai-sdk-provider-codex-app-server
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
export type ApprovalMode = 'never' | 'on-request' | 'on-failure' | 'untrusted';

/**
 * Sandbox mode for file system access
 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access' | 'full-access';

/**
 * Reasoning effort level
 */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Thread mode for app-server sessions.
 * - persistent: reuse a single thread across calls
 * - stateless: start a new thread for every call
 */
export type ThreadMode = 'persistent' | 'stateless';

/**
 * User input content types
 */
export type UserInput =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string }
  | { type: 'localImage'; path: string };

/**
 * MCP server base configuration
 */
interface McpServerBase {
  enabled?: boolean;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  enabledTools?: string[];
  disabledTools?: string[];
}

/**
 * MCP server stdio transport configuration
 */
export interface McpServerStdio extends McpServerBase {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * MCP server HTTP transport configuration
 */
export interface McpServerHttp extends McpServerBase {
  transport: 'http';
  url: string;
  bearerToken?: string;
  bearerTokenEnvVar?: string;
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
}

export type McpServerConfig = McpServerStdio | McpServerHttp;

// Import SdkMcpServer type for the union
import type { SdkMcpServer } from '../tools/sdk-mcp-server.js';

/**
 * MCP server config including SDK servers (resolved at runtime)
 * Users can pass SdkMcpServer directly; the provider handles the rest.
 */
export type McpServerConfigOrSdk = McpServerConfig | SdkMcpServer;

/**
 * Session interface for mid-execution control
 */
export interface Session {
  readonly threadId: string;
  readonly turnId: string | null;
  injectMessage(content: string | UserInput[]): Promise<void>;
  interrupt(): Promise<void>;
  isActive(): boolean;
}

/**
 * Settings for the Codex App Server provider
 */
export interface CodexAppServerSettings {
  codexPath?: string;
  cwd?: string;
  approvalMode?: ApprovalMode;
  sandboxMode?: SandboxMode;
  reasoningEffort?: ReasoningEffort;
  threadMode?: ThreadMode;
  /** MCP servers - can include SdkMcpServer for in-process tools */
  mcpServers?: Record<string, McpServerConfigOrSdk>;
  rmcpClient?: boolean;
  verbose?: boolean;
  logger?: Logger | false;
  onSessionCreated?: (session: Session) => void;
  env?: Record<string, string>;
  baseInstructions?: string;
  configOverrides?: Record<string, string | number | boolean | object>;
  resume?: string;
}

/**
 * Per-call overrides supplied through AI SDK providerOptions
 */
export interface CodexAppServerProviderOptions {
  reasoningEffort?: ReasoningEffort;
  threadMode?: ThreadMode;
  mcpServers?: Record<string, McpServerConfigOrSdk>;
  rmcpClient?: boolean;
  configOverrides?: Record<string, string | number | boolean | object>;
}

/**
 * Supported Codex model IDs
 */
export type CodexModelId =
  | 'gpt-5.1-codex'
  | 'gpt-5.1-codex-mini'
  | 'gpt-5.1-codex-max'
  | 'gpt-5.1'
  | 'gpt-5.2-codex'
  | 'gpt-5.2-codex-mini'
  | 'gpt-5.2-codex-max'
  | 'gpt-5.2'
  | 'gpt-5'
  | 'o3'
  | 'o4-mini'
  | (string & {});
