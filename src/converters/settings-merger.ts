/**
 * Settings merging utilities
 */

import type {
  CodexAppServerSettings,
  CodexAppServerProviderOptions,
  McpServerConfig,
  McpServerStdio,
  McpServerHttp,
} from '../types/index.js';

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

export function buildConfigOverrides(settings: CodexAppServerSettings): Record<string, unknown> | undefined {
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
    return {
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
    };
  }

  const baseHttp = existing as McpServerHttp;
  const hasIncomingAuth =
    incoming.bearerToken !== undefined || incoming.bearerTokenEnvVar !== undefined;
  const bearerToken = hasIncomingAuth ? incoming.bearerToken : baseHttp.bearerToken;
  const bearerTokenEnvVar = hasIncomingAuth
    ? incoming.bearerTokenEnvVar
    : baseHttp.bearerTokenEnvVar;

  return {
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
}

function mergeMcpServers(
  base?: Record<string, McpServerConfig>,
  override?: Record<string, McpServerConfig>
): Record<string, McpServerConfig> | undefined {
  if (!base) return override;
  if (!override) return base;

  const merged: Record<string, McpServerConfig> = { ...base };
  for (const [name, incoming] of Object.entries(override)) {
    merged[name] = mergeSingleMcpServer(base[name], incoming);
  }
  return merged;
}

export function mergeSettings(
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
