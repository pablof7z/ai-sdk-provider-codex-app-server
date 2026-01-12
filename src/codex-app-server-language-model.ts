/**
 * CodexAppServerLanguageModel - implements AI SDK LanguageModelV3 interface
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3FinishReason,
  LanguageModelV3Content,
  LanguageModelV3Usage,
  SharedV3Warning,
  LanguageModelV3Message,
  LanguageModelV3FilePart,
  LanguageModelV3ToolResultOutput,
} from '@ai-sdk/provider';
import { parseProviderOptions } from '@ai-sdk/provider-utils';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AppServerClient } from './app-server-client.js';
import { SessionImpl } from './session.js';
import type {
  ApprovalMode,
  CodexAppServerProviderOptions,
  CodexAppServerSettings,
  CodexModelId,
  McpServerConfig,
  McpServerHttp,
  McpServerStdio,
  ReasoningEffort,
  SandboxMode,
  ThreadMode,
} from './types.js';
import type {
  ProtocolApprovalPolicy,
  ProtocolSandboxMode,
  ProtocolUserInput,
  TurnStartParams,
  AgentMessageDeltaNotification,
  ReasoningTextDeltaNotification,
  ReasoningSummaryTextDeltaNotification,
  TurnCompletedNotification,
  ItemStartedNotification,
  ItemCompletedNotification,
  CommandExecutionRequestApprovalNotification,
  FileChangeRequestApprovalNotification,
  CommandExecution,
  FileChange,
  McpToolCall,
  WebSearch,
} from './protocol/index.js';

const providerOptionsSchema: z.ZodType<CodexAppServerProviderOptions> = z
  .object({
    reasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
    threadMode: z.enum(['persistent', 'stateless']).optional(),
    mcpServers: z
      .record(
        z.discriminatedUnion('transport', [
          z.object({
            transport: z.literal('stdio'),
            command: z.string(),
            args: z.array(z.string()).optional(),
            env: z.record(z.string()).optional(),
            cwd: z.string().optional(),
            enabled: z.boolean().optional(),
            startupTimeoutSec: z.number().optional(),
            toolTimeoutSec: z.number().optional(),
            enabledTools: z.array(z.string()).optional(),
            disabledTools: z.array(z.string()).optional(),
          }),
          z.object({
            transport: z.literal('http'),
            url: z.string(),
            bearerToken: z.string().optional(),
            bearerTokenEnvVar: z.string().optional(),
            httpHeaders: z.record(z.string()).optional(),
            envHttpHeaders: z.record(z.string()).optional(),
            enabled: z.boolean().optional(),
            startupTimeoutSec: z.number().optional(),
            toolTimeoutSec: z.number().optional(),
            enabledTools: z.array(z.string()).optional(),
            disabledTools: z.array(z.string()).optional(),
          }),
        ])
      )
      .optional(),
    rmcpClient: z.boolean().optional(),
    configOverrides: z
      .record(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.object({}).passthrough(),
          z.array(z.any()),
        ])
      )
      .optional(),
  })
  .strict();

const DEFAULT_THREAD_MODE: ThreadMode = 'persistent';

function createEmptyUsage(): LanguageModelV3Usage {
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

function mapFinishReason(status?: string): LanguageModelV3FinishReason {
  switch (status) {
    case 'Completed':
      return { unified: 'stop', raw: status };
    case 'Interrupted':
      return { unified: 'stop', raw: status };
    case 'Failed':
      return { unified: 'error', raw: status };
    default:
      return { unified: 'other', raw: status };
  }
}

function mapApprovalMode(mode?: ApprovalMode): ProtocolApprovalPolicy {
  const validModes: ProtocolApprovalPolicy[] = ['never', 'on-request', 'on-failure', 'untrusted'];
  const normalized = mode?.toLowerCase() ?? 'on-request';
  return validModes.includes(normalized as ProtocolApprovalPolicy)
    ? (normalized as ProtocolApprovalPolicy)
    : 'on-request';
}

function mapSandboxMode(mode?: SandboxMode): ProtocolSandboxMode {
  const validModes: ProtocolSandboxMode[] = ['read-only', 'workspace-write', 'full-access'];
  const normalized = mode?.toLowerCase() ?? 'workspace-write';
  return validModes.includes(normalized as ProtocolSandboxMode)
    ? (normalized as ProtocolSandboxMode)
    : 'workspace-write';
}

function mapReasoningEffort(effort?: ReasoningEffort): TurnStartParams['effort'] {
  if (!effort || effort === 'none') return undefined;
  return effort;
}

function safeJsonStringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

function flattenConfigOverrides(
  input: Record<string, string | number | boolean | object>,
  prefix = '',
  out: Record<string, unknown> = {}
): Record<string, unknown> {
  for (const [key, value] of Object.entries(input)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      const entries = Object.entries(value);
      if (!entries.length) {
        out[fullKey] = {};
        continue;
      }
      flattenConfigOverrides(value as Record<string, string | number | boolean | object>, fullKey, out);
      continue;
    }
    out[fullKey] = value;
  }
  return out;
}

function buildMcpConfigOverrides(servers?: Record<string, McpServerConfig>): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  if (!servers) return overrides;

  for (const [rawName, server] of Object.entries(servers)) {
    const name = rawName.trim();
    if (!name) continue;
    const prefix = `mcp_servers.${name}`;

    if (server.enabled !== undefined) overrides[`${prefix}.enabled`] = server.enabled;
    if (server.startupTimeoutSec !== undefined)
      overrides[`${prefix}.startup_timeout_sec`] = server.startupTimeoutSec;
    if (server.toolTimeoutSec !== undefined)
      overrides[`${prefix}.tool_timeout_sec`] = server.toolTimeoutSec;
    if (server.enabledTools !== undefined) overrides[`${prefix}.enabled_tools`] = server.enabledTools;
    if (server.disabledTools !== undefined)
      overrides[`${prefix}.disabled_tools`] = server.disabledTools;

    if (server.transport === 'stdio') {
      const stdio = server as McpServerStdio;
      overrides[`${prefix}.command`] = stdio.command;
      if (stdio.args !== undefined) overrides[`${prefix}.args`] = stdio.args;
      if (stdio.env !== undefined) overrides[`${prefix}.env`] = stdio.env;
      if (stdio.cwd) overrides[`${prefix}.cwd`] = stdio.cwd;
    } else {
      const http = server as McpServerHttp;
      overrides[`${prefix}.url`] = http.url;
      if (http.bearerToken !== undefined)
        overrides[`${prefix}.bearer_token`] = http.bearerToken;
      if (http.bearerTokenEnvVar !== undefined)
        overrides[`${prefix}.bearer_token_env_var`] = http.bearerTokenEnvVar;
      if (http.httpHeaders !== undefined)
        overrides[`${prefix}.http_headers`] = http.httpHeaders;
      if (http.envHttpHeaders !== undefined)
        overrides[`${prefix}.env_http_headers`] = http.envHttpHeaders;
    }
  }

  return overrides;
}

function buildConfigOverrides(settings: CodexAppServerSettings): Record<string, unknown> | undefined {
  const overrides: Record<string, unknown> = {};

  if (settings.rmcpClient !== undefined) {
    overrides['features.rmcp_client'] = settings.rmcpClient;
  }

  Object.assign(overrides, buildMcpConfigOverrides(settings.mcpServers));

  if (settings.configOverrides) {
    const flat = flattenConfigOverrides(settings.configOverrides);
    Object.assign(overrides, flat);
  }

  return Object.keys(overrides).length ? overrides : undefined;
}

function mergeStringRecord(
  base?: Record<string, string>,
  override?: Record<string, string>
): Record<string, string> | undefined {
  if (override !== undefined) {
    if (!Object.keys(override).length) return {};
    return { ...(base ?? {}), ...override };
  }
  if (base) return { ...base };
  return undefined;
}

function mergeSingleMcpServer(
  existing: McpServerConfig | undefined,
  incoming: McpServerConfig
): McpServerConfig {
  if (!existing || existing.transport !== incoming.transport) {
    return { ...incoming };
  }

  if (incoming.transport === 'stdio') {
    const baseStdio = existing as McpServerStdio;
    const result: McpServerConfig = {
      transport: 'stdio',
      command: incoming.command,
      args: incoming.args ?? baseStdio.args,
      env: mergeStringRecord(baseStdio.env, incoming.env),
      cwd: incoming.cwd ?? baseStdio.cwd,
      enabled: incoming.enabled ?? existing.enabled,
      startupTimeoutSec: incoming.startupTimeoutSec ?? existing.startupTimeoutSec,
      toolTimeoutSec: incoming.toolTimeoutSec ?? existing.toolTimeoutSec,
      enabledTools: incoming.enabledTools ?? existing.enabledTools,
      disabledTools: incoming.disabledTools ?? existing.disabledTools,
    } as McpServerConfig;
    return result;
  }

  const baseHttp = existing as McpServerHttp;
  const hasIncomingAuth =
    incoming.bearerToken !== undefined || incoming.bearerTokenEnvVar !== undefined;
  const bearerToken = hasIncomingAuth ? incoming.bearerToken : baseHttp.bearerToken;
  const bearerTokenEnvVar = hasIncomingAuth
    ? incoming.bearerTokenEnvVar
    : baseHttp.bearerTokenEnvVar;

  const result: McpServerConfig = {
    transport: 'http',
    url: incoming.url,
    bearerToken,
    bearerTokenEnvVar,
    httpHeaders: mergeStringRecord(baseHttp.httpHeaders, incoming.httpHeaders),
    envHttpHeaders: mergeStringRecord(baseHttp.envHttpHeaders, incoming.envHttpHeaders),
    enabled: incoming.enabled ?? existing.enabled,
    startupTimeoutSec: incoming.startupTimeoutSec ?? existing.startupTimeoutSec,
    toolTimeoutSec: incoming.toolTimeoutSec ?? existing.toolTimeoutSec,
    enabledTools: incoming.enabledTools ?? existing.enabledTools,
    disabledTools: incoming.disabledTools ?? existing.disabledTools,
  };

  return result;
}

function mergeMcpServers(
  base?: Record<string, McpServerConfig>,
  override?: Record<string, McpServerConfig>
): Record<string, McpServerConfig> | undefined {
  if (!base) return override;
  if (!override) return base;

  const merged: Record<string, McpServerConfig> = { ...base };
  for (const [name, incoming] of Object.entries(override)) {
    const existing = base[name];
    merged[name] = mergeSingleMcpServer(existing, incoming);
  }
  return merged;
}

function mergeSettings(
  baseSettings: CodexAppServerSettings,
  providerOptions?: CodexAppServerProviderOptions
): CodexAppServerSettings {
  if (!providerOptions) return baseSettings;

  const mergedConfigOverrides =
    providerOptions.configOverrides || baseSettings.configOverrides
      ? {
          ...(baseSettings.configOverrides ?? {}),
          ...(providerOptions.configOverrides ?? {}),
        }
      : undefined;

  const mergedMcpServers = mergeMcpServers(baseSettings.mcpServers, providerOptions.mcpServers);

  return {
    ...baseSettings,
    reasoningEffort: providerOptions.reasoningEffort ?? baseSettings.reasoningEffort,
    threadMode: providerOptions.threadMode ?? baseSettings.threadMode,
    configOverrides: mergedConfigOverrides,
    mcpServers: mergedMcpServers,
    rmcpClient: providerOptions.rmcpClient ?? baseSettings.rmcpClient,
  };
}

function buildUnsupportedWarnings(options: LanguageModelV3CallOptions): SharedV3Warning[] {
  const warnings: SharedV3Warning[] = [];
  const add = (value: unknown, feature: string) => {
    if (value !== undefined) {
      warnings.push({
        type: 'unsupported',
        feature,
        details: `Codex app-server does not support ${feature}; it will be ignored.`,
      });
    }
  };

  add(options.maxOutputTokens, 'maxOutputTokens');
  add(options.temperature, 'temperature');
  add(options.topP, 'topP');
  add(options.topK, 'topK');
  add(options.presencePenalty, 'presencePenalty');
  add(options.frequencyPenalty, 'frequencyPenalty');
  add(options.stopSequences?.length ? options.stopSequences : undefined, 'stopSequences');
  add((options as { seed?: unknown }).seed, 'seed');
  add(options.tools?.length ? options.tools : undefined, 'tools');
  add(options.toolChoice, 'toolChoice');

  return warnings;
}

function isImageMediaType(mediaType?: string): boolean {
  return typeof mediaType === 'string' && mediaType.toLowerCase().startsWith('image/');
}

function mediaTypeToExtension(mediaType: string): string {
  const lower = mediaType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('bmp')) return 'bmp';
  if (lower.includes('tiff')) return 'tiff';
  return 'img';
}

function writeTempImage(data: Uint8Array, mediaType: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'codex-app-server-'));
  const ext = mediaTypeToExtension(mediaType);
  const filePath = join(dir, `image.${ext}`);
  writeFileSync(filePath, data);
  return filePath;
}

function cleanupTempFiles(paths: string[]): void {
  for (const filePath of paths) {
    try {
      const dir = dirname(filePath);
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

function toImageInput(
  part: LanguageModelV3FilePart,
  tempFiles: string[],
  warnings: SharedV3Warning[]
): ProtocolUserInput | undefined {
  if (!isImageMediaType(part.mediaType)) {
    warnings.push({
      type: 'other',
      message: `Unsupported file mediaType "${part.mediaType}"; only image/* is supported.`,
    });
    return undefined;
  }

  const mediaType = part.mediaType;
  const data = part.data;

  if (data instanceof URL) {
    if (data.protocol === 'file:') {
      return { type: 'localImage', path: fileURLToPath(data) };
    }
    if (data.protocol === 'http:' || data.protocol === 'https:' || data.protocol === 'data:') {
      return { type: 'image', imageUrl: data.href };
    }
    warnings.push({
      type: 'other',
      message: `Unsupported image URL protocol "${data.protocol}".`,
    });
    return undefined;
  }

  if (typeof data === 'string') {
    if (data.startsWith('data:') || data.startsWith('http://') || data.startsWith('https://')) {
      return { type: 'image', imageUrl: data };
    }
    if (data.startsWith('file://')) {
      try {
        return { type: 'localImage', path: fileURLToPath(data) };
      } catch {
        warnings.push({
          type: 'other',
          message: 'Unable to read file URL for image input.',
        });
        return undefined;
      }
    }
    try {
      const buffer = Buffer.from(data, 'base64');
      const filePath = writeTempImage(buffer, mediaType);
      tempFiles.push(filePath);
      return { type: 'localImage', path: filePath };
    } catch {
      warnings.push({
        type: 'other',
        message: 'Unable to decode base64 image data.',
      });
      return undefined;
    }
  }

  if (data instanceof Uint8Array) {
    const filePath = writeTempImage(data, mediaType);
    tempFiles.push(filePath);
    return { type: 'localImage', path: filePath };
  }

  warnings.push({
    type: 'other',
    message: 'Unsupported image data type provided in file input.',
  });
  return undefined;
}

function extractSystemPrompt(prompt: LanguageModelV3Message[]): string | undefined {
  const systemParts: string[] = [];
  for (const message of prompt) {
    if (message.role === 'system' && typeof message.content === 'string') {
      systemParts.push(message.content);
    }
  }
  return systemParts.length ? systemParts.join('\n\n') : undefined;
}

function extractUserMessagesForTurn(prompt: LanguageModelV3Message[]): LanguageModelV3Message[] {
  const collected: LanguageModelV3Message[] = [];

  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const msg = prompt[i];
    if (!msg) continue;
    if (msg.role === 'user') {
      collected.push(msg);
    } else if (collected.length) {
      break;
    }
  }

  if (!collected.length) {
    for (let i = prompt.length - 1; i >= 0; i -= 1) {
      const msg = prompt[i];
      if (!msg) continue;
      if (msg.role === 'user') {
        collected.push(msg);
        break;
      }
    }
  }

  return collected.reverse();
}

function formatToolResultOutput(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case 'text':
      return output.value;
    case 'json':
      return safeJsonStringify(output.value);
    case 'execution-denied':
      return output.reason ? `Execution denied: ${output.reason}` : 'Execution denied';
    case 'error-text':
      return output.value;
    case 'error-json':
      return safeJsonStringify(output.value);
    case 'content': {
      const parts = output.value
        .map((part) => {
          if (part.type === 'text') return part.text;
          if (part.type === 'file-data') return `[file: ${part.mediaType}]`;
          return '';
        })
        .filter(Boolean);
      return parts.join('\n');
    }
    default:
      return '';
  }
}

function buildTranscript(
  prompt: LanguageModelV3Message[],
  warnings: SharedV3Warning[]
): { transcript: string; images: LanguageModelV3FilePart[] } {
  const lines: string[] = [];
  let lastUserImages: LanguageModelV3FilePart[] = [];

  for (const message of prompt) {
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      const textParts: string[] = [];
      const images: LanguageModelV3FilePart[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          textParts.push(part.text);
        } else if (part.type === 'file') {
          if (isImageMediaType(part.mediaType)) {
            images.push(part);
          } else {
            warnings.push({
              type: 'other',
              message: `Unsupported file mediaType "${part.mediaType}"; only image/* is supported.`,
            });
          }
        }
      }

      const text = textParts.join('\n');
      const imageNote = images.length
        ? `[${images.length} image${images.length === 1 ? '' : 's'} attached]`
        : '';
      const combined = [text, imageNote].filter(Boolean).join('\n');
      if (combined) {
        lines.push(`User: ${combined}`);
      }

      if (images.length) {
        lastUserImages = images;
      }
      continue;
    }

    if (message.role === 'assistant') {
      const textParts: string[] = [];
      const toolLines: string[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          textParts.push(part.text);
        } else if (part.type === 'tool-call') {
          const input = safeJsonStringify(part.input);
          toolLines.push(`Tool Call (${part.toolName}): ${input}`);
        } else if (part.type === 'tool-result') {
          toolLines.push(
            `Tool Result (${part.toolName}): ${formatToolResultOutput(part.output)}`
          );
        }
      }

      const text = textParts.join('\n');
      if (text) {
        lines.push(`Assistant: ${text}`);
      }
      for (const line of toolLines) {
        lines.push(line);
      }
      continue;
    }

    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type === 'tool-result') {
          lines.push(
            `Tool Result (${part.toolName}): ${formatToolResultOutput(part.output)}`
          );
        } else if (part.type === 'tool-approval-response') {
          const decision = part.approved ? 'approved' : 'denied';
          const reason = part.reason ? ` (${part.reason})` : '';
          lines.push(`Tool Approval (${part.approvalId}): ${decision}${reason}`);
        }
      }
    }
  }

  return { transcript: lines.join('\n\n'), images: lastUserImages };
}

function convertPrompt(
  prompt: LanguageModelV3Message[],
  threadMode: ThreadMode
): {
  inputs: ProtocolUserInput[];
  systemPrompt?: string;
  warnings: SharedV3Warning[];
  tempFiles: string[];
} {
  const warnings: SharedV3Warning[] = [];
  const tempFiles: string[] = [];
  const systemPrompt = extractSystemPrompt(prompt);

  if (threadMode === 'stateless') {
    const { transcript, images } = buildTranscript(prompt, warnings);
    const inputs: ProtocolUserInput[] = [];

    if (transcript.trim()) {
      inputs.push({ type: 'text', text: transcript });
    }

    for (const imagePart of images) {
      const input = toImageInput(imagePart, tempFiles, warnings);
      if (input) inputs.push(input);
    }

    if (!inputs.length) {
      warnings.push({
        type: 'other',
        message: 'No user input found; starting a stateless turn with empty input.',
      });
    }

    return { inputs, systemPrompt, warnings, tempFiles };
  }

  const inputs: ProtocolUserInput[] = [];
  const userMessages = extractUserMessagesForTurn(prompt);

  for (const message of userMessages) {
    if (message.role !== 'user') continue;
    for (const part of message.content) {
      if (part.type === 'text') {
        inputs.push({ type: 'text', text: part.text });
      } else if (part.type === 'file') {
        const input = toImageInput(part, tempFiles, warnings);
        if (input) inputs.push(input);
      }
    }
  }

  if (!inputs.length) {
    warnings.push({
      type: 'other',
      message: 'No user input found; starting a turn with empty input.',
    });
  }

  return { inputs, systemPrompt, warnings, tempFiles };
}

function buildBaseInstructions(
  settings: CodexAppServerSettings,
  systemPrompt?: string
): string | undefined {
  const parts = [settings.baseInstructions, systemPrompt].filter(Boolean) as string[];
  return parts.length ? parts.join('\n\n') : undefined;
}

function buildToolInputPayload(item: CommandExecution | FileChange | McpToolCall | WebSearch): unknown {
  if (item.type === 'CommandExecution') {
    return {
      command: item.command,
      cwd: item.cwd,
      status: item.status,
    };
  }
  if (item.type === 'FileChange') {
    return {
      changes: item.changes,
      status: item.status,
    };
  }
  if (item.type === 'McpToolCall') {
    return {
      server: item.server,
      tool: item.tool,
      arguments: item.arguments,
      status: item.status,
    };
  }
  if (item.type === 'WebSearch') {
    return {
      query: item.query,
    };
  }
  return undefined;
}

function buildToolResultPayload(item: CommandExecution | FileChange | McpToolCall | WebSearch): {
  result: Record<string, unknown>;
  isError?: boolean;
} {
  if (item.type === 'CommandExecution') {
    const result: Record<string, unknown> = {
      command: item.command,
      cwd: item.cwd,
      status: item.status,
    };
    if (item.aggregatedOutput !== undefined) result.aggregatedOutput = item.aggregatedOutput;
    if (item.exitCode !== undefined) result.exitCode = item.exitCode;
    if (item.durationMs !== undefined) result.durationMs = item.durationMs;
    if (item.processId !== undefined) result.processId = item.processId;

    const isError = item.exitCode !== undefined && item.exitCode !== 0;
    return { result, isError: isError ? true : undefined };
  }

  if (item.type === 'FileChange') {
    const result: Record<string, unknown> = {
      changes: item.changes,
      status: item.status,
    };
    return { result };
  }

  if (item.type === 'McpToolCall') {
    const result: Record<string, unknown> = {
      server: item.server,
      tool: item.tool,
      status: item.status,
    };
    if (item.result !== undefined) result.result = item.result;
    if (item.error !== undefined) result.error = item.error;
    if (item.durationMs !== undefined) result.durationMs = item.durationMs;
    return { result, isError: item.error ? true : undefined };
  }

  if (item.type === 'WebSearch') {
    return { result: { query: item.query } };
  }

  return { result: {} };
}

function resolveToolName(item: CommandExecution | FileChange | McpToolCall | WebSearch): {
  toolName: string;
  dynamic?: boolean;
} {
  if (item.type === 'CommandExecution') return { toolName: 'exec' };
  if (item.type === 'FileChange') return { toolName: 'patch' };
  if (item.type === 'WebSearch') return { toolName: 'web_search' };
  return { toolName: `mcp__${item.server}__${item.tool}`, dynamic: true };
}

/**
 * LanguageModelV3 implementation for Codex App Server
 */
export class CodexAppServerLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'codex-app-server';
  readonly supportedUrls: Record<string, RegExp[]> = {};
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsStructuredOutputs = true;
  readonly supportsImageUrls = true;

  private client: AppServerClient | null = null;
  private currentSession: SessionImpl | null = null;

  constructor(
    public readonly modelId: CodexModelId,
    private settings: CodexAppServerSettings
  ) {}

  private getClient(): AppServerClient {
    if (!this.client) {
      this.client = new AppServerClient(this.settings);
    }
    return this.client;
  }

  private mergeSettings(providerOptions?: CodexAppServerProviderOptions): CodexAppServerSettings {
    return mergeSettings(this.settings, providerOptions);
  }

  async doGenerate(
    options: LanguageModelV3CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    const { stream } = await this.doStream(options);
    const reader = stream.getReader();
    let text = '';
    let finishReason: LanguageModelV3FinishReason = { unified: 'other', raw: undefined };
    let usage: LanguageModelV3Usage = createEmptyUsage();
    const warnings: SharedV3Warning[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value.type === 'text-delta') {
        text += value.delta;
      } else if (value.type === 'stream-start') {
        warnings.push(...value.warnings);
      } else if (value.type === 'finish') {
        finishReason = value.finishReason;
        usage = value.usage;
      }
    }

    const content: LanguageModelV3Content[] = text ? [{ type: 'text', text }] : [];

    return {
      content,
      finishReason,
      usage,
      warnings,
      response: {
        id: randomUUID(),
        timestamp: new Date(),
        modelId: this.modelId,
      },
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions
  ): Promise<{
    stream: ReadableStream<LanguageModelV3StreamPart>;
    request?: { body?: unknown };
    response?: { headers?: Record<string, string> };
  }> {
    const client = this.getClient();

    const providerOptions = await parseProviderOptions<CodexAppServerProviderOptions>({
      provider: this.provider,
      providerOptions: options.providerOptions,
      schema: providerOptionsSchema,
    });
    const effectiveSettings = this.mergeSettings(providerOptions);
    const threadMode = effectiveSettings.threadMode ?? DEFAULT_THREAD_MODE;

    const { inputs, systemPrompt, warnings: promptWarnings, tempFiles } = convertPrompt(
      options.prompt,
      threadMode
    );

    const warnings: SharedV3Warning[] = [
      ...buildUnsupportedWarnings(options),
      ...promptWarnings,
    ];

    const willReuseThread =
      threadMode !== 'stateless' && (effectiveSettings.resume || this.currentSession?.threadId);
    if (willReuseThread && systemPrompt) {
      warnings.push({
        type: 'other',
        message: 'System prompt is ignored when reusing an existing thread.',
      });
    }

    const outputSchema =
      options.responseFormat?.type === 'json'
        ? (options.responseFormat.schema as Record<string, unknown> | undefined)
        : undefined;

    let threadId = '';
    let turnId = '';
    let session: SessionImpl;

    try {
      if (threadMode === 'stateless') {
        const threadResult = await client.startThread({
          model: this.modelId,
          cwd: effectiveSettings.cwd,
          approvalPolicy: mapApprovalMode(effectiveSettings.approvalMode),
          sandbox: mapSandboxMode(effectiveSettings.sandboxMode),
          baseInstructions: buildBaseInstructions(effectiveSettings, systemPrompt),
          configOverrides: buildConfigOverrides(effectiveSettings),
        });
        threadId = threadResult.thread.id;
      } else if (effectiveSettings.resume) {
        const resumeResult = await client.resumeThread({
          threadId: effectiveSettings.resume,
        });
        threadId = resumeResult.thread.id;
      } else if (this.currentSession?.threadId) {
        threadId = this.currentSession.threadId;
      } else {
        const threadResult = await client.startThread({
          model: this.modelId,
          cwd: effectiveSettings.cwd,
          approvalPolicy: mapApprovalMode(effectiveSettings.approvalMode),
          sandbox: mapSandboxMode(effectiveSettings.sandboxMode),
          baseInstructions: buildBaseInstructions(effectiveSettings, systemPrompt),
          configOverrides: buildConfigOverrides(effectiveSettings),
        });
        threadId = threadResult.thread.id;
      }

      session = new SessionImpl(client, threadId);
      this.currentSession = session;

      this.settings.onSessionCreated?.(session);

      const turnParams: TurnStartParams = {
        threadId,
        input: inputs,
        cwd: effectiveSettings.cwd,
        approvalPolicy: mapApprovalMode(effectiveSettings.approvalMode),
        sandboxPolicy: mapSandboxMode(effectiveSettings.sandboxMode),
        model: this.modelId,
      };

      const effort = mapReasoningEffort(effectiveSettings.reasoningEffort);
      if (effort) turnParams.effort = effort;
      if (outputSchema) turnParams.outputSchema = outputSchema;

      const turnResult = await client.startTurn(turnParams);
      session._setTurnId(turnResult.turn.id);

      turnId = turnResult.turn.id;
    } catch (error) {
      cleanupTempFiles(tempFiles);
      throw error;
    }
    const textId = randomUUID();
    const reasoningId = randomUUID();

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: (controller) => {
        controller.enqueue({ type: 'stream-start', warnings });
        controller.enqueue({
          type: 'response-metadata',
          id: turnId,
          timestamp: new Date(),
          modelId: this.modelId,
        });

        let textStarted = false;
        let reasoningStarted = false;

        const activeTools = new Map<
          string,
          { toolName: string; input: string; dynamic?: boolean }
        >();

        const emitRaw = (method: string, params: unknown) => {
          if (options.includeRawChunks) {
            controller.enqueue({ type: 'raw', rawValue: { method, params } });
          }
        };

        const emitToolCall = (toolCallId: string, toolName: string, input: string, dynamic?: boolean) => {
          controller.enqueue({
            type: 'tool-call',
            toolCallId,
            toolName,
            input,
            providerExecuted: true,
            ...(dynamic ? { dynamic: true } : {}),
          });
        };

        const emitToolInput = (
          toolCallId: string,
          toolName: string,
          input: string,
          dynamic?: boolean
        ) => {
          controller.enqueue({
            type: 'tool-input-start',
            id: toolCallId,
            toolName,
            providerExecuted: true,
            ...(dynamic ? { dynamic: true } : {}),
          });
          if (input) {
            controller.enqueue({ type: 'tool-input-delta', id: toolCallId, delta: input });
          }
          controller.enqueue({ type: 'tool-input-end', id: toolCallId });
        };

        const emitToolResult = (
          toolCallId: string,
          toolName: string,
          result: Record<string, unknown>,
          isError?: boolean,
          dynamic?: boolean
        ) => {
          controller.enqueue({
            type: 'tool-result',
            toolCallId,
            toolName,
            result: (result ?? {}) as NonNullable<import('@ai-sdk/provider').JSONValue>,
            ...(isError ? { isError: true } : {}),
            ...(dynamic ? { dynamic: true } : {}),
          });
        };

        const cleanup = () => {
          cleanupTempFiles(tempFiles);
          if (threadMode === 'stateless') {
            this.currentSession = null;
          }
        };

        const handleTextDelta = (params: unknown) => {
          const p = params as AgentMessageDeltaNotification['params'];
          if (p.threadId !== threadId) return;
          if (!textStarted) {
            textStarted = true;
            controller.enqueue({ type: 'text-start', id: textId });
          }
          controller.enqueue({ type: 'text-delta', id: textId, delta: p.delta });
        };

        const handleReasoningDelta = (params: unknown, isSummary = false) => {
          const p = params as
            | ReasoningTextDeltaNotification['params']
            | ReasoningSummaryTextDeltaNotification['params'];
          if (p.threadId !== threadId) return;
          if (!reasoningStarted) {
            reasoningStarted = true;
            controller.enqueue({ type: 'reasoning-start', id: reasoningId });
          }
          const delta = 'delta' in p ? p.delta : '';
          const prefix = isSummary ? '[summary] ' : '';
          controller.enqueue({ type: 'reasoning-delta', id: reasoningId, delta: `${prefix}${delta}` });
        };

        const unsubDelta = client.onNotification('item/agentMessage/delta', (params) => {
          emitRaw('item/agentMessage/delta', params);
          handleTextDelta(params);
        });

        const unsubDeltaAlt = client.onNotification('agentMessageDelta', (params) => {
          emitRaw('agentMessageDelta', params);
          handleTextDelta(params);
        });

        const unsubReasoning = client.onNotification('reasoningTextDelta', (params) => {
          emitRaw('reasoningTextDelta', params);
          handleReasoningDelta(params, false);
        });

        const unsubReasoningSummary = client.onNotification('reasoningSummaryTextDelta', (params) => {
          emitRaw('reasoningSummaryTextDelta', params);
          handleReasoningDelta(params, true);
        });

        const unsubItemStarted = client.onNotification('item/started', (params) => {
          emitRaw('item/started', params);
          const p = params as ItemStartedNotification['params'];
          if (p.threadId !== threadId || p.turnId !== turnId) return;
          const item = p.item as CommandExecution | FileChange | McpToolCall | WebSearch;

          const { toolName, dynamic } = resolveToolName(item);
          const inputPayload = buildToolInputPayload(item);
          const input = safeJsonStringify(inputPayload);

          emitToolInput(item.id, toolName, input, dynamic);
          emitToolCall(item.id, toolName, input, dynamic);

          activeTools.set(item.id, { toolName, input, dynamic });
        });

        const unsubItemCompleted = client.onNotification('item/completed', (params) => {
          emitRaw('item/completed', params);
          const p = params as ItemCompletedNotification['params'];
          if (p.threadId !== threadId || p.turnId !== turnId) return;
          const item = p.item as CommandExecution | FileChange | McpToolCall | WebSearch;

          const existing = activeTools.get(item.id);
          const resolved = existing ?? resolveToolName(item);
          const toolName = 'toolName' in resolved ? resolved.toolName : existing?.toolName ?? 'tool';
          const dynamic = 'dynamic' in resolved ? resolved.dynamic : existing?.dynamic;

          const { result, isError } = buildToolResultPayload(item);
          emitToolResult(item.id, toolName, result, isError, dynamic);
          activeTools.delete(item.id);
        });

        const unsubApprovalCommand = client.onNotification(
          'item/commandExecution/requestApproval',
          (params) => {
            emitRaw('item/commandExecution/requestApproval', params);
            const p = params as CommandExecutionRequestApprovalNotification['params'];
            if (p.threadId !== threadId || p.turnId !== turnId) return;
            controller.enqueue({
              type: 'tool-approval-request',
              approvalId: p.itemId,
              toolCallId: p.itemId,
            });
          }
        );

        const unsubApprovalFile = client.onNotification('item/fileChange/requestApproval', (params) => {
          emitRaw('item/fileChange/requestApproval', params);
          const p = params as FileChangeRequestApprovalNotification['params'];
          if (p.threadId !== threadId || p.turnId !== turnId) return;
          controller.enqueue({
            type: 'tool-approval-request',
            approvalId: p.itemId,
            toolCallId: p.itemId,
          });
        });

        const unsubComplete = client.onNotification('turn/completed', (params) => {
          emitRaw('turn/completed', params);
          const p = params as TurnCompletedNotification['params'];
          if (p.threadId !== threadId || p.turn.id !== turnId) return;

          session._setInactive();

          if (textStarted) {
            controller.enqueue({ type: 'text-end', id: textId });
          }
          if (reasoningStarted) {
            controller.enqueue({ type: 'reasoning-end', id: reasoningId });
          }

          controller.enqueue({
            type: 'finish',
            finishReason: mapFinishReason(p.turn.status),
            usage: createEmptyUsage(),
          });

          controller.close();

          unsubDelta();
          unsubDeltaAlt();
          unsubReasoning();
          unsubReasoningSummary();
          unsubItemStarted();
          unsubItemCompleted();
          unsubApprovalCommand();
          unsubApprovalFile();
          unsubComplete();
          cleanup();
        });

        options.abortSignal?.addEventListener('abort', async () => {
          try {
            await session.interrupt();
          } catch {
            // Ignore interrupt errors
          }
          unsubDelta();
          unsubDeltaAlt();
          unsubReasoning();
          unsubReasoningSummary();
          unsubItemStarted();
          unsubItemCompleted();
          unsubApprovalCommand();
          unsubApprovalFile();
          unsubComplete();
          controller.close();
          cleanup();
        });
      },
      cancel: () => {},
    });

    return { stream };
  }

  /**
   * Get the current session for external access
   */
  getSession(): SessionImpl | null {
    return this.currentSession;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.client?.dispose();
    this.client = null;
    this.currentSession = null;
  }
}
