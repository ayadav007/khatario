/**
 * Tunable preprocessing profiles for Indian invoice / receipt OCR.
 */

export type InvoicePreprocessProfileId =
  | 'thermal_receipt'
  | 'printed_invoice'
  | 'handwritten_bill';

export interface DenoiseConfig {
  method: 'bilateral' | 'fastNlMeans' | 'none';
  /** bilateralFilter diameter */
  diameter?: number;
  sigmaColor?: number;
  sigmaSpace?: number;
  /** fastNlMeansDenoising h (strength) */
  h?: number;
  templateWindowSize?: number;
  searchWindowSize?: number;
}

export interface ClaheConfig {
  clipLimit: number;
  tileGridSize: number;
}

export interface AdaptiveThresholdConfig {
  maxValue: number;
  blockSize: number;
  C: number;
}

export interface EdgeDetectionConfig {
  cannyLow: number;
  cannyHigh: number;
  /** Min contour area as fraction of image area to accept document quad */
  minDocumentAreaRatio: number;
  /** Gaussian blur kernel before Canny (odd, 0 = skip) */
  blurKernel: number;
  /** Morphology dilate iterations on edge map */
  dilateIterations: number;
}

export interface InvoicePreprocessProfile {
  id: InvoicePreprocessProfileId;
  label: string;
  /** Longest edge cap before OpenCV (keeps WASM memory bounded) */
  maxDimension: number;
  /** Apply sharp.autoOrient / EXIF rotation first */
  exifAutoOrient: boolean;
  /** Sharp normalize() before OpenCV */
  sharpNormalize: boolean;
  /** Sharp mild sharpen after OpenCV (null = skip) */
  sharpSharpenSigma: number | null;
  grayscale: boolean;
  denoise: DenoiseConfig;
  clahe: ClaheConfig | null;
  autoRotation: boolean;
  perspectiveCorrection: boolean;
  edgeDetection: EdgeDetectionConfig;
  adaptiveThreshold: AdaptiveThresholdConfig | null;
  cropToReceipt: boolean;
  cropPaddingPx: number;
  /** Pixels brighter than this (0–255) treated as background when cropping */
  cropBackgroundThreshold: number;
  /**
   * Final buffer sent to OCR:
   * - binary: adaptive threshold output (thermal)
   * - grayscale: single channel enhanced gray
   * - grayscale_clahe: CLAHE gray without binarization (handwriting)
   */
  finalOutputMode: 'binary' | 'grayscale' | 'grayscale_clahe';
}

export const INVOICE_PREPROCESS_PROFILES: Record<
  InvoicePreprocessProfileId,
  InvoicePreprocessProfile
> = {
  thermal_receipt: {
    id: 'thermal_receipt',
    label: 'Thermal POS / till receipt',
    maxDimension: 1600,
    exifAutoOrient: true,
    sharpNormalize: true,
    sharpSharpenSigma: 0.8,
    grayscale: true,
    denoise: {
      method: 'bilateral',
      diameter: 7,
      sigmaColor: 60,
      sigmaSpace: 60,
    },
    clahe: { clipLimit: 3.0, tileGridSize: 8 },
    autoRotation: true,
    perspectiveCorrection: true,
    edgeDetection: {
      cannyLow: 40,
      cannyHigh: 140,
      minDocumentAreaRatio: 0.12,
      blurKernel: 5,
      dilateIterations: 2,
    },
    adaptiveThreshold: {
      maxValue: 255,
      blockSize: 31,
      C: 10,
    },
    cropToReceipt: true,
    cropPaddingPx: 10,
    cropBackgroundThreshold: 248,
    finalOutputMode: 'binary',
  },

  printed_invoice: {
    id: 'printed_invoice',
    label: 'Printed GST / B2B tax invoice',
    maxDimension: 3200,
    exifAutoOrient: true,
    sharpNormalize: true,
    sharpSharpenSigma: null,
    grayscale: true,
    denoise: {
      method: 'bilateral',
      diameter: 5,
      sigmaColor: 45,
      sigmaSpace: 45,
    },
    clahe: { clipLimit: 2.0, tileGridSize: 8 },
    autoRotation: true,
    perspectiveCorrection: true,
    edgeDetection: {
      cannyLow: 50,
      cannyHigh: 160,
      minDocumentAreaRatio: 0.18,
      blurKernel: 5,
      dilateIterations: 1,
    },
    adaptiveThreshold: null,
    cropToReceipt: true,
    cropPaddingPx: 16,
    cropBackgroundThreshold: 250,
    finalOutputMode: 'grayscale',
  },

  handwritten_bill: {
    id: 'handwritten_bill',
    label: 'Handwritten / filled pre-printed bill',
    maxDimension: 1800,
    exifAutoOrient: true,
    sharpNormalize: true,
    sharpSharpenSigma: null,
    grayscale: true,
    denoise: {
      method: 'fastNlMeans',
      h: 6,
      templateWindowSize: 7,
      searchWindowSize: 21,
    },
    clahe: { clipLimit: 2.5, tileGridSize: 16 },
    autoRotation: true,
    perspectiveCorrection: true,
    edgeDetection: {
      cannyLow: 35,
      cannyHigh: 120,
      minDocumentAreaRatio: 0.1,
      blurKernel: 7,
      dilateIterations: 2,
    },
    adaptiveThreshold: null,
    cropToReceipt: true,
    cropPaddingPx: 20,
    cropBackgroundThreshold: 245,
    finalOutputMode: 'grayscale_clahe',
  },
};

export function getPreprocessProfile(
  id: InvoicePreprocessProfileId
): InvoicePreprocessProfile {
  return INVOICE_PREPROCESS_PROFILES[id];
}

export const DEFAULT_PREPROCESS_PROFILE: InvoicePreprocessProfileId = 'printed_invoice';
