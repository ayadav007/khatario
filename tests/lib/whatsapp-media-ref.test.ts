import crypto from 'crypto';
import {
  WA_MEDIA_REF_PATH,
  decryptWaMedia,
  parseWaMediaRefUrl,
  waMediaDownloadUrl,
} from '@/lib/whatsapp/media-ref';
import {
  cloudMediaRefUrl,
  verifyWaMediaRefUrl,
  waMediaRefUrlFromBaileys,
  waMediaRefUrlFromMessage,
} from '@/lib/whatsapp/media-ref-server';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-media-refs';

/** Encrypts the way WhatsApp does (HKDF-SHA256 → AES-256-CBC, 10-byte HMAC tail). */
function whatsappEncrypt(plain: Buffer, mediaKey: Buffer, info: string): Buffer {
  const expanded = Buffer.from(crypto.hkdfSync('sha256', mediaKey, Buffer.alloc(0), info, 112));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const macKey = expanded.subarray(48, 80);
  const c = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  const mac = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, enc])).digest().subarray(0, 10);
  return Buffer.concat([enc, mac]);
}

describe('decryptWaMedia', () => {
  const mediaKey = crypto.randomBytes(32);
  const plain = crypto.randomBytes(5000);

  it('decrypts an image the way WhatsApp encrypted it', async () => {
    const enc = whatsappEncrypt(plain, mediaKey, 'WhatsApp Image Keys');
    const out = await decryptWaMedia(new Uint8Array(enc), new Uint8Array(mediaKey), 'image');
    expect(Buffer.from(out).equals(plain)).toBe(true);
  });

  it('uses the image keys for stickers and the document keys for files', async () => {
    const sticker = whatsappEncrypt(plain, mediaKey, 'WhatsApp Image Keys');
    expect(Buffer.from(await decryptWaMedia(sticker, mediaKey, 'sticker')).equals(plain)).toBe(true);
    const doc = whatsappEncrypt(plain, mediaKey, 'WhatsApp Document Keys');
    expect(Buffer.from(await decryptWaMedia(doc, mediaKey, 'document')).equals(plain)).toBe(true);
  });

  it('rejects an altered file', async () => {
    const enc = whatsappEncrypt(plain, mediaKey, 'WhatsApp Video Keys');
    enc[100] ^= 1;
    await expect(decryptWaMedia(enc, mediaKey, 'video')).rejects.toThrow('integrity');
  });

  it('rejects the wrong key or the wrong media kind', async () => {
    const enc = whatsappEncrypt(plain, mediaKey, 'WhatsApp Audio Keys');
    await expect(decryptWaMedia(enc, crypto.randomBytes(32), 'audio')).rejects.toThrow('integrity');
    await expect(decryptWaMedia(enc, mediaKey, 'image')).rejects.toThrow('integrity');
  });
});

describe('media links', () => {
  const field = {
    mimetype: 'image/jpeg',
    directPath: '/v/t62.7118-24/12345_abc.enc?ccb=11-4&oh=01_x&oe=6800&_nc_sid=5e03e0',
    url: 'https://mmg.whatsapp.net/v/t62.7118-24/12345_abc.enc?ccb=11-4&oh=01_x&oe=6800&_nc_sid=5e03e0&mms3=true',
    mediaKey: crypto.randomBytes(32),
    fileEncSha256: crypto.randomBytes(32),
    fileLength: { toNumber: () => 245_000 },
    jpegThumbnail: crypto.randomBytes(3000),
  };

  it('builds a short signed link from a Baileys media field, without the file or thumbnail', () => {
    const url = waMediaRefUrlFromBaileys(field, 'image', 'image/jpeg')!;
    expect(url.startsWith(`${WA_MEDIA_REF_PATH}?r=`)).toBe(true);
    expect(url.length).toBeLessThan(600);
    const ref = verifyWaMediaRefUrl(url)!;
    expect(ref).toMatchObject({ v: 1, src: 'wa', t: 'image', m: 'image/jpeg', p: field.directPath, n: 245_000 });
    expect(Buffer.from(ref.k!, 'base64').equals(field.mediaKey)).toBe(true);
    expect(waMediaDownloadUrl(ref)).toBe(`https://mmg.whatsapp.net${field.directPath}`);
  });

  it('falls back to the url when there is no directPath, and keeps document names', () => {
    const url = waMediaRefUrlFromMessage({
      documentMessage: { ...field, directPath: undefined, mimetype: 'application/pdf', fileName: 'Invoice 42.pdf' },
    })!;
    const ref = verifyWaMediaRefUrl(url)!;
    expect(ref.t).toBe('document');
    expect(ref.p).toBe(field.url.slice('https://mmg.whatsapp.net'.length));
    expect(ref.f).toBe('Invoice 42.pdf');
  });

  it('gives no link when WhatsApp sent no key', () => {
    expect(waMediaRefUrlFromBaileys({ ...field, mediaKey: undefined }, 'image', 'image/jpeg')).toBeUndefined();
    expect(waMediaRefUrlFromMessage({ conversation: 'hi' })).toBeUndefined();
  });

  it('rejects links that were altered or not signed by this server', () => {
    const url = waMediaRefUrlFromBaileys(field, 'image', 'image/jpeg')!;
    const parsed = parseWaMediaRefUrl(url)!;
    const forged = parsed.body.slice(0, -2) + (parsed.body.endsWith('AA') ? 'BB' : 'AA');
    expect(verifyWaMediaRefUrl(`${WA_MEDIA_REF_PATH}?r=${forged}&s=${parsed.sig}`)).toBeNull();
    expect(verifyWaMediaRefUrl(`${WA_MEDIA_REF_PATH}?r=${parsed.body}&s=AAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(verifyWaMediaRefUrl('/api/whatsapp/media/0b7d6f0e-1111-2222-3333-444455556666.jpg')).toBeNull();
    expect(verifyWaMediaRefUrl('data:image/png;base64,AAAA')).toBeNull();
  });

  it('builds Cloud API links from the media id', () => {
    const ref = verifyWaMediaRefUrl(cloudMediaRefUrl({ kind: 'video', id: '1234567890', mimeType: 'video/mp4', filename: null }))!;
    expect(ref).toMatchObject({ src: 'cloud', t: 'video', id: '1234567890', m: 'video/mp4' });
  });
});
