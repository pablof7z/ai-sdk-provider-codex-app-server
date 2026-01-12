/**
 * Local MCP server for serving in-process tools
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Tool } from './tool-builder.js';
import type { McpServerHttp } from '../types/index.js';

/**
 * Options for creating a local MCP server
 */
export interface LocalMcpServerOptions {
  /** Server name for identification */
  name: string;
  /** Tools to expose via MCP */
  tools: Tool[];
  /** Port to listen on (0 for random available port) */
  port?: number;
  /** Host to bind to (default: 127.0.0.1) */
  host?: string;
}

/**
 * Running local MCP server instance
 */
export interface LocalMcpServer {
  /** MCP server config to pass to provider */
  config: McpServerHttp;
  /** Server URL */
  url: string;
  /** Port the server is listening on */
  port: number;
  /** Stop the server */
  stop: () => Promise<void>;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Create a local HTTP server that implements MCP protocol for tools
 *
 * @example
 * ```typescript
 * const server = await createLocalMcpServer({
 *   name: 'my-tools',
 *   tools: [calculator, weather],
 * });
 *
 * // Use with provider
 * const provider = createCodexAppServer({
 *   mcpServers: { 'my-tools': server.config },
 * });
 *
 * // Cleanup when done
 * await server.stop();
 * ```
 */
export async function createLocalMcpServer(
  options: LocalMcpServerOptions
): Promise<LocalMcpServer> {
  const { name, tools, port = 0, host = '127.0.0.1' } = options;

  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const handleRequest = async (req: JsonRpcRequest): Promise<JsonRpcResponse> => {
    const { method, params, id } = req;

    // Handle initialize
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name,
            version: '1.0.0',
          },
        },
      };
    }

    // Handle tools/list
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };
    }

    // Handle tools/call
    if (method === 'tools/call') {
      const toolName = params?.name as string;
      const toolArgs = params?.arguments as Record<string, unknown>;

      const tool = toolMap.get(toolName);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Unknown tool: ${toolName}`,
          },
        };
      }

      try {
        const result = await tool.execute(toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result),
              },
            ],
          },
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    // Handle notifications (no response needed)
    if (method === 'notifications/initialized') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  };

  const httpHandler = async (req: IncomingMessage, res: ServerResponse) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString('utf-8');

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(body) as JsonRpcRequest;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
        })
      );
      return;
    }

    // Notifications have no id - just acknowledge with 202 Accepted
    if (request.id === undefined) {
      res.writeHead(202, {
        'Access-Control-Allow-Origin': '*',
      });
      res.end();
      return;
    }

    const response = await handleRequest(request);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(response));
  };

  const server: Server = createServer(httpHandler);

  return new Promise((resolve, reject) => {
    server.on('error', reject);

    server.listen(port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const actualPort = addr.port;
      const url = `http://${host}:${actualPort}`;

      // Register cleanup on process exit
      const cleanup = () => {
        server.close();
      };
      process.on('exit', cleanup);
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      resolve({
        config: {
          transport: 'http',
          url,
        },
        url,
        port: actualPort,
        stop: async () => {
          process.off('exit', cleanup);
          process.off('SIGINT', cleanup);
          process.off('SIGTERM', cleanup);
          return new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });
  });
}
