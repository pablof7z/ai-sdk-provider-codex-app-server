/**
 * SDK MCP Server - In-process tool support like Claude Code's createSdkMcpServer
 *
 * Creates an MCP server configuration that the provider handles automatically.
 * The HTTP server is an implementation detail - users just pass tools.
 */

import type { Tool } from './tool-builder.js';
import { createLocalMcpServer, type LocalMcpServer } from './local-mcp-server.js';

/**
 * Marker symbol to identify SDK MCP server configs
 */
export const SDK_MCP_SERVER_MARKER = Symbol.for('codex-sdk-mcp-server');

/**
 * SDK MCP server configuration - passed to provider's mcpServers
 */
export interface SdkMcpServer {
  /** Marker to identify this as an SDK MCP server */
  readonly [SDK_MCP_SERVER_MARKER]: true;
  /** Server name */
  readonly name: string;
  /** Tools to expose */
  readonly tools: Tool[];
  /** Internal: running server instance (set by provider) */
  _server?: LocalMcpServer;
  /** Internal: start the server and return HTTP config */
  _start(): Promise<{ transport: 'http'; url: string }>;
  /** Internal: stop the server */
  _stop(): Promise<void>;
}

/**
 * Options for creating an SDK MCP server
 */
export interface SdkMcpServerOptions {
  /** Server name for identification */
  name: string;
  /** Tools to expose */
  tools: Tool[];
}

/**
 * Create an in-process MCP server for local tools.
 *
 * This is the Codex equivalent of Claude Code's createSdkMcpServer.
 * Pass the result directly to mcpServers in provider settings.
 *
 * @example
 * ```typescript
 * import { createSdkMcpServer, tool } from 'ai-sdk-provider-codex-app-server';
 * import { z } from 'zod';
 *
 * const calculator = tool({
 *   name: 'add',
 *   description: 'Add two numbers',
 *   parameters: z.object({ a: z.number(), b: z.number() }),
 *   execute: async ({ a, b }) => ({ result: a + b }),
 * });
 *
 * const server = createSdkMcpServer({
 *   name: 'my-tools',
 *   tools: [calculator],
 * });
 *
 * const provider = createCodexAppServer({
 *   defaultSettings: {
 *     mcpServers: { 'my-tools': server },
 *   },
 * });
 * ```
 */
export function createSdkMcpServer(options: SdkMcpServerOptions): SdkMcpServer {
  const { name, tools } = options;

  let server: LocalMcpServer | undefined;
  let startPromise: Promise<{ transport: 'http'; url: string }> | undefined;

  return {
    [SDK_MCP_SERVER_MARKER]: true as const,
    name,
    tools,

    get _server() {
      return server;
    },

    set _server(s: LocalMcpServer | undefined) {
      server = s;
    },

    async _start() {
      // Only start once
      if (startPromise) {
        return startPromise;
      }

      startPromise = (async () => {
        // Stop existing server if any
        if (server) {
          await server.stop();
        }

        server = await createLocalMcpServer({
          name,
          tools,
        });

        return {
          transport: 'http' as const,
          url: server.url,
        };
      })();

      return startPromise;
    },

    async _stop() {
      if (server) {
        await server.stop();
        server = undefined;
      }
      startPromise = undefined;
    },
  };
}

/**
 * Check if a value is an SDK MCP server
 */
export function isSdkMcpServer(value: unknown): value is SdkMcpServer {
  return (
    typeof value === 'object' &&
    value !== null &&
    SDK_MCP_SERVER_MARKER in value &&
    (value as Record<symbol, unknown>)[SDK_MCP_SERVER_MARKER] === true
  );
}
