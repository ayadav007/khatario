import { createHmac, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import {
  WA_MEDIA_REF_PATH,
  bytesToBase64,
  base64ToBytes,
  encodeWaMediaRef,
  parseWaMediaRefUrl,
  type WaMediaKind,
  type WaMediaRef,
} from './media-ref';
import { INBOX_MEDIA_URL_PREFIX, parseDataUrl, readInboxMediaByUrl, saveInboxMedia } from './inbox-media';

/** Files we pull into memory on the server (payment screenshots for OCR, copies we keep). */
export const MAX_SERVER_MEDIA_BYTES = 16 * 1024 * 1024;

const PREFIX = 'wa-media-ref:';

function secret(): string {
  const key = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('JWT_SECRET is required for WhatsApp media links');
  return key;
}

function mac(body: string): string {
  return createHmac('sha256', secret()).update(`${PREFIX}${body}`).digest('base64url').slice(0, 22);
}

/** Signed link the inbox stores in `media_url` instead of the file. */
export function waMediaRefUrl(ref: WaMediaRef): string {
  const body = encodeWaMediaRef(ref);
  return `${WA_MEDIA_REF_PATH}?r=${body}&s=${mac(body)}`;
}

/** The ref inside a link this server signed; null for a forged, altered or foreign link. */
export function verifyWaMediaRefUrl(url: string | null | undefined): WaMediaRef | null {
  const parsed = parseWaMediaRefUrl(url);
  if (!parsed) return null;
  const expected = Buffer.from(mac(parsed.body));
  const given = Buffer.from(parsed.sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return parsed.ref;
}

function asBytes(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    try {
      return base64ToBytes(value);
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return Uint8Array.from((value as { data: number[] }).data);
  }
  return null;
}

function asNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function'
    ? (value as { toNumber: () => number }).toNumber()
    : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Link for a Baileys media field (imageMessage, videoMessage, …). Nothing is downloaded.
 * Undefined when WhatsApp did not send a path and key (the media cannot be fetched later either).
 */
export function waMediaRefUrlFromBaileys(field: any, kind: WaMediaKind, defaultMime: string): string | undefined {
  if (!field) return undefined;
  const key = asBytes(field.mediaKey);
  let path: string | undefined = typeof field.directPath === 'string' && field.directPath.startsWith('/') ? field.directPath : undefined;
  if (!path && typeof field.url === 'string' && field.url.startsWith('https://mmg.whatsapp.net/')) {
    path = field.url.slice('https://mmg.whatsapp.net'.length);
  }
  if (!key || key.length !== 32 || !path) return undefined;
  const enc = asBytes(field.fileEncSha256);
  const ref: WaMediaRef = {
    v: 1,
    src: 'wa',
    t: kind,
    m: String(field.mimetype || defaultMime).slice(0, 100),
    p: path,
    k: bytesToBase64(key),
  };
  if (enc) ref.h = bytesToBase64(enc);
  const size = asNumber(field.fileLength);
  if (size) ref.n = size;
  if (kind === 'document' && typeof field.fileName === 'string' && field.fileName.trim()) {
    ref.f = field.fileName.trim().slice(0, 120);
  }
  return waMediaRefUrl(ref);
}

/** Link for the first media field of a Baileys message body, if it has one. */
export function waMediaRefUrlFromMessage(m: any): string | undefined {
  if (!m) return undefined;
  if (m.imageMessage) return waMediaRefUrlFromBaileys(m.imageMessage, 'image', 'image/jpeg');
  if (m.videoMessage) return waMediaRefUrlFromBaileys(m.videoMessage, 'video', 'video/mp4');
  if (m.documentMessage) return waMediaRefUrlFromBaileys(m.documentMessage, 'document', 'application/octet-stream');
  if (m.audioMessage) return waMediaRefUrlFromBaileys(m.audioMessage, 'audio', 'audio/ogg; codecs=opus');
  if (m.stickerMessage) return waMediaRefUrlFromBaileys(m.stickerMessage, 'sticker', 'image/webp');
  return undefined;
}

/** Link for a Cloud API media id. Nothing is downloaded. */
export function cloudMediaRefUrl(media: { kind: WaMediaKind; id: string; mimeType?: string | null; filename?: string | null }): string {
  const ref: WaMediaRef = {
    v: 1,
    src: 'cloud',
    t: media.kind,
    m: String(media.mimeType || 'application/octet-stream').slice(0, 100),
    id: media.id,
  };
  if (media.filename?.trim()) ref.f = media.filename.trim().slice(0, 120);
  return waMediaRefUrl(ref);
}

export class WaMediaGoneError extends Error {}

/**
 * Opens the file behind a ref, decrypted, as a stream. Nothing is written to disk.
 * Throws WaMediaGoneError when WhatsApp no longer has it.
 */
export async function openWaMedia(businessId: string, ref: WaMediaRef): Promise<{ stream: Readable; mimeType: string; size?: number }> {
  if (ref.src === 'cloud') {
    const { downloadMedia } = await import('@/lib/meta-whatsapp');
    try {
      const file = await downloadMedia({ businessId, mediaId: ref.id! });
      return { stream: Readable.from([file.buffer]), mimeType: ref.m || file.mimeType, size: file.buffer.length };
    } catch (err) {
      throw new WaMediaGoneError(err instanceof Error ? err.message : 'Media is no longer available');
    }
  }
  const { downloadContentFromMessage } = await import('@whiskeysockets/baileys/lib/Utils');
  try {
    const stream = await downloadContentFromMessage(
      { mediaKey: Buffer.from(base64ToBytes(ref.k!)), directPath: ref.p!, url: `https://mmg.whatsapp.net${ref.p}` },
      ref.t,
    );
    return { stream: stream as unknown as Readable, mimeType: ref.m };
  } catch (err) {
    throw new WaMediaGoneError(err instanceof Error ? err.message : 'Media is no longer available');
  }
}

async function readAll(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > limit) {
      stream.destroy();
      throw new Error('Media file is too large');
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** Bytes behind any inbox media URL (data URL, kept file or WhatsApp link); null if unreadable. */
export async function loadInboxMediaForServer(
  businessId: string,
  mediaUrl: string | null | undefined,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!mediaUrl) return null;
  try {
    if (mediaUrl.startsWith('data:')) return parseDataUrl(mediaUrl);
    if (mediaUrl.startsWith(INBOX_MEDIA_URL_PREFIX) && !mediaUrl.startsWith(WA_MEDIA_REF_PATH)) {
      return await readInboxMediaByUrl(businessId, mediaUrl);
    }
    const ref = verifyWaMediaRefUrl(mediaUrl);
    if (!ref) return null;
    if (ref.n && ref.n > MAX_SERVER_MEDIA_BYTES) return null;
    const file = await openWaMedia(businessId, ref);
    return { buffer: await readAll(file.stream, MAX_SERVER_MEDIA_BYTES), mimeType: file.mimeType.split(';')[0].trim() };
  } catch (err) {
    console.error('[WA media] could not load media on the server:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Keeps a server copy of a WhatsApp link's file (business records such as payment screenshots).
 * Returns the URL to store (a kept file for links, unchanged otherwise) and a data URL for OCR.
 */
export async function keepInboxMediaCopy(
  businessId: string,
  mediaUrl: string,
): Promise<{ url: string; dataUrl: string } | null> {
  const file = await loadInboxMediaForServer(businessId, mediaUrl);
  if (!file) return null;
  const dataUrl = `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
  if (!mediaUrl.startsWith(WA_MEDIA_REF_PATH)) return { url: mediaUrl, dataUrl };
  const url = await saveInboxMedia(businessId, file.buffer, file.mimeType);
  return { url, dataUrl };
}
