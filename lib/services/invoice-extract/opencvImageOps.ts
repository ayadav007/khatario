/**
 * OpenCV image operations for invoice preprocessing (server-only).
 */

import type * as OpenCV from '@techstark/opencv-js';
import { releaseMats } from './opencvRuntime';

type OpenCvModule = typeof OpenCV;
import type {
  AdaptiveThresholdConfig,
  ClaheConfig,
  DenoiseConfig,
  EdgeDetectionConfig,
} from './imagePreprocessingProfiles';

export interface RgbaFrame {
  data: Uint8Array;
  width: number;
  height: number;
  channels: 4;
}

export interface GrayFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

export type CvMat = InstanceType<OpenCvModule['Mat']>;

/** Build BGR Mat from RGBA raw buffer (Sharp output). */
export function rgbaToBgrMat(cv: OpenCvModule, frame: RgbaFrame): CvMat {
  const rgba = new cv.Mat(frame.height, frame.width, cv.CV_8UC4);
  rgba.data.set(frame.data);
  const bgr = new cv.Mat();
  cv.cvtColor(rgba, bgr, cv.COLOR_RGBA2BGR);
  rgba.delete();
  return bgr;
}

/** Gray or binary Mat → single-channel buffer. */
export function matToGrayBuffer(mat: CvMat): GrayFrame {
  return {
    data: new Uint8Array(mat.data),
    width: mat.cols,
    height: mat.rows,
  };
}

export function grayToMat(cv: OpenCvModule, frame: GrayFrame): CvMat {
  const mat = new cv.Mat(frame.height, frame.width, cv.CV_8UC1);
  mat.data.set(frame.data);
  return mat;
}

export function bgrToGrayMat(cv: OpenCvModule, bgr: CvMat): CvMat {
  const gray = new cv.Mat();
  cv.cvtColor(bgr, gray, cv.COLOR_BGR2GRAY);
  return gray;
}

/** WASM OpenCV is slow on large mats — use fast blur past this pixel count. */
const BILATERAL_MAX_PIXELS = 350_000;
const NLMEANS_MAX_PIXELS = 180_000;

export function applyDenoise(cv: OpenCvModule, src: CvMat, cfg: DenoiseConfig): CvMat {
  if (cfg.method === 'none') {
    const copy = new cv.Mat();
    src.copyTo(copy);
    return copy;
  }

  const pixels = src.rows * src.cols;
  const dst = new cv.Mat();
  const k = cfg.diameter && cfg.diameter % 2 === 1 ? cfg.diameter : 5;

  if (cfg.method === 'bilateral') {
    if (pixels > BILATERAL_MAX_PIXELS) {
      cv.GaussianBlur(src, dst, new cv.Size(k, k), 0);
      return dst;
    }
    cv.bilateralFilter(
      src,
      dst,
      cfg.diameter ?? 7,
      cfg.sigmaColor ?? 50,
      cfg.sigmaSpace ?? 50,
      cv.BORDER_DEFAULT
    );
    return dst;
  }

  if (pixels > NLMEANS_MAX_PIXELS) {
    cv.GaussianBlur(src, dst, new cv.Size(k, k), 0);
    return dst;
  }
  const cvAny = cv as OpenCvModule & {
    fastNlMeansDenoising?: (
      src: CvMat,
      dst: CvMat,
      h: number,
      templateWindowSize: number,
      searchWindowSize: number
    ) => void;
  };
  if (typeof cvAny.fastNlMeansDenoising === 'function') {
    cvAny.fastNlMeansDenoising(
      src,
      dst,
      cfg.h ?? 8,
      cfg.templateWindowSize ?? 7,
      cfg.searchWindowSize ?? 21
    );
  } else {
    cv.GaussianBlur(src, dst, new cv.Size(k, k), 0);
  }
  return dst;
}

export function applyClahe(cv: OpenCvModule, gray: CvMat, cfg: ClaheConfig): CvMat {
  const clahe = cv.createCLAHE(cfg.clipLimit, new cv.Size(cfg.tileGridSize, cfg.tileGridSize));
  const dst = new cv.Mat();
  clahe.apply(gray, dst);
  clahe.delete();
  return dst;
}

export function applyAdaptiveThreshold(
  cv: OpenCvModule,
  gray: CvMat,
  cfg: AdaptiveThresholdConfig
): CvMat {
  const dst = new cv.Mat();
  const bs = cfg.blockSize % 2 === 0 ? cfg.blockSize + 1 : cfg.blockSize;
  cv.adaptiveThreshold(
    gray,
    dst,
    cfg.maxValue,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY,
    bs,
    cfg.C
  );
  return dst;
}

/** Deskew using minAreaRect on the largest dark contour. */
export function autoRotateDocument(cv: OpenCvModule, gray: CvMat): CvMat {
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  const edges = new cv.Mat();
  cv.Canny(blurred, edges, 50, 150);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  let bestIdx = -1;
  let bestArea = 0;
  const imgArea = gray.cols * gray.rows;
  for (let i = 0; i < contours.size(); i++) {
    const area = cv.contourArea(contours.get(i));
    if (area > bestArea && area > imgArea * 0.05) {
      bestArea = area;
      bestIdx = i;
    }
  }

  let angleDeg = 0;
  if (bestIdx >= 0) {
    const rect = cv.minAreaRect(contours.get(bestIdx));
    angleDeg = rect.angle;
    if (rect.size.width < rect.size.height) {
      angleDeg += 90;
    }
    if (Math.abs(angleDeg) < 0.4 || Math.abs(angleDeg) > 45) {
      angleDeg = 0;
    }
  }

  releaseMats(blurred, edges, hierarchy);
  contours.delete();

  if (Math.abs(angleDeg) < 0.4) {
    const copy = new cv.Mat();
    gray.copyTo(copy);
    return copy;
  }

  const center = new cv.Point(gray.cols / 2, gray.rows / 2);
  const rotMat = cv.getRotationMatrix2D(center, angleDeg, 1.0);
  const rotated = new cv.Mat();
  const dsize = new cv.Size(gray.cols, gray.rows);
  cv.warpAffine(
    gray,
    rotated,
    rotMat,
    dsize,
    cv.INTER_LINEAR,
    cv.BORDER_REPLICATE,
    new cv.Scalar(255, 255, 255, 255)
  );
  rotMat.delete();
  return rotated;
}

type Point2 = { x: number; y: number };

function orderQuadPoints(pts: Point2[]): Point2[] {
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function contourToPoints(contour: CvMat): Point2[] {
  const rows = contour.rows;
  if (rows <= 0 || rows > 256) return [];
  const out: Point2[] = [];
  const data = contour.data32S;
  if (data && data.length >= rows * 2) {
    for (let i = 0; i < rows; i++) {
      out.push({ x: data[i * 2], y: data[i * 2 + 1] });
    }
    return out;
  }
  for (let i = 0; i < rows; i++) {
    const ptr = contour.intPtr(i, 0);
    out.push({ x: ptr[0], y: ptr[1] });
  }
  return out;
}

/** Perspective warp when a 4-point document boundary is found. */
export function perspectiveCorrectDocument(
  cv: OpenCvModule,
  src: CvMat,
  edgeCfg: EdgeDetectionConfig
): CvMat {
  const gray =
    src.channels() === 1 ? (() => { const c = new cv.Mat(); src.copyTo(c); return c; })() : bgrToGrayMat(cv, src);

  const blurred = new cv.Mat();
  const k = edgeCfg.blurKernel > 0 ? edgeCfg.blurKernel : 5;
  cv.GaussianBlur(gray, blurred, new cv.Size(k, k), 0);

  const edges = new cv.Mat();
  cv.Canny(blurred, edges, edgeCfg.cannyLow, edgeCfg.cannyHigh);

  let edgeMap = edges;
  if (edgeCfg.dilateIterations > 0) {
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    const dilated = new cv.Mat();
    cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), edgeCfg.dilateIterations);
    edges.delete();
    kernel.delete();
    edgeMap = dilated;
  }

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edgeMap, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const imgArea = src.cols * src.rows;
  let bestQuad: Point2[] | null = null;
  let bestArea = 0;

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);
    if (area < imgArea * edgeCfg.minDocumentAreaRatio) continue;

    const peri = cv.arcLength(contour, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, 0.02 * peri, true);

    if (approx.rows === 4 && area > bestArea) {
      const pts = contourToPoints(approx);
      if (pts.length === 4) {
        bestArea = area;
        bestQuad = pts;
      }
    }
    approx.delete();
  }

  releaseMats(blurred, edgeMap, hierarchy, gray);
  contours.delete();

  if (!bestQuad) {
    const copy = new cv.Mat();
    src.copyTo(copy);
    return copy;
  }

  const ordered = orderQuadPoints(bestQuad);
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    ordered[0].x, ordered[0].y,
    ordered[1].x, ordered[1].y,
    ordered[2].x, ordered[2].y,
    ordered[3].x, ordered[3].y,
  ]);

  const widthTop = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
  const widthBot = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
  const heightLeft = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
  const heightRight = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);
  const maxW = Math.round(Math.max(widthTop, widthBot));
  const maxH = Math.round(Math.max(heightLeft, heightRight));

  if (maxW < 80 || maxH < 80) {
    srcTri.delete();
    const copy = new cv.Mat();
    src.copyTo(copy);
    return copy;
  }

  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    maxW - 1, 0,
    maxW - 1, maxH - 1,
    0, maxH - 1,
  ]);

  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const warped = new cv.Mat();
  cv.warpPerspective(
    src,
    warped,
    M,
    new cv.Size(maxW, maxH),
    cv.INTER_LINEAR,
    cv.BORDER_REPLICATE,
    new cv.Scalar(255, 255, 255, 255)
  );

  srcTri.delete();
  dstTri.delete();
  M.delete();
  return warped;
}

/** Crop to bounding box of non-background ink/content. */
export function cropToContent(
  cv: OpenCvModule,
  src: CvMat,
  paddingPx: number,
  backgroundThreshold: number
): CvMat {
  const gray = src.channels() === 1 ? src : bgrToGrayMat(cv, src);
  const needDeleteGray = src.channels() !== 1;

  const binary = new cv.Mat();
  cv.threshold(gray, binary, backgroundThreshold, 255, cv.THRESH_BINARY_INV);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let minX = gray.cols;
  let minY = gray.rows;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let i = 0; i < contours.size(); i++) {
    const r = cv.boundingRect(contours.get(i));
    if (r.width < 8 || r.height < 8) continue;
    found = true;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }

  releaseMats(binary, hierarchy);
  contours.delete();
  if (needDeleteGray) gray.delete();

  if (!found) {
    const copy = new cv.Mat();
    src.copyTo(copy);
    return copy;
  }

  const pad = Math.max(0, paddingPx);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(src.cols, maxX + pad);
  maxY = Math.min(src.rows, maxY + pad);

  const rect = new cv.Rect(minX, minY, maxX - minX, maxY - minY);
  const roi = src.roi(rect);
  const out = new cv.Mat();
  roi.copyTo(out);
  return out;
}
