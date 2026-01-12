/**
 * Zod validation schemas - single source of truth
 */

import { z } from 'zod';

// ============ Base Schemas ============

export const loggerSchema = z.object({
  debug: z.function().args(z.string()).returns(z.void()),
  info: z.function().args(z.string()).returns(z.void()),
  warn: z.function().args(z.string()).returns(z.void()),
  error: z.function().args(z.string()).returns(z.void()),
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
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

export const mcpServerHttpSchema = mcpServerBaseSchema.extend({
  transport: z.literal('http'),
  url: z.string(),
  bearerToken: z.string().optional(),
  bearerTokenEnvVar: z.string().optional(),
  httpHeaders: z.record(z.string()).optional(),
  envHttpHeaders: z.record(z.string()).optional(),
});

export const mcpServerConfigSchema = z.discriminatedUnion('transport', [
  mcpServerStdioSchema,
  mcpServerHttpSchema,
]);

// ============ Settings Schema ============

export const settingsSchema = z
  .object({
    codexPath: z.string().optional(),
    cwd: z.string().optional(),
    approvalMode: z.enum(['never', 'on-request', 'on-failure', 'untrusted']).optional(),
    sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access', 'full-access']).optional(),
    reasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
    threadMode: z.enum(['persistent', 'stateless']).optional(),
    mcpServers: z.record(mcpServerConfigSchema).optional(),
    rmcpClient: z.boolean().optional(),
    verbose: z.boolean().optional(),
    logger: z.union([loggerSchema, z.literal(false)]).optional(),
    onSessionCreated: z
      .any()
      .refine((val) => val === undefined || typeof val === 'function', {
        message: 'onSessionCreated must be a function',
      })
      .optional(),
    env: z.record(z.string()).optional(),
    baseInstructions: z.string().optional(),
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
    resume: z.string().optional(),
  })
  .strict();

// ============ Provider Options Schema ============

export const providerOptionsSchema = z
  .object({
    reasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
    threadMode: z.enum(['persistent', 'stateless']).optional(),
    mcpServers: z.record(mcpServerConfigSchema).optional(),
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
