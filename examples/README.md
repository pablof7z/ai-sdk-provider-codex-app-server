# Examples

Run any script with:

```bash
npx tsx examples/<name>.ts
```

Available scripts:

- `stream-text.ts` - Basic streaming text output.
- `generate-text.ts` - Non-streaming text generation.
- `structured-output.ts` - JSON schema / object generation with Zod.
- `tool-streaming.ts` - Tool call + tool result streaming events.
- `raw-chunks.ts` - Raw JSON-RPC notifications via `includeRawChunks`.
- `mid-execution-injection.ts` - Inject messages while a turn is running.
- `thread-modes.ts` - Persistent vs stateless thread behavior.
- `resume-thread.ts` - Resume an existing thread by ID.
- `image-input.ts` - Image inputs (data URL example).
- `provider-options.ts` - Per-call providerOptions overrides.
- `mcp-config.ts` - MCP + RMCP configuration example.
- `abort.ts` - Abort a streaming request.
