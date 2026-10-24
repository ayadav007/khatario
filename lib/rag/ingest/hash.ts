import { createHash } from 'crypto';

export function normalizeForHash(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function contentHash(text: string): string {
  return createHash('sha256').update(normalizeForHash(text)).digest('hex');
}

export function combineHashes(hashes: string[]): string {
  return createHash('sha256').update(hashes.join('|')).digest('hex');
}
