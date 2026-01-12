/**
 * Prompt conversion utilities - transforms AI SDK messages to protocol format
 */

import type {
  LanguageModelV3Message,
  LanguageModelV3FilePart,
  LanguageModelV3ToolResultOutput,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { ThreadMode } from '../types/index.js';
import type { ProtocolUserInput } from '../protocol/index.js';
import { isImageMediaType, toImageInput } from './image-converter.js';

export function safeJsonStringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function extractSystemPrompt(prompt: LanguageModelV3Message[]): string | undefined {
  const systemParts: string[] = [];
  for (const message of prompt) {
    if (message.role === 'system' && typeof message.content === 'string') {
      systemParts.push(message.content);
    }
  }
  return systemParts.length ? systemParts.join('\n\n') : undefined;
}

function extractUserMessagesForTurn(prompt: LanguageModelV3Message[]): LanguageModelV3Message[] {
  const collected: LanguageModelV3Message[] = [];

  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const msg = prompt[i];
    if (!msg) continue;
    if (msg.role === 'user') {
      collected.push(msg);
    } else if (collected.length) {
      break;
    }
  }

  if (!collected.length) {
    for (let i = prompt.length - 1; i >= 0; i -= 1) {
      const msg = prompt[i];
      if (!msg) continue;
      if (msg.role === 'user') {
        collected.push(msg);
        break;
      }
    }
  }

  return collected.reverse();
}

function formatToolResultOutput(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case 'text':
      return output.value;
    case 'json':
      return safeJsonStringify(output.value);
    case 'execution-denied':
      return output.reason ? `Execution denied: ${output.reason}` : 'Execution denied';
    case 'error-text':
      return output.value;
    case 'error-json':
      return safeJsonStringify(output.value);
    case 'content': {
      const parts = output.value
        .map((part) => {
          if (part.type === 'text') return part.text;
          if (part.type === 'file-data') return `[file: ${part.mediaType}]`;
          return '';
        })
        .filter(Boolean);
      return parts.join('\n');
    }
    default:
      return '';
  }
}

function buildTranscript(
  prompt: LanguageModelV3Message[],
  warnings: SharedV3Warning[]
): { transcript: string; images: LanguageModelV3FilePart[] } {
  const lines: string[] = [];
  let lastUserImages: LanguageModelV3FilePart[] = [];

  for (const message of prompt) {
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      const textParts: string[] = [];
      const images: LanguageModelV3FilePart[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          textParts.push(part.text);
        } else if (part.type === 'file') {
          if (isImageMediaType(part.mediaType)) {
            images.push(part);
          } else {
            warnings.push({
              type: 'other',
              message: `Unsupported file mediaType "${part.mediaType}"; only image/* is supported.`,
            });
          }
        }
      }

      const text = textParts.join('\n');
      const imageNote = images.length
        ? `[${images.length} image${images.length === 1 ? '' : 's'} attached]`
        : '';
      const combined = [text, imageNote].filter(Boolean).join('\n');
      if (combined) {
        lines.push(`User: ${combined}`);
      }

      if (images.length) {
        lastUserImages = images;
      }
      continue;
    }

    if (message.role === 'assistant') {
      const textParts: string[] = [];
      const toolLines: string[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          textParts.push(part.text);
        } else if (part.type === 'tool-call') {
          const input = safeJsonStringify(part.input);
          toolLines.push(`Tool Call (${part.toolName}): ${input}`);
        } else if (part.type === 'tool-result') {
          toolLines.push(
            `Tool Result (${part.toolName}): ${formatToolResultOutput(part.output)}`
          );
        }
      }

      const text = textParts.join('\n');
      if (text) {
        lines.push(`Assistant: ${text}`);
      }
      for (const line of toolLines) {
        lines.push(line);
      }
      continue;
    }

    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type === 'tool-result') {
          lines.push(
            `Tool Result (${part.toolName}): ${formatToolResultOutput(part.output)}`
          );
        } else if (part.type === 'tool-approval-response') {
          const decision = part.approved ? 'approved' : 'denied';
          const reason = part.reason ? ` (${part.reason})` : '';
          lines.push(`Tool Approval (${part.approvalId}): ${decision}${reason}`);
        }
      }
    }
  }

  return { transcript: lines.join('\n\n'), images: lastUserImages };
}

export interface ConvertPromptResult {
  inputs: ProtocolUserInput[];
  systemPrompt?: string;
  warnings: SharedV3Warning[];
  tempFiles: string[];
}

export function convertPrompt(
  prompt: LanguageModelV3Message[],
  threadMode: ThreadMode
): ConvertPromptResult {
  const warnings: SharedV3Warning[] = [];
  const tempFiles: string[] = [];
  const systemPrompt = extractSystemPrompt(prompt);

  if (threadMode === 'stateless') {
    const { transcript, images } = buildTranscript(prompt, warnings);
    const inputs: ProtocolUserInput[] = [];

    if (transcript.trim()) {
      inputs.push({ type: 'text', text: transcript });
    }

    for (const imagePart of images) {
      const input = toImageInput(imagePart, tempFiles, warnings);
      if (input) inputs.push(input);
    }

    if (!inputs.length) {
      warnings.push({
        type: 'other',
        message: 'No user input found; starting a stateless turn with empty input.',
      });
    }

    return { inputs, systemPrompt, warnings, tempFiles };
  }

  const inputs: ProtocolUserInput[] = [];
  const userMessages = extractUserMessagesForTurn(prompt);

  for (const message of userMessages) {
    if (message.role !== 'user') continue;
    for (const part of message.content) {
      if (part.type === 'text') {
        inputs.push({ type: 'text', text: part.text });
      } else if (part.type === 'file') {
        const input = toImageInput(part, tempFiles, warnings);
        if (input) inputs.push(input);
      }
    }
  }

  if (!inputs.length) {
    warnings.push({
      type: 'other',
      message: 'No user input found; starting a turn with empty input.',
    });
  }

  return { inputs, systemPrompt, warnings, tempFiles };
}
