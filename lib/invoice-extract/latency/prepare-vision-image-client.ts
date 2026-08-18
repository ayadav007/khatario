'use client';

import { computeInvoiceVisionTargetSize } from '@/lib/invoice-extract/latency/compute-vision-image-size';
import { INVOICE_VISION_JPEG_QUALITY } from '@/lib/invoice-extract/latency/constants';

export interface ClientPreparedVisionImage {
  file: File;
  width: number;
  height: number;
  resized: boolean;
}

interface DecodedFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeOriented(blob: Blob): Promise<DecodedFrame> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
      } as ImageBitmapOptions);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      /* HTMLImageElement fallback */
    }
  }

  const url = URL.createObjectURL(blob);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image failed to load'));
    };
    el.src = url;
  });
  return {
    source: img,
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    close: () => URL.revokeObjectURL(url),
  };
}

function canvasToJpegFile(canvas: HTMLCanvasElement, fileName: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('JPEG encode failed'));
          return;
        }
        const base = fileName.replace(/\.[^.]+$/, '') || 'invoice';
        resolve(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      INVOICE_VISION_JPEG_QUALITY,
    );
  });
}

/**
 * Shared browser prep for Android crop and desktop upload.
 * Bakes EXIF into pixels, never upscales, JPEG ~0.80, no unsharp filter.
 */
export async function prepareInvoiceVisionImageClient(file: File): Promise<ClientPreparedVisionImage> {
  const decoded = await decodeOriented(file);
  try {
    const target = computeInvoiceVisionTargetSize(decoded.width, decoded.height);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { file, width: decoded.width, height: decoded.height, resized: false };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, target.width, target.height);
    const out = await canvasToJpegFile(canvas, file.name);
    return { file: out, width: target.width, height: target.height, resized: target.resized };
  } finally {
    decoded.close();
  }
}

export async function prepareInvoiceVisionImageClientOrPassthrough(file: File): Promise<File> {
  try {
    const prepared = await prepareInvoiceVisionImageClient(file);
    return prepared.file;
  } catch {
    return file;
  }
}
