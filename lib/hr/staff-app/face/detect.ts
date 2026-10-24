/**
 * YuNet face detector (OpenCV Zoo, MIT): turning a picture into the model's input and the
 * model's twelve outputs back into faces. Mirrors OpenCV's FaceDetectorYN so results match it.
 * Pure — the ONNX session lives in engine.ts.
 */

/** face_detection_yunet_2023mar.onnx takes a fixed 640×640 BGR picture. */
export const YUNET_INPUT = 640;
/** The photo is scaled so its long side is this, leaving room around the face (YuNet finds faces up to ~300 px). */
export const YUNET_FIT = 320;
const STRIDES = [8, 16, 32] as const;

export type Point = { x: number; y: number };

export type DetectedFace = {
  box: { x: number; y: number; w: number; h: number };
  /** Right eye, left eye, nose tip, right mouth corner, left mouth corner (as YuNet orders them). */
  landmarks: [Point, Point, Point, Point, Point];
  score: number;
};

export type YunetOutputs = Record<string, Float32Array>;

/**
 * RGB pixels (row-major, 3 bytes each) → 1×3×640×640 BGR float tensor, picture scaled to fit
 * YUNET_FIT and placed top-left on black. Returns the scale to map detections back.
 */
export function yunetInput(rgb: Uint8Array, width: number, height: number): { data: Float32Array; scale: number } {
  const scale = YUNET_FIT / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const plane = YUNET_INPUT * YUNET_INPUT;
  const data = new Float32Array(3 * plane);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const [r, g, b] = bilinear(rgb, width, height, sx, sy);
      const o = y * YUNET_INPUT + x;
      data[o] = b;
      data[plane + o] = g;
      data[2 * plane + o] = r;
    }
  }
  return { data, scale };
}

/** Bilinear RGB sample; outside the picture reads black. */
export function bilinear(rgb: Uint8Array, width: number, height: number, x: number, y: number): [number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const p = (xx: number, yy: number) =>
      xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : rgb[(yy * width + xx) * 3 + c];
    const top = p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx;
    const bottom = p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

function iou(a: DetectedFace['box'], b: DetectedFace['box']): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Decodes YuNet's cls/obj/bbox/kps outputs (one row per grid cell, strides 8/16/32), keeps
 * scores ≥ threshold, applies NMS, and maps boxes back to the original picture with `scale`.
 * Strongest face first.
 */
export function decodeYunet(
  out: YunetOutputs,
  scale: number,
  { scoreThreshold = 0.8, nmsThreshold = 0.3, inputSize = YUNET_INPUT } = {},
): DetectedFace[] {
  const found: DetectedFace[] = [];
  for (const stride of STRIDES) {
    const cls = out[`cls_${stride}`];
    const obj = out[`obj_${stride}`];
    const bbox = out[`bbox_${stride}`];
    const kps = out[`kps_${stride}`];
    if (!cls || !obj || !bbox || !kps) throw new Error(`YuNet output for stride ${stride} is missing`);
    const cols = Math.floor(inputSize / stride);
    const rows = Math.floor(inputSize / stride);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]));
        if (score < scoreThreshold) continue;
        const cx = (c + bbox[i * 4]) * stride;
        const cy = (r + bbox[i * 4 + 1]) * stride;
        const w = Math.exp(bbox[i * 4 + 2]) * stride;
        const h = Math.exp(bbox[i * 4 + 3]) * stride;
        const landmarks = [0, 1, 2, 3, 4].map((n) => ({
          x: ((kps[i * 10 + 2 * n] + c) * stride) / scale,
          y: ((kps[i * 10 + 2 * n + 1] + r) * stride) / scale,
        })) as DetectedFace['landmarks'];
        found.push({
          box: { x: (cx - w / 2) / scale, y: (cy - h / 2) / scale, w: w / scale, h: h / scale },
          landmarks,
          score,
        });
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  const kept: DetectedFace[] = [];
  for (const f of found) {
    if (kept.every((k) => iou(k.box, f.box) <= nmsThreshold)) kept.push(f);
  }
  return kept;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * How far the head is turned, from the landmarks: nose offset from the middle of the eyes, in
 * eye-distance units. About 0 looking straight on, beyond ±0.25 clearly turned. Sign is not used.
 */
export function yawRatio(face: DetectedFace): number {
  const [re, le, nose] = face.landmarks;
  const eyeDist = Math.hypot(le.x - re.x, le.y - re.y);
  if (eyeDist <= 0) return 0;
  return (nose.x - (re.x + le.x) / 2) / eyeDist;
}
