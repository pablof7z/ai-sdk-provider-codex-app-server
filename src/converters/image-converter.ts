/**
 * Image handling utilities
 */

import type { LanguageModelV3FilePart, SharedV3Warning } from '@ai-sdk/provider';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProtocolUserInput } from '../protocol/index.js';

export function isImageMediaType(mediaType?: string): boolean {
  return typeof mediaType === 'string' && mediaType.toLowerCase().startsWith('image/');
}

function mediaTypeToExtension(mediaType: string): string {
  const lower = mediaType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('bmp')) return 'bmp';
  if (lower.includes('tiff')) return 'tiff';
  return 'img';
}

function writeTempImage(data: Uint8Array, mediaType: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'codex-app-server-'));
  const ext = mediaTypeToExtension(mediaType);
  const filePath = join(dir, `image.${ext}`);
  writeFileSync(filePath, data);
  return filePath;
}

export function cleanupTempFiles(paths: string[]): void {
  for (const filePath of paths) {
    try {
      const dir = dirname(filePath);
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

export function toImageInput(
  part: LanguageModelV3FilePart,
  tempFiles: string[],
  warnings: SharedV3Warning[]
): ProtocolUserInput | undefined {
  if (!isImageMediaType(part.mediaType)) {
    warnings.push({
      type: 'other',
      message: `Unsupported file mediaType "${part.mediaType}"; only image/* is supported.`,
    });
    return undefined;
  }

  const mediaType = part.mediaType;
  const data = part.data;

  if (data instanceof URL) {
    if (data.protocol === 'file:') {
      return { type: 'localImage', path: fileURLToPath(data) };
    }
    if (data.protocol === 'http:' || data.protocol === 'https:' || data.protocol === 'data:') {
      return { type: 'image', imageUrl: data.href };
    }
    warnings.push({
      type: 'other',
      message: `Unsupported image URL protocol "${data.protocol}".`,
    });
    return undefined;
  }

  if (typeof data === 'string') {
    if (data.startsWith('data:') || data.startsWith('http://') || data.startsWith('https://')) {
      return { type: 'image', imageUrl: data };
    }
    if (data.startsWith('file://')) {
      try {
        return { type: 'localImage', path: fileURLToPath(data) };
      } catch {
        warnings.push({
          type: 'other',
          message: 'Unable to read file URL for image input.',
        });
        return undefined;
      }
    }
    try {
      const buffer = Buffer.from(data, 'base64');
      const filePath = writeTempImage(buffer, mediaType);
      tempFiles.push(filePath);
      return { type: 'localImage', path: filePath };
    } catch {
      warnings.push({
        type: 'other',
        message: 'Unable to decode base64 image data.',
      });
      return undefined;
    }
  }

  if (data instanceof Uint8Array) {
    const filePath = writeTempImage(data, mediaType);
    tempFiles.push(filePath);
    return { type: 'localImage', path: filePath };
  }

  warnings.push({
    type: 'other',
    message: 'Unsupported image data type provided in file input.',
  });
  return undefined;
}
