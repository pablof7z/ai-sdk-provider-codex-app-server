/**
 * CodexAppServerLanguageModel - implements AI SDK LanguageModelV3 interface
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Content,
  SharedV3Warning,
} from '@ai-sdk/provider';
import { parseProviderOptions } from '@ai-sdk/provider-utils';
import { randomUUID } from 'node:crypto';
import { AppServerClient } from './app-server-client.js';
import { SessionImpl } from './session.js';
import type {
  ApprovalMode,
  CodexAppServerProviderOptions,
  CodexAppServerSettings,
  CodexModelId,
  ReasoningEffort,
  SandboxMode,
  ThreadMode,
} from './types/index.js';
import { providerOptionsSchema } from './types/index.js';
import type {
  ProtocolApprovalPolicy,
  ProtocolSandboxMode,
  ProtocolSandboxPolicy,
  TurnStartParams,
} from './protocol/index.js';
import {
  buildConfigOverrides,
  mergeSettings,
  convertPrompt,
  cleanupTempFiles,
  resolveSdkMcpServers,
  stopSdkMcpServers,
} from './converters/index.js';
import {
  StreamEmitter,
  NotificationRouter,
  createUsage,
} from './stream/index.js';
import type { SdkMcpServer } from './tools/sdk-mcp-server.js';

const DEFAULT_THREAD_MODE: ThreadMode = 'persistent';

function mapApprovalMode(mode?: ApprovalMode): ProtocolApprovalPolicy {
  const validModes: ProtocolApprovalPolicy[] = ['never', 'on-request', 'on-failure', 'untrusted'];
  const normalized = mode?.toLowerCase() ?? 'on-request';
  return validModes.includes(normalized as ProtocolApprovalPolicy)
    ? (normalized as ProtocolApprovalPolicy)
    : 'on-request';
}

function mapSandboxMode(mode?: SandboxMode): ProtocolSandboxMode {
  const validModes: ProtocolSandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access'];
  const normalized = mode?.toLowerCase() ?? 'workspace-write';
  if (normalized === 'full-access') return 'danger-full-access';
  return validModes.includes(normalized as ProtocolSandboxMode)
    ? (normalized as ProtocolSandboxMode)
    : 'workspace-write';
}

function toSandboxPolicy(mode: ProtocolSandboxMode): ProtocolSandboxPolicy {
  switch (mode) {
    case 'read-only':
      return { type: 'readOnly' };
    case 'workspace-write':
      return { type: 'workspaceWrite' };
    case 'danger-full-access':
      return { type: 'dangerFullAccess' };
  }
}

function mapReasoningEffort(effort?: ReasoningEffort): TurnStartParams['effort'] {
  if (!effort || effort === 'none') return undefined;
  return effort;
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

function buildDeveloperInstructions(
  settings: CodexAppServerSettings,
  systemPrompt?: string
): string | undefined {
  const parts = [settings.baseInstructions, systemPrompt].filter(Boolean) as string[];
  return parts.length ? parts.join('\n\n') : undefined;
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
  private activeSdkServers: SdkMcpServer[] = [];

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

  async doGenerate(
    options: LanguageModelV3CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    const { stream } = await this.doStream(options);
    const reader = stream.getReader();
    let text = '';
    let finishReason: Awaited<ReturnType<LanguageModelV3['doGenerate']>>['finishReason'] = { unified: 'other', raw: undefined };
    let usage = createUsage();
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
    const mergedSettings = mergeSettings(this.settings, providerOptions);
    const threadMode = mergedSettings.threadMode ?? DEFAULT_THREAD_MODE;

    // Resolve SDK MCP servers (starts their HTTP servers)
    const { resolved: resolvedMcpServers, sdkServers } = await resolveSdkMcpServers(
      mergedSettings.mcpServers
    );
    // Track SDK servers for cleanup
    this.activeSdkServers = [...this.activeSdkServers.filter((s) => !sdkServers.includes(s)), ...sdkServers];

    // Create effective settings with resolved MCP config
    const effectiveSettings: CodexAppServerSettings = {
      ...mergedSettings,
      mcpServers: resolvedMcpServers,
    };

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
          developerInstructions: buildDeveloperInstructions(effectiveSettings, systemPrompt),
          config: buildConfigOverrides(effectiveSettings),
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
          developerInstructions: buildDeveloperInstructions(effectiveSettings, systemPrompt),
          config: buildConfigOverrides(effectiveSettings),
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
        sandboxPolicy: toSandboxPolicy(mapSandboxMode(effectiveSettings.sandboxMode)),
        model: this.modelId,
      };

      const effort = mapReasoningEffort(effectiveSettings.reasoningEffort);
      if (effort) turnParams.effort = effort;
      if (outputSchema) turnParams.outputSchema = outputSchema;

      const turnResult = await client.startTurn(turnParams);
      turnId = String(turnResult.turn.id);
      session._setTurnId(turnId);
    } catch (error) {
      cleanupTempFiles(tempFiles);
      throw error;
    }

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: (controller) => {
        const emitter = new StreamEmitter(controller, {
          threadId,
          turnId,
          modelId: this.modelId,
          includeRawChunks: options.includeRawChunks,
        });

        emitter.emitStreamStart(warnings);

        const cleanup = () => {
          cleanupTempFiles(tempFiles);
          if (threadMode === 'stateless') {
            this.currentSession = null;
          }
        };

        const router = new NotificationRouter(client, emitter, {
          threadId,
          turnId,
          onTurnCompleted: (status, error) => {
            session._setInactive();
            emitter.emitFinish(status, error);
            emitter.close();
            router.unsubscribe();
            cleanup();
          },
        });

        router.subscribe();

        options.abortSignal?.addEventListener('abort', async () => {
          try {
            await session.interrupt();
          } catch {
            // Ignore interrupt errors
          }
          router.unsubscribe();
          emitter.close();
          cleanup();
        });
      },
      cancel: () => {},
    });

    return { stream };
  }

  getSession(): SessionImpl | null {
    return this.currentSession;
  }

  dispose(): void {
    this.client?.dispose();
    this.client = null;
    this.currentSession = null;
    // Stop SDK MCP servers
    stopSdkMcpServers(this.activeSdkServers).catch(() => {
      // Ignore cleanup errors
    });
    this.activeSdkServers = [];
  }
}
