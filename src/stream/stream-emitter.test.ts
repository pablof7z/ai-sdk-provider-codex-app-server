import { describe, test, expect, vi } from 'vitest';
import { StreamEmitter } from './stream-emitter.js';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';

function createMockController(): {
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
  enqueued: LanguageModelV3StreamPart[];
} {
  const enqueued: LanguageModelV3StreamPart[] = [];
  const controller = {
    enqueue: vi.fn((part: LanguageModelV3StreamPart) => enqueued.push(part)),
    close: vi.fn(),
  } as unknown as ReadableStreamDefaultController<LanguageModelV3StreamPart>;
  return { controller, enqueued };
}

describe('StreamEmitter', () => {
  describe('emitReasoningDelta', () => {
    test('passes delta through unchanged without injecting any prefix', () => {
      const { controller, enqueued } = createMockController();
      const emitter = new StreamEmitter(controller, {
        threadId: 'thread-1',
        turnId: 'turn-1',
        modelId: 'codex',
      });

      emitter.emitReasoningDelta('Hello world', false);

      const reasoningDelta = enqueued.find((p) => p.type === 'reasoning-delta');
      expect(reasoningDelta).toBeDefined();
      expect(reasoningDelta!.type).toBe('reasoning-delta');
      // Delta should be EXACTLY what was passed in - no prefix injection
      expect((reasoningDelta as { delta: string }).delta).toBe('Hello world');
    });

    test('passes summary delta through unchanged without injecting [summary] prefix', () => {
      const { controller, enqueued } = createMockController();
      const emitter = new StreamEmitter(controller, {
        threadId: 'thread-1',
        turnId: 'turn-1',
        modelId: 'codex',
      });

      emitter.emitReasoningDelta('Summary text', true);

      const reasoningDelta = enqueued.find((p) => p.type === 'reasoning-delta');
      expect(reasoningDelta).toBeDefined();
      // Delta should be EXACTLY what was passed in - NO [summary] prefix
      expect((reasoningDelta as { delta: string }).delta).toBe('Summary text');
      // Summary should NOT contain the corrupting prefix
      expect((reasoningDelta as { delta: string }).delta).not.toContain('[summary]');
    });

    test('communicates isSummary via providerMetadata instead of injecting into content', () => {
      const { controller, enqueued } = createMockController();
      const emitter = new StreamEmitter(controller, {
        threadId: 'thread-1',
        turnId: 'turn-1',
        modelId: 'codex',
      });

      emitter.emitReasoningDelta('Summary text', true);

      const reasoningDelta = enqueued.find((p) => p.type === 'reasoning-delta') as {
        type: string;
        delta: string;
        providerMetadata?: Record<string, unknown>;
      };
      expect(reasoningDelta).toBeDefined();
      expect(reasoningDelta.providerMetadata).toBeDefined();
      expect(reasoningDelta.providerMetadata!.codex).toEqual({ isSummary: true });
    });

    test('does not include isSummary metadata for regular reasoning deltas', () => {
      const { controller, enqueued } = createMockController();
      const emitter = new StreamEmitter(controller, {
        threadId: 'thread-1',
        turnId: 'turn-1',
        modelId: 'codex',
      });

      emitter.emitReasoningDelta('Regular reasoning', false);

      const reasoningDelta = enqueued.find((p) => p.type === 'reasoning-delta') as {
        type: string;
        delta: string;
        providerMetadata?: Record<string, unknown>;
      };
      expect(reasoningDelta).toBeDefined();
      // No metadata needed for regular reasoning
      expect(reasoningDelta.providerMetadata).toBeUndefined();
    });
  });

  describe('emitStreamStart', () => {
    test('emits stream-start and response-metadata chunks', () => {
      const { controller, enqueued } = createMockController();
      const emitter = new StreamEmitter(controller, {
        threadId: 'thread-1',
        turnId: 'turn-1',
        modelId: 'codex',
      });

      emitter.emitStreamStart([{ type: 'other', message: 'test warning' }]);

      expect(enqueued[0]).toEqual({ type: 'stream-start', warnings: [{ type: 'other', message: 'test warning' }] });
      expect(enqueued[1].type).toBe('response-metadata');
    });
  });

  describe('close', () => {
    test('close() is idempotent — second call is a no-op', () => {
      const { controller } = createMockController();
      const emitter = new StreamEmitter(controller, {
        threadId: 'thread-1',
        turnId: 'turn-1',
        modelId: 'codex',
      });

      emitter.close();
      emitter.close();

      expect(controller.close).toHaveBeenCalledTimes(1);
    });

    test('close() after close() does not throw on a real ReadableStreamDefaultController', () => {
      // The real ReadableStreamDefaultController.close() throws
      // ERR_INVALID_STATE when called on an already-closed controller.
      // This regression-tests the actual production failure mode.
      let realController!: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
      new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          realController = controller;
        },
      });
      const emitter = new StreamEmitter(realController, {
        threadId: 'thread-1',
        turnId: 'turn-1',
        modelId: 'codex',
      });

      expect(() => emitter.close()).not.toThrow();
      expect(() => emitter.close()).not.toThrow();
    });
  });

  describe('emitFinish', () => {
    test('includes sessionId in finish providerMetadata for session resumption', () => {
      const { controller, enqueued } = createMockController();
      const emitter = new StreamEmitter(controller, {
        threadId: 'thread-abc-123',
        turnId: 'turn-1',
        modelId: 'codex',
      });

      emitter.emitFinish('completed');

      const finish = enqueued.find((p) => p.type === 'finish') as {
        type: string;
        providerMetadata?: Record<string, unknown>;
      };
      expect(finish).toBeDefined();
      expect(finish.providerMetadata).toBeDefined();
      expect(finish.providerMetadata!.codex).toEqual({
        sessionId: 'thread-abc-123',
      });
    });
  });
});
