/**
 * Invoice image preprocessing for OCR (Google Vision, Paddle, etc.).
 *
 * Pipeline: Sharp (EXIF, resize, normalize) → OpenCV (geometry, contrast, binarize) → Sharp (PNG).
 * Optimized for Indian thermal receipts, GST invoices, and handwritten bills.
 *
 * Requires: `sharp`, `@techstark/opencv-js` (OpenCV 4.x WASM). Server-only.
 */

import sharp from 'sharp';
import { getOpenCv, releaseMats } from './opencvRuntime';
import {
  applyAdaptiveThreshold,
  applyClahe,
  applyDenoise,
  autoRotateDocument,
  bgrToGrayMat,
  cropToContent,
  matToGrayBuffer,
  perspectiveCorrectDocument,
  rgbaToBgrMat,
  type CvMat,
  type RgbaFrame,
} from './opencvImageOps';
import {
  DEFAULT_PREPROCESS_PROFILE,
  getPreprocessProfile,
  INVOICE_PREPROCESS_PROFILES,
  type InvoicePreprocessProfile,
  type InvoicePreprocessProfileId,
} from './imagePreprocessingProfiles';

export type { InvoicePreprocessProfileId, InvoicePreprocessProfile };
export { INVOICE_PREPROCESS_PROFILES, DEFAULT_PREPROCESS_PROFILE, getPreprocessProfile };

export interface PreprocessInvoiceImageOptions {
  /** Preset tuned for document type */
  profile?: InvoicePreprocessProfileId;
  /** Heuristic profile pick from image dimensions (overridden by explicit `profile`) */
  autoDetectProfile?: boolean;
  /** Override profile max dimension cap */
  maxDimension?: number;
  /** Skip OpenCV (Sharp-only: orient + resize + normalize) — debug / fallback */
  skipOpenCv?: boolean;
}

export interface PreprocessInvoiceImageResult {
  buffer: Buffer;
  mimeType: 'image/png';
  profileId: InvoicePreprocessProfileId;
  width: number;
  height: number;
  stepsApplied: string[];
  originalWidth: number;
  originalHeight: number;
}

function pickProfileByGeometry(width: number, height: number): InvoicePreprocessProfileId {
  const w = Math.max(width, height);
  const h = Math.min(width, height);
  const aspect = w / Math.max(h, 1);

  /** Narrow tall strip → thermal roll */
  if (aspect >= 2.8 && w < 2200) return 'thermal_receipt';
  /** Large page scan / photo of full sheet */
  if (w >= 1800 && aspect < 1.85) return 'printed_invoice';
  /** In-between (forms, service bills) */
  if (aspect < 2.2) return 'handwritten_bill';
  return 'thermal_receipt';
}

async function sharpPrepareRgb(
  input: Buffer,
  profile: InvoicePreprocessProfile,
  steps: string[]
): Promise<{ rgba: RgbaFrame; originalWidth: number; originalHeight: number }> {
  const meta = await sharp(input).metadata();
  const originalWidth = meta.width ?? 0;
  const originalHeight = meta.height ?? 0;

  let pipeline = sharp(input, { failOn: 'none' });
  if (profile.exifAutoOrient) {
    pipeline = pipeline.rotate();
    steps.push('exif_auto_orient');
  }

  const maxDim = profile.maxDimension;
  const ow = meta.width ?? maxDim;
  const oh = meta.height ?? maxDim;
  if (Math.max(ow, oh) > maxDim) {
    pipeline = pipeline.resize({
      width: ow >= oh ? maxDim : undefined,
      height: oh > ow ? maxDim : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
    steps.push(`resize_max_${maxDim}`);
  }

  if (profile.sharpNormalize) {
    pipeline = pipeline.normalize();
    steps.push('sharp_normalize');
  }

  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  return {
    rgba: {
      data: new Uint8Array(data),
      width: info.width,
      height: info.height,
      channels: 4,
    },
    originalWidth,
    originalHeight,
  };
}

async function grayMatToPngBuffer(
  gray: CvMat,
  profile: InvoicePreprocessProfile,
  steps: string[]
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const frame = matToGrayBuffer(gray);
  let pipeline = sharp(Buffer.from(frame.data), {
    raw: { width: frame.width, height: frame.height, channels: 1 },
  });

  if (profile.sharpSharpenSigma != null && profile.sharpSharpenSigma > 0) {
    pipeline = pipeline.sharpen(profile.sharpSharpenSigma);
    steps.push('sharp_sharpen');
  }

  const { data, info } = await pipeline.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

async function runOpenCvPipeline(
  rgba: RgbaFrame,
  profile: InvoicePreprocessProfile,
  steps: string[]
): Promise<CvMat> {
  const cv = await getOpenCv();
  let bgr = rgbaToBgrMat(cv, rgba);
  steps.push('opencv_load');

  let working: CvMat = profile.grayscale ? bgrToGrayMat(cv, bgr) : bgr;
  if (profile.grayscale) {
    bgr.delete();
    bgr = working;
    steps.push('grayscale');
  }

  if (profile.denoise.method !== 'none') {
    const denoised = applyDenoise(cv, working, profile.denoise);
    working.delete();
    working = denoised;
    steps.push(`denoise_${profile.denoise.method}`);
  }

  if (profile.clahe) {
    const claheOut = applyClahe(cv, working, profile.clahe);
    working.delete();
    working = claheOut;
    steps.push('clahe');
  }

  if (profile.autoRotation) {
    const rotated = autoRotateDocument(cv, working);
    working.delete();
    working = rotated;
    steps.push('auto_rotation');
  }

  if (profile.perspectiveCorrection) {
    const warped = perspectiveCorrectDocument(cv, working, profile.edgeDetection);
    working.delete();
    working = warped;
    steps.push('perspective_correction');
  }

  if (profile.cropToReceipt) {
    const cropped = cropToContent(
      cv,
      working,
      profile.cropPaddingPx,
      profile.cropBackgroundThreshold
    );
    working.delete();
    working = cropped;
    steps.push('crop_to_receipt');
  }

  if (profile.finalOutputMode === 'binary' && profile.adaptiveThreshold) {
    const binary = applyAdaptiveThreshold(cv, working, profile.adaptiveThreshold);
    working.delete();
    working = binary;
    steps.push('adaptive_threshold');
  } else if (profile.finalOutputMode === 'grayscale_clahe' && profile.clahe) {
    /** Already applied CLAHE above; keep gray */
  }

  return working;
}

/**
 * Preprocess a raw uploaded invoice image for OCR.
 *
 * @param input - JPEG/PNG/WebP buffer from upload
 * @returns PNG buffer (grayscale or 1-bit) tuned for OCR
 */
export async function preprocessInvoiceImage(
  input: Buffer,
  options: PreprocessInvoiceImageOptions = {}
): Promise<PreprocessInvoiceImageResult> {
  if (!input?.length) {
    throw new Error('preprocessInvoiceImage: empty input buffer');
  }

  const stepsApplied: string[] = [];
  const metaProbe = await sharp(input).metadata();

  let profileId: InvoicePreprocessProfileId =
    options.profile ??
    (options.autoDetectProfile === false
      ? DEFAULT_PREPROCESS_PROFILE
      : pickProfileByGeometry(metaProbe.width ?? 0, metaProbe.height ?? 0));

  if (!options.profile && options.autoDetectProfile !== false) {
    stepsApplied.push(`auto_profile_${profileId}`);
  }

  let profile = getPreprocessProfile(profileId);
  if (options.maxDimension != null && options.maxDimension > 0) {
    profile = { ...profile, maxDimension: options.maxDimension };
  }

  const { rgba, originalWidth, originalHeight } = await sharpPrepareRgb(
    input,
    profile,
    stepsApplied
  );

  if (options.skipOpenCv) {
    const { buffer, width, height } = await sharp(Buffer.from(rgba.data), {
      raw: { width: rgba.width, height: rgba.height, channels: 4 },
    })
      .grayscale()
      .png()
      .toBuffer({ resolveWithObject: true })
      .then((r) => ({ buffer: r.data, width: r.info.width, height: r.info.height }));
    stepsApplied.push('skip_opencv_grayscale_png');
    return {
      buffer,
      mimeType: 'image/png',
      profileId,
      width,
      height,
      stepsApplied,
      originalWidth,
      originalHeight,
    };
  }

  let grayMat: CvMat | null = null;
  try {
    grayMat = await runOpenCvPipeline(rgba, profile, stepsApplied);
    const { buffer, width, height } = await grayMatToPngBuffer(grayMat, profile, stepsApplied);
    return {
      buffer,
      mimeType: 'image/png',
      profileId,
      width,
      height,
      stepsApplied,
      originalWidth,
      originalHeight,
    };
  } catch (opencvErr) {
    console.warn('[imagePreprocessing] OpenCV pipeline failed, Sharp fallback:', opencvErr);
    stepsApplied.push('opencv_fallback_sharp');
    const { buffer, width, height } = await sharpFallbackFromRgba(rgba, profile, stepsApplied);
    return {
      buffer,
      mimeType: 'image/png',
      profileId,
      width,
      height,
      stepsApplied,
      originalWidth,
      originalHeight,
    };
  } finally {
    releaseMats(grayMat);
  }
}

/** Sharp-only path when OpenCV is unavailable or times out. */
async function sharpFallbackFromRgba(
  rgba: RgbaFrame,
  profile: InvoicePreprocessProfile,
  steps: string[]
): Promise<{ buffer: Buffer; width: number; height: number }> {
  let pipeline = sharp(Buffer.from(rgba.data), {
    raw: { width: rgba.width, height: rgba.height, channels: 4 },
  }).grayscale();

  if (profile.finalOutputMode === 'binary') {
    pipeline = pipeline.normalize().threshold(140);
    steps.push('sharp_threshold_fallback');
  } else if (profile.sharpSharpenSigma) {
    pipeline = pipeline.sharpen(profile.sharpSharpenSigma);
  }

  const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

/** Env-driven profile id for extract route (`INVOICE_OCR_PREPROCESS_PROFILE`). */
export function preprocessProfileFromEnv(): InvoicePreprocessProfileId | 'auto' | null {
  const raw = (process.env.INVOICE_OCR_PREPROCESS_PROFILE || '').trim().toLowerCase();
  if (!raw || raw === 'off' || raw === 'false' || raw === '0') return null;
  if (raw === 'auto') return 'auto';
  if (raw in INVOICE_PREPROCESS_PROFILES) return raw as InvoicePreprocessProfileId;
  return DEFAULT_PREPROCESS_PROFILE;
}

export function isPreprocessEnabled(): boolean {
  return preprocessProfileFromEnv() !== null;
}
