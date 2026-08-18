import sharp from 'sharp';
import { computeInvoiceVisionTargetSize } from '@/lib/invoice-extract/latency/compute-vision-image-size';
import { INVOICE_VISION_SERVER_JPEG_QUALITY } from '@/lib/invoice-extract/latency/constants';

export interface PreparedVisionImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resized: boolean;
  reencoded: boolean;
  oriented: boolean;
}

function sniffMime(metaFormat: string | undefined, fallback: string): string {
  const f = (metaFormat || '').toLowerCase();
  if (f === 'jpeg' || f === 'jpg') return 'image/jpeg';
  if (f === 'png') return 'image/png';
  if (f === 'webp') return 'image/webp';
  if (f === 'gif') return 'image/gif';
  if (f === 'tiff' || f === 'tif') return 'image/tiff';
  return fallback || 'image/jpeg';
}

/**
 * Defense-in-depth for Gemini vision uploads.
 * - Applies EXIF rotation into pixel data when orientation is not identity.
 * - Downscales long side only when it exceeds the cap (no upscaling).
 * - Leaves already-small, already-upright images byte-identical.
 * - Does not log image bytes.
 */
export async function prepareInvoiceVisionImageServer(
  input: Buffer,
  fallbackMimeType = 'image/jpeg',
): Promise<PreparedVisionImage> {
  if (!input?.length) {
    throw new Error('prepareInvoiceVisionImageServer: empty buffer');
  }

  const inputMeta = await sharp(input, { failOn: 'none' }).metadata();
  const originalWidth = inputMeta.width ?? 0;
  const originalHeight = inputMeta.height ?? 0;
  const orientation = inputMeta.orientation ?? 1;
  const oriented = orientation !== 1;
  const mimeType = sniffMime(inputMeta.format, fallbackMimeType);

  const pipeline = sharp(input, { failOn: 'none' }).rotate();
  const orientedMeta = await pipeline.clone().metadata();
  const orientedWidth = orientedMeta.width ?? originalWidth;
  const orientedHeight = orientedMeta.height ?? originalHeight;
  const target = computeInvoiceVisionTargetSize(orientedWidth, orientedHeight);

  if (!target.resized && !oriented) {
    return {
      buffer: input,
      mimeType,
      width: originalWidth,
      height: originalHeight,
      originalWidth,
      originalHeight,
      resized: false,
      reencoded: false,
      oriented: false,
    };
  }

  let out = pipeline.clone();
  if (target.resized) {
    out = out.resize({
      width: target.width,
      height: target.height,
      fit: 'fill',
      withoutEnlargement: true,
    });
  }

  const encoded = await out
    .jpeg({ quality: INVOICE_VISION_SERVER_JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: encoded.data,
    mimeType: 'image/jpeg',
    width: encoded.info.width,
    height: encoded.info.height,
    originalWidth,
    originalHeight,
    resized: target.resized,
    reencoded: true,
    oriented,
  };
}
