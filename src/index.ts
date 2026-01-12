/**
 * ai-sdk-provider-codex-app-server
 *
 * Vercel AI SDK v6 provider for OpenAI Codex using app-server mode
 * with mid-execution message injection support.
 *
 * @example
 * ```typescript
 * import { createCodexAppServer, type Session } from 'ai-sdk-provider-codex-app-server';
 * import { streamText } from 'ai';
 *
 * let session: Session;
 *
 * const provider = createCodexAppServer({
 *   defaultSettings: {
 *     onSessionCreated: (s) => { session = s; }
 *   }
 * });
 *
 * const model = provider('gpt-5.1-codex');
 *
 * // Start streaming
 * const resultPromise = streamText({
 *   model,
 *   prompt: 'Write a calculator in Python'
 * });
 *
 * // Mid-execution injection
 * await session.injectMessage('Also add a square root function');
 *
 * // Get result
 * const result = await resultPromise;
 * console.log(await result.text);
 * ```
 */

// Provider factory
export {
  createCodexAppServer,
  codexAppServer,
} from './codex-app-server-provider.js';
export type {
  CodexAppServerProvider,
  CodexAppServerProviderSettings,
} from './codex-app-server-provider.js';

// Discovery APIs
export { listModels } from './discovery.js';
export type { ListModelsOptions } from './discovery.js';

// Language model
export { CodexAppServerLanguageModel } from './codex-app-server-language-model.js';

// Session (for mid-execution injection)
export { SessionImpl } from './session.js';

// Types
export type {
  CodexAppServerSettings,
  CodexAppServerProviderOptions,
  CodexModelId,
  Session,
  UserInput,
  Logger,
  ApprovalMode,
  SandboxMode,
  ReasoningEffort,
  ThreadMode,
  McpServerConfig,
  McpServerConfigOrSdk,
  McpServerStdio,
  McpServerHttp,
} from './types/index.js';

// Validation
export { validateSettings } from './types/index.js';

// Errors
export {
  isAuthenticationError,
  isTimeoutError,
  getErrorMetadata,
  createAPICallError,
  createAuthenticationError,
  createTimeoutError,
} from './errors.js';
export type { CodexAppServerErrorMetadata } from './errors.js';

// Usage metadata types
export type { CodexUsageMetadata, ToolExecutionStats } from './stream/index.js';

// Protocol types (for advanced usage)
export type {
  Thread,
  Turn,
  TurnError,
  TurnItem,
  UserMessage,
  AgentMessage,
  CommandExecution,
  FileChange,
  McpToolCall,
  ModelInfo,
  ReasoningEffortOption,
} from './protocol/index.js';

// Local tools support
export { tool, createLocalMcpServer, createSdkMcpServer } from './tools/index.js';
export type {
  Tool,
  ToolDefinition,
  LocalMcpServer,
  LocalMcpServerOptions,
  SdkMcpServer,
  SdkMcpServerOptions,
} from './tools/index.js';
