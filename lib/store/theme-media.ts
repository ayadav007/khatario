/**
 * Theme photos on disk (same pattern as lib/store/review-media.ts): re-encoded to webp, named by content hash,
 * kept under `<dir>/<business_id>/` and served by app/media/store-theme. The engine's image rule takes these
 * root-relative URLs; it rejects the `data:` URLs that /api/upload/image returns.
 */
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { detectImageType } from '@/lib/marketing-builder/media';

export const THEME_MEDIA_URL_PREFIX = '/media/store-theme/';
export const THEME_MEDIA_MAX_WIDTH = 2400;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RE = /^[a-f0-9]{64}\.webp$/;

export function getThemeMediaDir(): string {
  const configured = process.env.STORE_THEME_MEDIA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'storage', 'store-theme');
}

export function isThemeMediaSegments(businessId: string, file: string): boolean {
  return UUID_RE.test(businessId) && FILE_RE.test(file);
}

export async function storeThemeImage(businessId: string, input: Buffer): Promise<{ url: string }> {
  if (!UUID_RE.test(businessId)) throw new Error('Invalid business id');
  if (!detectImageType(input)) throw new Error('Not an image');
  const sharp = (await import('sharp')).default;
  const data = await sharp(input, { limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: THEME_MEDIA_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const name = `${createHash('sha256').update(data).digest('hex')}.webp`;
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
