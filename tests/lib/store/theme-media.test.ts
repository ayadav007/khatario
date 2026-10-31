import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { isThemeMediaSegments, readThemeImage, storeThemeImage } from '@/lib/store/theme-media';
import { sanitizeSettingValue } from '@/lib/store/engine/settings';

const B = '3F2B8C1E-9A4D-4E57-8B1A-0C6D2E7F9A10';
const HASH = 'a'.repeat(64);
const IMAGE = { id: 'image', type: 'image', label: 'Image' } as const;

describe('theme media', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-media-'));
    process.env.STORE_THEME_MEDIA_DIR = dir;
  });
  afterAll(async () => {
    delete process.env.STORE_THEME_MEDIA_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('stores a photo as webp under the business and returns a URL the engine image rule keeps', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#e07a1f' } }).png().toBuffer();
    const { url } = await storeThemeImage(B, png);
    expect(url).toMatch(new RegExp(`^/media/store-theme/${B.toLowerCase()}/[a-f0-9]{64}\\.webp$`));
    expect(sanitizeSettingValue(IMAGE, url)).toBe(url);
    const file = url.split('/').pop()!;
    const back = await readThemeImage(B.toLowerCase(), file);
    expect(back?.toString('ascii', 8, 12)).toBe('WEBP');
    // The same photo again gives the same file.
    expect((await storeThemeImage(B, png)).url).toBe(url);
  });

  test('refuses a non-image and a bad business id', async () => {
    await expect(storeThemeImage(B, Buffer.from('<svg></svg>'))).rejects.toThrow('Not an image');
    await expect(storeThemeImage('../x', Buffer.alloc(16))).rejects.toThrow('Invalid business id');
  });

  test.each([
    ['dot traversal', B, `../${HASH}.webp`],
    ['wrong extension', B, `${HASH}.png`],
    ['short hash', B, 'abc.webp'],
    ['bad business', '..', `${HASH}.webp`],
  ])('reads nothing for %s', async (_n, biz, file) => {
    expect(isThemeMediaSegments(biz, file)).toBe(false);
    expect(await readThemeImage(biz, file)).toBeNull();
  });

  test('the old upload route\'s data URLs are what the engine drops', () => {
    expect(sanitizeSettingValue(IMAGE, 'data:image/png;base64,iVBORw0KGgo=')).toBeUndefined();
  });
});
