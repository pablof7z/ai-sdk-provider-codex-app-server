/**
 * Zod validation schemas - single source of truth
 */

import { z } from 'zod';
import type { CodexAppServerProviderOptions } from './settings.js';

// ============ Base Schemas ============

export const loggerSchema = z.object({
  debug: z.function({ input: [z.string()], output: z.void() }),
  info: z.function({ input: [z.string()], output: z.void() }),
  warn: z.function({ input: [z.string()], output: z.void() }),
  error: z.function({ input: [z.string()], output: z.void() }),
});

// ============ MCP Server Schemas ============

const mcpServerBaseSchema = z.object({
  enabled: z.boolean().optional(),
  startupTimeoutSec: z.number().optional(),
  toolTimeoutSec: z.number().optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
});

export const mcpServerStdioSchema = mcpServerBaseSchema.extend({
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});

export const mcpServerHttpSchema = mcpServerBaseSchema.extend({
  transport: z.literal('http'),
  url: z.string(),
  bearerToken: z.string().optional(),
  bearerTokenEnvVar: z.string().optional(),
  httpHeaders: z.record(z.string(), z.string()).optional(),
  envHttpHeaders: z.record(z.string(), z.string()).optional(),
});

export const mcpServerConfigSchema = z.discriminatedUnion('transport', [
  mcpServerStdioSchema,
  mcpServerHttpSchema,
]);

// Schema that accepts both regular MCP configs and SDK MCP servers
// SDK servers are validated at runtime via isSdkMcpServer()
export const mcpServerConfigOrSdkSchema = z.union([
  mcpServerConfigSchema,
  z.any(), // Accept SDK MCP servers (TypeScript enforces the type)
]);

// ============ Settings Schema ============

export const settingsSchema = z
  .object({
    codexPath: z.string().optional(),
    cwd: z.string().optional(),
    approvalMode: z.enum(['never', 'on-request', 'on-failure', 'untrusted']).optional(),
    sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access', 'full-access']).optional(),
    reasoningEffort: z.enum(['none', 'low', 'medium', 'high', 'xhigh']).optional(),
    threadMode: z.enum(['persistent', 'stateless']).optional(),
    mcpServers: z.record(z.string(), mcpServerConfigOrSdkSchema).optional(),
    rmcpClient: z.boolean().optional(),
    verbose: z.boolean().optional(),
    logger: z.union([loggerSchema, z.literal(false)]).optional(),
    onSessionCreated: z
      .any()
      .refine((val) => val === undefined || typeof val === 'function', {
        message: 'onSessionCreated must be a function',
      })
      .optional(),
    env: z.record(z.string(), z.string()).optional(),
    baseInstructions: z.string().optional(),
    configOverrides: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.object({}).passthrough(),
          z.array(z.any()),
        ])
      )
      .optional(),
    resume: z.string().optional(),
  })
  .strict();

// ============ Provider Options Schema ============

const providerOptionsZodSchema = z
  .object({
    reasoningEffort: z.enum(['none', 'low', 'medium', 'high', 'xhigh']).optional(),
    threadMode: z.enum(['persistent', 'stateless']).optional(),
    mcpServers: z.record(z.string(), mcpServerConfigOrSdkSchema).optional(),
    rmcpClient: z.boolean().optional(),
    configOverrides: z
      .record(
        z.string(),
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

// Export with explicit type for use with parseProviderOptions
// The schema validates the structure, while TypeScript enforces the exact type
export const providerOptionsSchema: z.ZodType<CodexAppServerProviderOptions> =
  providerOptionsZodSchema as z.ZodType<CodexAppServerProviderOptions>;

// ============ Validation Result ============

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate settings and return any warnings or errors
 */
export function validateSettings(settings: unknown): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    warnings: [],
    errors: [],
  };

  const parsed = settingsSchema.safeParse(settings);

  if (!parsed.success) {
    result.valid = false;
    for (const issue of parsed.error.issues) {
      result.errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return result;
  }

  const s = parsed.data;

  if (s.sandboxMode === 'full-access' || s.sandboxMode === 'danger-full-access') {
    result.warnings.push(
      `sandboxMode "${s.sandboxMode}" gives the agent full filesystem access. Use with caution.`
    );
  }

  if (s.approvalMode === 'never') {
    result.warnings.push(
      'approvalMode "never" allows the agent to execute commands without approval.'
    );
  }

  if (s.threadMode === 'stateless' && s.resume) {
    result.warnings.push(
      'threadMode "stateless" ignores resume; a new thread is started for each call.'
    );
  }

  return result;
}
