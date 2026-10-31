import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import {
  detectThemeUpload,
  isThemeMediaSegments,
  readThemeImage,
  storeThemeImage,
  storeThemeVideo,
  themeMediaContentType,
} from '@/lib/store/theme-media';
import { isVideoUrl } from '@/lib/store/theme-media-url';
import { sanitizeSettingValue } from '@/lib/store/engine/settings';
import { GET } from '@/app/media/store-theme/[business]/[file]/route';

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

// A 1×1 GIF with two frames (red, then blue): sharp 0.33 cannot write a multi-frame GIF itself.
const frame = (code: number) => [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, code, 1, 0];
const ANIMATED_GIF = Buffer.from([
  ...Buffer.from('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 255, 0, 0, 0, 0, 255,
  0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0,
  ...frame(0x44), ...frame(0x4c), 0x3b,
]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(40, 7)]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(40, 7)]);
const AVIF = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif'), Buffer.alloc(40)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40, 1)]);

describe('detectThemeUpload', () => {
  test('tells stills, animated formats and videos apart from their bytes', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f00' } }).png().toBuffer();
    expect(detectThemeUpload(png)).toBe('image');
    expect(detectThemeUpload(AVIF)).toBe('image');
    expect(detectThemeUpload(ANIMATED_GIF)).toBe('animated');
    expect(detectThemeUpload(MP4)).toBe('mp4');
    expect(detectThemeUpload(WEBM)).toBe('webm');
  });
  test('rejects QuickTime, short and unknown files', () => {
    expect(detectThemeUpload(MOV)).toBeNull();
    expect(detectThemeUpload(Buffer.from('GIF89a'))).toBeNull();
    expect(detectThemeUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe('theme media names', () => {
  test('serves webp, mp4 and webm hash names only', () => {
    expect(isThemeMediaSegments(B, `${HASH}.webp`)).toBe(true);
    expect(isThemeMediaSegments(B, `${HASH}.mp4`)).toBe(true);
    expect(isThemeMediaSegments(B, `${HASH}.webm`)).toBe(true);
    expect(isThemeMediaSegments(B, `${HASH}.mov`)).toBe(false);
    expect(isThemeMediaSegments(B, `${HASH}.gif`)).toBe(false);
    expect(themeMediaContentType(`${HASH}.mp4`)).toBe('video/mp4');
    expect(themeMediaContentType(`${HASH}.webm`)).toBe('video/webm');
    expect(themeMediaContentType(`${HASH}.webp`)).toBe('image/webp');
  });
  test('isVideoUrl reads the extension', () => {
    expect(isVideoUrl(`/media/store-theme/${B}/${HASH}.mp4`)).toBe(true);
    expect(isVideoUrl('https://cdn.example.com/ad.WEBM?v=2')).toBe(true);
    expect(isVideoUrl(`/media/store-theme/${B}/${HASH}.webp`)).toBe(false);
    expect(isVideoUrl('/ad.mp4.webp')).toBe(false);
    expect(isVideoUrl(undefined)).toBe(false);
  });
});

describe('storing and serving theme media', () => {
  let dir: string;
  const before = process.env.STORE_THEME_MEDIA_DIR;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-media-'));
    process.env.STORE_THEME_MEDIA_DIR = dir;
  });
  afterAll(async () => {
    if (before === undefined) delete process.env.STORE_THEME_MEDIA_DIR;
    else process.env.STORE_THEME_MEDIA_DIR = before;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const fileOf = (url: string) => url.split('/').pop() as string;

  test('a GIF stays animated, as webp', async () => {
    const { url } = await storeThemeImage(B, ANIMATED_GIF);
    expect(url).toMatch(/\.webp$/);
    const stored = await fs.readFile(path.join(dir, B.toLowerCase(), fileOf(url)));
    expect((await sharp(stored, { animated: true }).metadata()).pages).toBe(2);
  });

  test('a video is kept byte for byte; an image is not taken as a video', async () => {
    const { url } = await storeThemeVideo(B, MP4, 'mp4');
    expect(url).toMatch(/\.mp4$/);
    expect((await fs.readFile(path.join(dir, B.toLowerCase(), fileOf(url)))).equals(MP4)).toBe(true);
    await expect(storeThemeVideo(B, ANIMATED_GIF, 'mp4')).rejects.toThrow('Not a video');
    await expect(storeThemeImage(B, MP4)).rejects.toThrow('Not an image');
  });

  test('serves video with its type and answers byte ranges', async () => {
    const { url } = await storeThemeVideo(B, MP4, 'mp4');
    const file = fileOf(url);
    const get = (range?: string) =>
      GET(new NextRequest(`http://localhost${url}`, { headers: range ? { range } : {} }), { params: { business: B.toLowerCase(), file } });

    const whole = await get();
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');

    const part = await get('bytes=0-3');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-3/${MP4.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(MP4.subarray(0, 4))).toBe(true);

    const open = await get('bytes=8-');
    expect(open.headers.get('content-range')).toBe(`bytes 8-${MP4.length - 1}/${MP4.length}`);
    const tail = await get('bytes=-4');
    expect(Buffer.from(await tail.arrayBuffer()).equals(MP4.subarray(MP4.length - 4))).toBe(true);

    expect((await get(`bytes=${MP4.length}-`)).status).toBe(416);
  });
});
