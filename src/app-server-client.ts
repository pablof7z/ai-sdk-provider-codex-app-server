/**
 * AppServerClient - manages the codex app-server process and JSON-RPC communication
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  JSONRPCNotification,
  InitializeParams,
  InitializeResult,
  ThreadStartParams,
  ThreadStartResult,
  ThreadResumeParams,
  TurnStartParams,
  TurnStartResult,
  TurnInterruptParams,
} from './protocol/index.js';
import type { CodexAppServerSettings, Logger } from './types.js';

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type NotificationHandler = (params: unknown) => void;

const DEFAULT_REQUEST_TIMEOUT = 60_000; // 60 seconds

/**
 * Client for communicating with the codex app-server process
 */
export class AppServerClient {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private notificationHandlers = new Map<string, Set<NotificationHandler>>();
  private initialized = false;
  private starting: Promise<void> | null = null;
  private logger: Logger;

  constructor(private settings: CodexAppServerSettings) {
    this.logger = this.createLogger();
  }

  private createLogger(): Logger {
    if (this.settings.logger === false) {
      return {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };
    }

    if (this.settings.logger) {
      return this.settings.logger;
    }

    const verbose = this.settings.verbose ?? false;
    return {
      debug: verbose ? (msg) => console.debug(`[codex-app-server] ${msg}`) : () => {},
      info: verbose ? (msg) => console.info(`[codex-app-server] ${msg}`) : () => {},
      warn: (msg) => console.warn(`[codex-app-server] ${msg}`),
      error: (msg) => console.error(`[codex-app-server] ${msg}`),
    };
  }

  /**
   * Ensure the app-server process is started and initialized
   */
  async ensureStarted(): Promise<void> {
    if (this.initialized) return;

    if (this.starting) {
      await this.starting;
      return;
    }

    this.starting = this.start();
    await this.starting;
  }

  private async start(): Promise<void> {
    const codexPath = this.settings.codexPath ?? 'codex';

    this.logger.info(`Starting codex app-server: ${codexPath} app-server`);

    this.process = spawn(codexPath, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.settings.env },
      cwd: this.settings.cwd,
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to spawn codex app-server: no stdio');
    }

    // Set up line-delimited JSON parsing on stdout
    const rl = createInterface({ input: this.process.stdout });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line) as JSONRPCResponse | JSONRPCError | JSONRPCNotification;
        this.handleMessage(msg);
      } catch (err) {
        this.logger.error(`Failed to parse JSON line: ${line}`);
      }
    });

    // Capture stderr for debugging
    if (this.process.stderr) {
      const stderrRl = createInterface({ input: this.process.stderr });
      stderrRl.on('line', (line) => {
        this.logger.debug(`[stderr] ${line}`);
      });
    }

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.logger.info(`codex app-server exited with code ${code}, signal ${signal}`);
      this.cleanup();
    });

    this.process.on('error', (err) => {
      this.logger.error(`codex app-server process error: ${err.message}`);
      this.cleanup();
    });

    // Perform initialization handshake
    const initParams: InitializeParams = {
      clientInfo: {
        name: 'ai-sdk-provider-codex-app-server',
        title: 'AI SDK Codex App Server Provider',
        version: '1.0.0',
      },
    };

    await this.request<InitializeResult>('initialize', initParams);
    this.notify('initialized', {});
    this.initialized = true;

    this.logger.info('codex app-server initialized');
  }

  private cleanup(): void {
    this.initialized = false;
    this.starting = null;
    this.process = null;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('App server connection closed'));
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  async request<T>(method: string, params?: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT): Promise<T> {
    await this.ensureStarted();

    const id = randomUUID();
    const message: JSONRPCRequest = { id, method };
    if (params !== undefined) {
      message.params = params as Record<string, unknown>;
    }

    this.logger.debug(`Request ${id}: ${method}`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      this.send(message);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  notify(method: string, params?: unknown): void {
    if (!this.process?.stdin) {
      this.logger.warn(`Cannot send notification ${method}: process not started`);
      return;
    }

    const message: JSONRPCNotification = { method };
    if (params !== undefined) {
      message.params = params as Record<string, unknown>;
    }

    this.logger.debug(`Notification: ${method}`);
    this.send(message);
  }

  private send(message: JSONRPCRequest | JSONRPCNotification): void {
    if (!this.process?.stdin) {
      throw new Error('Cannot send: process not started');
    }

    const line = JSON.stringify(message) + '\n';
    this.process.stdin.write(line);
  }

  private handleMessage(msg: JSONRPCResponse | JSONRPCError | JSONRPCNotification): void {
    // Check if this is a response to a pending request
    if ('id' in msg && msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.id);

        if ('error' in msg && msg.error) {
          this.logger.debug(`Response ${msg.id}: error - ${msg.error.message}`);
          pending.reject(new Error(msg.error.message));
        } else if ('result' in msg) {
          this.logger.debug(`Response ${msg.id}: success`);
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // This is a notification
    if ('method' in msg) {
      this.logger.debug(`Notification received: ${msg.method}`);
      const handlers = this.notificationHandlers.get(msg.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(msg.params);
          } catch (err) {
            this.logger.error(`Notification handler error for ${msg.method}: ${err}`);
          }
        }
      }
    }
  }

  /**
   * Subscribe to server notifications
   * @returns Unsubscribe function
   */
  onNotification(method: string, handler: NotificationHandler): () => void {
    if (!this.notificationHandlers.has(method)) {
      this.notificationHandlers.set(method, new Set());
    }
    this.notificationHandlers.get(method)!.add(handler);

    return () => {
      this.notificationHandlers.get(method)?.delete(handler);
    };
  }

  // ============ High-level API Methods ============

  /**
   * Start a new thread
   */
  async startThread(params: ThreadStartParams): Promise<ThreadStartResult> {
    return this.request<ThreadStartResult>('thread/start', params);
  }

  /**
   * Resume an existing thread
   */
  async resumeThread(params: ThreadResumeParams): Promise<ThreadStartResult> {
    return this.request<ThreadStartResult>('thread/resume', params);
  }

  /**
   * Start a turn on a thread
   */
  async startTurn(params: TurnStartParams): Promise<TurnStartResult> {
    return this.request<TurnStartResult>('turn/start', params);
  }

  /**
   * Interrupt an active turn
   */
  async interruptTurn(params: TurnInterruptParams): Promise<void> {
    await this.request<void>('turn/interrupt', params);
  }

  /**
   * Dispose of the client and kill the process
   */
  dispose(): void {
    if (this.process) {
      this.logger.info('Disposing codex app-server client');
      this.process.kill('SIGTERM');
      this.cleanup();
    }
  }
}
