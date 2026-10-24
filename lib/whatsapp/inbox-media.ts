import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type InboxMediaKind = 'image' | 'video' | 'audio' | 'document';

/** Cloud API upload limits per kind (bytes). */
export const INBOX_MEDIA_MAX: Record<InboxMediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/amr': 'amr',
  'audio/webm': 'webm',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
);

const NAME_RE = /^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Public path prefix; the route behind it checks the signed-in business. */
export const INBOX_MEDIA_URL_PREFIX = '/api/whatsapp/media/';

export function inboxMediaDir(): string {
  return process.env.WHATSAPP_MEDIA_DIR?.trim() || path.join(process.cwd(), 'storage', 'whatsapp-media');
}

export function mediaKindForMime(mime: string | null | undefined): InboxMediaKind {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/') && m !== 'image/svg+xml') return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

export function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mimeType = (match[1] || 'application/octet-stream').toLowerCase();
  const buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  return { buffer, mimeType };
}

export function safeFileName(name: string | null | undefined, mimeType: string): string {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .trim()
    .slice(0, 120);
  if (cleaned) return cleaned;
  return `file.${EXT_BY_MIME[mimeType] || 'bin'}`;
}

/** Stores a file for the inbox and returns the URL the chat shows. */
export async function saveInboxMedia(
  businessId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (!UUID_RE.test(businessId)) throw new Error('Invalid business');
  const ext = EXT_BY_MIME[mimeType] || 'bin';
  const name = `${randomUUID()}.${ext}`;
  const dir = path.join(inboxMediaDir(), businessId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buffer);
  return `${INBOX_MEDIA_URL_PREFIX}${name}`;
}

export async function readInboxMedia(
  businessId: string,
  name: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!UUID_RE.test(businessId) || !NAME_RE.test(name)) return null;
  const full = path.join(inboxMediaDir(), businessId, name);
  try {
    const buffer = await fs.readFile(full);
    const ext = name.split('.').pop() || '';
    return { buffer, mimeType: MIME_BY_EXT[ext] || 'application/octet-stream' };
  } catch {
    return null;
  }
}

export async function readInboxMediaByUrl(
  businessId: string,
  url: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!url.startsWith(INBOX_MEDIA_URL_PREFIX)) return null;
  return readInboxMedia(businessId, url.slice(INBOX_MEDIA_URL_PREFIX.length).split('?')[0]);
}
