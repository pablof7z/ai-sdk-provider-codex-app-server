/**
 * Validation schemas for CodexAppServerSettings
 */

import { z } from 'zod';

const loggerSchema = z
  .object({
    debug: z.function().args(z.string()).returns(z.void()),
    info: z.function().args(z.string()).returns(z.void()),
    warn: z.function().args(z.string()).returns(z.void()),
    error: z.function().args(z.string()).returns(z.void()),
  })
  .strict();

const mcpServerBaseSchema = z.object({
  enabled: z.boolean().optional(),
  startupTimeoutSec: z.number().optional(),
  toolTimeoutSec: z.number().optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
});

const mcpServerStdioSchema = mcpServerBaseSchema.extend({
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

const mcpServerHttpSchema = mcpServerBaseSchema.extend({
  transport: z.literal('http'),
  url: z.string(),
  bearerToken: z.string().optional(),
  bearerTokenEnvVar: z.string().optional(),
  httpHeaders: z.record(z.string()).optional(),
  envHttpHeaders: z.record(z.string()).optional(),
});

const mcpServerConfigSchema = z.discriminatedUnion('transport', [
  mcpServerStdioSchema,
  mcpServerHttpSchema,
]);

export const settingsSchema = z
  .object({
    codexPath: z.string().optional(),
    cwd: z.string().optional(),
    approvalMode: z.enum(['never', 'on-request', 'on-failure', 'always']).optional(),
    sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
    reasoningEffort: z.enum(['none', 'low', 'medium', 'high', 'xhigh']).optional(),
    mcpServers: z.record(mcpServerConfigSchema).optional(),
    verbose: z.boolean().optional(),
    logger: z
      .union([loggerSchema, z.literal(false)])
      .optional(),
    onSessionCreated: z
      .any()
      .refine((val) => val === undefined || typeof val === 'function', {
        message: 'onSessionCreated must be a function',
      })
      .optional(),
    env: z.record(z.string()).optional(),
    baseInstructions: z.string().optional(),
    configOverrides: z
      .record(z.union([z.string(), z.number(), z.boolean(), z.record(z.any())]))
      .optional(),
    resume: z.string().optional(),
  })
  .strict();

export type ValidationResult = {
  valid: boolean;
  warnings: string[];
  errors: string[];
};

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

  // Cross-field validation warnings
  if (s.sandboxMode === 'danger-full-access') {
    result.warnings.push(
      'sandboxMode "danger-full-access" gives the agent full filesystem access. Use with caution.'
    );
  }

  if (s.approvalMode === 'never') {
    result.warnings.push(
      'approvalMode "never" allows the agent to execute commands without approval.'
    );
  }

  return result;
}
