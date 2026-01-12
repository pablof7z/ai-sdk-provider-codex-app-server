/**
 * Tool builder for defining local tools with Zod schemas
 */

import type { ZodType } from 'zod';

/**
 * Tool definition with Zod schema for parameters
 */
export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  name: string;
  description: string;
  parameters: ZodType<TParams>;
  execute: (params: TParams) => Promise<TResult>;
}

/**
 * Internal tool representation with JSON schema
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (params: unknown) => Promise<unknown>;
}

/**
 * Convert Zod schema to JSON Schema
 */
function zodToJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  // Use Zod's built-in JSON schema conversion if available (zod v3.23+)
  if ('_def' in schema && schema._def) {
    const def = schema._def as unknown as Record<string, unknown>;

    // Handle ZodObject
    if (def.typeName === 'ZodObject') {
      const shape = def.shape as Record<string, ZodType<unknown>> | (() => Record<string, ZodType<unknown>>);
      const shapeObj = typeof shape === 'function' ? shape() : shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shapeObj)) {
        properties[key] = zodToJsonSchema(value);
        // Check if field is optional
        const valueDef = (value as unknown as { _def?: { typeName?: string } })._def;
        if (valueDef?.typeName !== 'ZodOptional') {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      };
    }

    // Handle ZodString
    if (def.typeName === 'ZodString') {
      return { type: 'string' };
    }

    // Handle ZodNumber
    if (def.typeName === 'ZodNumber') {
      return { type: 'number' };
    }

    // Handle ZodBoolean
    if (def.typeName === 'ZodBoolean') {
      return { type: 'boolean' };
    }

    // Handle ZodArray
    if (def.typeName === 'ZodArray') {
      const itemType = def.type as ZodType<unknown>;
      return {
        type: 'array',
        items: zodToJsonSchema(itemType),
      };
    }

    // Handle ZodOptional
    if (def.typeName === 'ZodOptional') {
      const innerType = def.innerType as ZodType<unknown>;
      return zodToJsonSchema(innerType);
    }

    // Handle ZodEnum
    if (def.typeName === 'ZodEnum') {
      return {
        type: 'string',
        enum: def.values as string[],
      };
    }

    // Handle ZodLiteral
    if (def.typeName === 'ZodLiteral') {
      const value = def.value;
      return {
        type: typeof value,
        const: value,
      };
    }

    // Handle ZodUnion
    if (def.typeName === 'ZodUnion') {
      const options = def.options as ZodType<unknown>[];
      return {
        oneOf: options.map(zodToJsonSchema),
      };
    }

    // Handle ZodNullable
    if (def.typeName === 'ZodNullable') {
      const innerType = def.innerType as ZodType<unknown>;
      const inner = zodToJsonSchema(innerType);
      return {
        oneOf: [inner, { type: 'null' }],
      };
    }
  }

  // Fallback for unknown types
  return { type: 'object' };
}

/**
 * Define a tool with typed parameters and execution function
 *
 * @example
 * ```typescript
 * const calculator = tool({
 *   name: 'add',
 *   description: 'Add two numbers',
 *   parameters: z.object({ a: z.number(), b: z.number() }),
 *   execute: async ({ a, b }) => ({ result: a + b }),
 * });
 * ```
 */
export function tool<TParams, TResult>(
  definition: ToolDefinition<TParams, TResult>
): Tool {
  const { name, description, parameters, execute } = definition;

  return {
    name,
    description,
    inputSchema: zodToJsonSchema(parameters),
    execute: async (params: unknown) => {
      // Validate and parse parameters using Zod
      const parsed = parameters.parse(params) as TParams;
      return execute(parsed);
    },
  };
}
