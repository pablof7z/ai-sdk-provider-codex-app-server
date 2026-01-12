/**
 * Tracks active tool executions during a turn
 */

import type { CommandExecution, FileChange, McpToolCall, WebSearch } from '../protocol/index.js';
import { safeJsonStringify } from '../converters/index.js';

export interface ToolInfo {
  toolName: string;
  input: string;
  dynamic?: boolean;
}

type ToolItem = CommandExecution | FileChange | McpToolCall | WebSearch;

const TOOL_TYPES = new Set(['commandexecution', 'filechange', 'mcptoolcall', 'websearch']);

function normalizeToolType(type: string): string {
  return type.toLowerCase();
}

export function isToolItem(item: { type: string }): item is ToolItem {
  return TOOL_TYPES.has(normalizeToolType(item.type));
}

export function resolveToolName(item: ToolItem): { toolName: string; dynamic?: boolean } {
  const type = normalizeToolType(item.type);
  if (type === 'commandexecution') return { toolName: 'exec' };
  if (type === 'filechange') return { toolName: 'patch' };
  if (type === 'websearch') return { toolName: 'web_search' };
  if (type === 'mcptoolcall') {
    return { toolName: `mcp__${item.server}__${item.tool}`, dynamic: true };
  }
  return { toolName: 'tool' };
}

export function buildToolInputPayload(item: ToolItem): unknown {
  const type = normalizeToolType(item.type);
  if (type === 'commandexecution') {
    return {
      command: item.command,
      cwd: item.cwd,
      status: item.status,
    };
  }
  if (type === 'filechange') {
    return {
      changes: item.changes,
      status: item.status,
    };
  }
  if (type === 'mcptoolcall') {
    return {
      server: item.server,
      tool: item.tool,
      arguments: item.arguments,
      status: item.status,
    };
  }
  if (type === 'websearch') {
    return {
      query: item.query,
    };
  }
  return undefined;
}

export function buildToolResultPayload(item: ToolItem): {
  result: Record<string, unknown>;
  isError?: boolean;
} {
  const type = normalizeToolType(item.type);
  if (type === 'commandexecution') {
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

  if (type === 'filechange') {
    return {
      result: {
        changes: item.changes,
        status: item.status,
      },
    };
  }

  if (type === 'mcptoolcall') {
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

  if (type === 'websearch') {
    return { result: { query: item.query } };
  }

  return { result: {} };
}

export class ToolTracker {
  private activeTools = new Map<string, ToolInfo>();

  start(item: ToolItem): ToolInfo {
    const { toolName, dynamic } = resolveToolName(item);
    const inputPayload = buildToolInputPayload(item);
    const input = safeJsonStringify(inputPayload);
    const info: ToolInfo = { toolName, input, dynamic };
    this.activeTools.set(item.id, info);
    return info;
  }

  complete(itemId: string): ToolInfo | undefined {
    const info = this.activeTools.get(itemId);
    this.activeTools.delete(itemId);
    return info;
  }

  get(itemId: string): ToolInfo | undefined {
    return this.activeTools.get(itemId);
  }
}
