import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export const MEDIA_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MEDIA_MAX_WIDTH = 2400;
export const MEDIA_FILE_RE = /^[a-f0-9]{64}\.webp$/;
export const MEDIA_URL_PREFIX = '/media/marketing/';

export function getMarketingMediaDir(): string {
  const configured = process.env.MARKETING_MEDIA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'storage', 'marketing-media');
}

export function isMediaFileName(name: string): boolean {
  return MEDIA_FILE_RE.test(name);
}

export type DetectedImage = 'jpeg' | 'png' | 'webp' | 'avif';

/** Identifies the format from magic bytes; the browser-supplied MIME type is not trusted. */
export function detectImageType(buf: Buffer): DetectedImage | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  return null;
}

export type StoredMedia = { url: string; name: string; width: number; height: number; bytes: number };

export async function storeMarketingImage(input: Buffer): Promise<StoredMedia> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(input, { limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: MEDIA_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const name = `${createHash('sha256').update(data).digest('hex')}.webp`;
  const dir = getMarketingMediaDir();
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, name);
  try {
    await fs.writeFile(target, data, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return { url: `${MEDIA_URL_PREFIX}${name}`, name, width: info.width, height: info.height, bytes: data.length };
}

export type MediaListItem = { url: string; name: string; bytes: number; created_at: string };

export async function listMarketingMedia(limit = 200): Promise<MediaListItem[]> {
  const dir = getMarketingMediaDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const items = await Promise.all(
    names.filter(isMediaFileName).map(async (name) => {
      const stat = await fs.stat(path.join(dir, name));
      return { url: `${MEDIA_URL_PREFIX}${name}`, name, bytes: stat.size, created_at: stat.mtime.toISOString() };
    }),
  );
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

export async function readMarketingMedia(name: string): Promise<Buffer | null> {
  if (!isMediaFileName(name)) return null;
  try {
    return await fs.readFile(path.join(getMarketingMediaDir(), name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
