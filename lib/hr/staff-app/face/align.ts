/**
 * Face alignment for SFace (OpenCV Zoo, Apache-2.0), the same way OpenCV's
 * FaceRecognizerSF.alignCrop does it: a similarity transform (Umeyama) from the five YuNet
 * landmarks onto a fixed 112×112 template, then a bilinear warp. Pure.
 */
import { bilinear, type Point } from '@/lib/hr/staff-app/face/detect';

export const SFACE_SIZE = 112;

/** Where the eyes, nose and mouth corners sit in a 112×112 aligned face (OpenCV's values). */
export const SFACE_TEMPLATE: readonly Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

/** dst ≈ s·R·src + t. */
export type Similarity = { s: number; cos: number; sin: number; tx: number; ty: number };

export function similarityTransform(src: readonly Point[], dst: readonly Point[]): Similarity {
  const n = src.length;
  const mean = (pts: readonly Point[]) => ({
    x: pts.reduce((a, p) => a + p.x, 0) / n,
    y: pts.reduce((a, p) => a + p.y, 0) / n,
  });
  const ms = mean(src);
  const md = mean(dst);
  let sxx = 0;
  let sxy = 0;
  let varSrc = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[i].x - ms.x;
    const ay = src[i].y - ms.y;
    const bx = dst[i].x - md.x;
    const by = dst[i].y - md.y;
    sxx += ax * bx + ay * by;
    sxy += ax * by - ay * bx;
    varSrc += ax * ax + ay * ay;
  }
  if (varSrc === 0) throw new Error('Landmarks are all in one place');
  const theta = Math.atan2(sxy, sxx);
  const s = Math.hypot(sxx, sxy) / varSrc;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { s, cos, sin, tx: md.x - s * (cos * ms.x - sin * ms.y), ty: md.y - s * (sin * ms.x + cos * ms.y) };
}

export function applySimilarity(m: Similarity, p: Point): Point {
  return { x: m.s * (m.cos * p.x - m.sin * p.y) + m.tx, y: m.s * (m.sin * p.x + m.cos * p.y) + m.ty };
}

/**
 * Aligned 112×112 face as SFace's input: 1×3×112×112 RGB floats 0–255
 * (OpenCV's blobFromImage with swapRB on its BGR crop).
 */
export function alignedFaceTensor(rgb: Uint8Array, width: number, height: number, landmarks: readonly Point[]): Float32Array {
  const m = similarityTransform(landmarks, SFACE_TEMPLATE);
  const plane = SFACE_SIZE * SFACE_SIZE;
  const out = new Float32Array(3 * plane);
  const k = 1 / m.s;
  for (let v = 0; v < SFACE_SIZE; v++) {
    for (let u = 0; u < SFACE_SIZE; u++) {
      // Inverse map: src = Rᵀ(dst − t)/s.
      const dx = u - m.tx;
      const dy = v - m.ty;
      const sx = k * (m.cos * dx + m.sin * dy);
      const sy = k * (-m.sin * dx + m.cos * dy);
      const [r, g, b] = bilinear(rgb, width, height, sx, sy);
      const o = v * SFACE_SIZE + u;
      out[o] = r;
      out[plane + o] = g;
      out[2 * plane + o] = b;
    }
  }
  return out;
}
