import sharp from 'sharp';
import { prepareInvoiceVisionImageServer } from '@/lib/invoice-extract/latency/prepare-vision-image-server';
import { INVOICE_VISION_MAX_LONG_SIDE } from '@/lib/invoice-extract/latency/constants';

async function createJpeg(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function createPng(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

describe('prepareInvoiceVisionImageServer', () => {
  it('does not re-encode an already-small upright JPEG', async () => {
    const input = await createJpeg(800, 600, { r: 240, g: 240, b: 240 });
    const out = await prepareInvoiceVisionImageServer(input);
    expect(out.resized).toBe(false);
    expect(out.reencoded).toBe(false);
    expect(out.buffer.equals(input)).toBe(true);
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
    expect(out.mimeType).toBe('image/jpeg');
  });

  it('does not re-encode an already-small upright PNG', async () => {
    const input = await createPng(640, 480, { r: 10, g: 20, b: 30 });
    const out = await prepareInvoiceVisionImageServer(input);
    expect(out.resized).toBe(false);
    expect(out.reencoded).toBe(false);
    expect(out.buffer.equals(input)).toBe(true);
    expect(out.mimeType).toBe('image/png');
  });

  it('downscales a large landscape JPEG to long side 1600', async () => {
    const input = await createJpeg(3200, 2400, { r: 200, g: 200, b: 200 });
    const out = await prepareInvoiceVisionImageServer(input);
    expect(out.resized).toBe(true);
    expect(out.reencoded).toBe(true);
    expect(out.mimeType).toBe('image/jpeg');
    expect(Math.max(out.width, out.height)).toBe(INVOICE_VISION_MAX_LONG_SIDE);
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1200);
    expect(out.buffer.length).toBeLessThan(input.length);
  });

  it('downscales a large portrait JPEG to long side 1600', async () => {
    const input = await createJpeg(2400, 3200, { r: 180, g: 180, b: 180 });
    const out = await prepareInvoiceVisionImageServer(input);
    expect(out.resized).toBe(true);
    expect(out.width).toBe(1200);
    expect(out.height).toBe(1600);
  });

  it('downscales a large PNG and emits JPEG', async () => {
    const input = await createPng(2400, 1800, { r: 255, g: 255, b: 255 });
    const out = await prepareInvoiceVisionImageServer(input);
    expect(out.resized).toBe(true);
    expect(out.mimeType).toBe('image/jpeg');
    expect(Math.max(out.width, out.height)).toBe(1600);
    expect(out.buffer.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('does not upscale a tiny image', async () => {
    const input = await createJpeg(320, 240, { r: 1, g: 2, b: 3 });
    const out = await prepareInvoiceVisionImageServer(input);
    expect(out.resized).toBe(false);
    expect(out.width).toBe(320);
    expect(out.height).toBe(240);
    expect(out.buffer.equals(input)).toBe(true);
  });

  it('bakes EXIF orientation 6 into pixels (portrait stored → landscape displayed)', async () => {
    const stored = await sharp({
      create: { width: 40, height: 80, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const withExif = await sharp(stored).withMetadata({ orientation: 6 }).jpeg().toBuffer();

    const out = await prepareInvoiceVisionImageServer(withExif);
    expect(out.oriented).toBe(true);
    expect(out.reencoded).toBe(true);
    expect(out.width).toBe(80);
    expect(out.height).toBe(40);
    const outMeta = await sharp(out.buffer).metadata();
    expect(outMeta.orientation === undefined || outMeta.orientation === 1).toBe(true);
  });

  it('does not log or return image contents as strings', async () => {
    const input = await createJpeg(100, 80, { r: 9, g: 9, b: 9 });
    const out = await prepareInvoiceVisionImageServer(input);
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    expect(JSON.stringify({ ...out, buffer: undefined })).not.toMatch(/ffd8|iVBOR/);
  });
});
