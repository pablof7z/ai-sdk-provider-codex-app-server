/**
 * Error utilities for Codex App Server provider
 */

import { APICallError } from '@ai-sdk/provider';

/**
 * Metadata associated with Codex App Server errors
 */
export interface CodexAppServerErrorMetadata {
  threadId?: string;
  turnId?: string;
  exitCode?: number;
  stderr?: string;
}

/**
 * Check if an error is an authentication error
 */
export function isAuthenticationError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('unauthorized') ||
      msg.includes('authentication') ||
      msg.includes('api key') ||
      msg.includes('not logged in')
    );
  }
  return false;
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.toLowerCase().includes('timeout');
  }
  return false;
}

/**
 * Extract metadata from an error if available
 */
export function getErrorMetadata(error: unknown): CodexAppServerErrorMetadata | undefined {
  if (error && typeof error === 'object' && 'metadata' in error) {
    return error.metadata as CodexAppServerErrorMetadata;
  }
  return undefined;
}

/**
 * Create an API call error with metadata
 */
export function createAPICallError(
  message: string,
  options: {
    url?: string;
    statusCode?: number;
    responseBody?: string;
    cause?: unknown;
    isRetryable?: boolean;
    metadata?: CodexAppServerErrorMetadata;
  } = {}
): APICallError {
  const error = new APICallError({
    message,
    url: options.url ?? 'codex-app-server://local',
    requestBodyValues: {},
    statusCode: options.statusCode,
    responseBody: options.responseBody,
    cause: options.cause,
    isRetryable: options.isRetryable ?? false,
  });

  if (options.metadata) {
    Object.assign(error, { metadata: options.metadata });
  }

  return error;
}

/**
 * Create an authentication error
 */
export function createAuthenticationError(message: string): APICallError {
  return createAPICallError(message, {
    statusCode: 401,
    isRetryable: false,
  });
}

/**
 * Create a timeout error
 */
export function createTimeoutError(message: string, timeoutMs: number): APICallError {
  return createAPICallError(`${message} (timeout: ${timeoutMs}ms)`, {
    statusCode: 408,
    isRetryable: true,
  });
}
