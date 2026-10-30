/**
 * Review photos on disk (same pattern as lib/marketing-builder/media.ts): re-encoded to webp, named by
 * content hash, kept under `<dir>/<business_id>/` and served by app/media/store-reviews.
 */
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { detectImageType } from '@/lib/marketing-builder/media';

export const REVIEW_MEDIA_URL_PREFIX = '/media/store-reviews/';
export const REVIEW_MEDIA_MAX_WIDTH = 1600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RE = /^[a-f0-9]{64}\.webp$/;

export function getReviewMediaDir(): string {
  const configured = process.env.STORE_REVIEW_MEDIA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'storage', 'store-reviews');
}

export function isReviewMediaSegments(businessId: string, file: string): boolean {
  return UUID_RE.test(businessId) && FILE_RE.test(file);
}

/** True only for `/media/store-reviews/<this business id>/<64 hex>.webp`, exactly. */
export function isReviewPhotoUrl(url: unknown, businessId: string): boolean {
  if (typeof url !== 'string' || !UUID_RE.test(businessId) || !url.startsWith(REVIEW_MEDIA_URL_PREFIX)) return false;
  const [biz, file, ...rest] = url.slice(REVIEW_MEDIA_URL_PREFIX.length).split('/');
  return rest.length === 0 && biz === businessId.toLowerCase() && FILE_RE.test(file ?? '');
}

export async function storeReviewPhoto(businessId: string, input: Buffer): Promise<{ url: string }> {
  if (!UUID_RE.test(businessId)) throw new Error('Invalid business id');
  if (!detectImageType(input)) throw new Error('Not an image');
  const sharp = (await import('sharp')).default;
  const data = await sharp(input, { limitInputPixels: 25_000_000 })
    .rotate()
    .resize({ width: REVIEW_MEDIA_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const name = `${createHash('sha256').update(data).digest('hex')}.webp`;
  const biz = businessId.toLowerCase();
  const dir = path.join(getReviewMediaDir(), biz);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(path.join(dir, name), data, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return { url: `${REVIEW_MEDIA_URL_PREFIX}${biz}/${name}` };
}

export async function readReviewPhoto(businessId: string, file: string): Promise<Buffer | null> {
  if (!isReviewMediaSegments(businessId, file)) return null;
  try {
    return await fs.readFile(path.join(getReviewMediaDir(), businessId.toLowerCase(), file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
