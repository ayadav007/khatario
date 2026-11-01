/**
 * Theme photos on disk (same pattern as lib/store/review-media.ts): re-encoded to webp, named by content hash,
 * kept under `<dir>/<business_id>/` and served by app/media/store-theme. The engine's image rule takes these
 * root-relative URLs; it rejects the `data:` URLs that /api/upload/image returns.
 * Animated GIF and WebP stay animated (as webp). MP4 and WebM videos are kept as uploaded (no transcoder on the VPS).
 */
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { detectImageType } from '@/lib/marketing-builder/media';

export const THEME_MEDIA_URL_PREFIX = '/media/store-theme/';
export const THEME_MEDIA_MAX_WIDTH = 2400;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RE = /^[a-f0-9]{64}\.(webp|mp4|webm)$/;
// Animated input counts every frame's pixels; the upload cap (10 MB) bounds this in practice.
const ANIMATED_MAX_PIXELS = 150_000_000;
const ANIMATED_MAX_WIDTH = 1600;
// `ftyp` brands of plain MP4 files (Canva, phones, editors). QuickTime `.mov` (`qt  `) is left out: Chrome cannot play it.
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash', 'mmp4']);

export type ThemeUploadKind = 'image' | 'animated' | 'mp4' | 'webm';

/** What an upload is, from its own bytes: a still image, a GIF or WebP that may be animated, or a video. */
export function detectThemeUpload(buf: Buffer): ThemeUploadKind | null {
  if (buf.length < 12) return null;
  const head = buf.toString('ascii', 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return 'animated';
  const image = detectImageType(buf);
  if (image === 'webp') return 'animated';
  if (image) return 'image';
  if (buf.toString('ascii', 4, 8) === 'ftyp' && MP4_BRANDS.has(buf.toString('ascii', 8, 12))) return 'mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  return null;
}

export function themeMediaContentType(file: string): string {
  if (file.endsWith('.mp4')) return 'video/mp4';
  if (file.endsWith('.webm')) return 'video/webm';
  return 'image/webp';
}

export function getThemeMediaDir(): string {
  const configured = process.env.STORE_THEME_MEDIA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'storage', 'store-theme');
}

export function isThemeMediaSegments(businessId: string, file: string): boolean {
  return UUID_RE.test(businessId) && FILE_RE.test(file);
}

export async function storeThemeImage(businessId: string, input: Buffer): Promise<{ url: string }> {
  if (!UUID_RE.test(businessId)) throw new Error('Invalid business id');
  const kind = detectThemeUpload(input);
  if (kind !== 'image' && kind !== 'animated') throw new Error('Not an image');
  const animated = kind === 'animated';
  const sharp = (await import('sharp')).default;
  const data = await sharp(input, { limitInputPixels: animated ? ANIMATED_MAX_PIXELS : 60_000_000, animated })
    .rotate()
    .resize({ width: animated ? ANIMATED_MAX_WIDTH : THEME_MEDIA_MAX_WIDTH, withoutEnlargement: true })
    .webp(animated ? { quality: 75, effort: 2 } : { quality: 82 })
    .toBuffer();
  return writeThemeFile(businessId, data, 'webp');
}

/** Stores an MP4 or WebM byte for byte (the caller has checked it with `detectThemeUpload`). */
export async function storeThemeVideo(businessId: string, input: Buffer, ext: 'mp4' | 'webm'): Promise<{ url: string }> {
  if (!UUID_RE.test(businessId)) throw new Error('Invalid business id');
  if (detectThemeUpload(input) !== ext) throw new Error('Not a video');
  return writeThemeFile(businessId, input, ext);
}

async function writeThemeFile(businessId: string, data: Buffer, ext: 'webp' | 'mp4' | 'webm'): Promise<{ url: string }> {
  const name = `${createHash('sha256').update(data).digest('hex')}.${ext}`;
  const biz = businessId.toLowerCase();
  const dir = path.join(getThemeMediaDir(), biz);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(path.join(dir, name), data, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return { url: `${THEME_MEDIA_URL_PREFIX}${biz}/${name}` };
}

export async function readThemeImage(businessId: string, file: string): Promise<Buffer | null> {
  if (!isThemeMediaSegments(businessId, file)) return null;
  try {
    return await fs.readFile(path.join(getThemeMediaDir(), businessId.toLowerCase(), file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
