/**
 * @jest-environment ./tests/onnx-environment.js
 */
import { existsSync } from 'fs';
import sharp from 'sharp';
import { alignedFaceTensor, applySimilarity, SFACE_TEMPLATE, similarityTransform } from '@/lib/hr/staff-app/face/align';
import { decodeYunet, yawRatio, yunetInput, type DetectedFace } from '@/lib/hr/staff-app/face/detect';
import { analyzeFacePhoto } from '@/lib/hr/staff-app/face/engine';
import {
  LIVENESS_STEPS,
  livenessProblem,
  newLivenessChallenge,
  parseLivenessReport,
  type LivenessChallenge,
} from '@/lib/hr/staff-app/face/liveness';
import { buildFaceEvidence, cosine, type PhotoResult } from '@/lib/hr/staff-app/face/match';
import { faceModelPath } from '@/lib/hr/staff-app/face/models';
import { parseFacePhotos } from '@/lib/hr/staff-app/face/store';

describe('YuNet decoding', () => {
  /** Empty outputs for a 640 input: every cell scores 0. */
  function outputs() {
    const out: Record<string, Float32Array> = {};
    for (const s of [8, 16, 32]) {
      const n = (640 / s) ** 2;
      out[`cls_${s}`] = new Float32Array(n);
      out[`obj_${s}`] = new Float32Array(n);
      out[`bbox_${s}`] = new Float32Array(n * 4);
      out[`kps_${s}`] = new Float32Array(n * 10);
    }
    return out;
  }
  function put(out: Record<string, Float32Array>, stride: number, r: number, c: number, score: number, bbox: number[]) {
    const i = r * (640 / stride) + c;
    out[`cls_${stride}`][i] = score;
    out[`obj_${stride}`][i] = score;
    out[`bbox_${stride}`].set(bbox, i * 4);
    out[`kps_${stride}`].set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], i * 10);
  }

  it('turns a grid cell into a box and landmarks in the original picture', () => {
    const out = outputs();
    put(out, 16, 10, 12, 0.95, [0.5, 0.5, Math.log(4), Math.log(5)]);
    const [face] = decodeYunet(out, 0.5);
    // centre (12.5, 10.5) × 16 = (200, 168), size 64 × 80, then ÷ 0.5
    expect(face.score).toBeCloseTo(0.95);
    expect(face.box.x).toBeCloseTo(336);
    expect(face.box.y).toBeCloseTo(256);
    expect(face.box.w).toBeCloseTo(128);
    expect(face.box.h).toBeCloseTo(160);
    expect(face.landmarks[0].x).toBeCloseTo(((0.1 + 12) * 16) / 0.5);
    expect(face.landmarks[4].y).toBeCloseTo(((1.0 + 10) * 16) / 0.5);
  });

  it('keeps the strongest of overlapping boxes, separate faces, and drops weak scores', () => {
    const out = outputs();
    put(out, 16, 10, 12, 0.95, [0.5, 0.5, Math.log(4), Math.log(5)]);
    put(out, 8, 21, 25, 0.9, [0, 0, Math.log(8), Math.log(10)]); // same box from the finer grid
    put(out, 32, 2, 2, 0.85, [0, 0, 1, 1]); // another face
    put(out, 32, 15, 15, 0.5, [0, 0, 1, 1]); // too weak
    const faces = decodeYunet(out, 1);
    expect(faces.map((f) => Math.round(f.score * 100))).toEqual([95, 85]);
  });

  it('builds a BGR input with the picture scaled into the top-left corner', () => {
    const rgb = new Uint8Array([10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30]); // 2×2, one colour
    const { data, scale } = yunetInput(rgb, 2, 2);
    expect(scale).toBe(160);
    const plane = 640 * 640;
    expect([data[0], data[plane], data[2 * plane]]).toEqual([30, 20, 10]);
    expect(data[639]).toBe(0); // right of the picture stays black
  });

  it('measures a head turn from the landmarks', () => {
    const face = (noseX: number): DetectedFace => ({
      box: { x: 0, y: 0, w: 100, h: 100 },
      landmarks: [{ x: 40, y: 50 }, { x: 60, y: 50 }, { x: noseX, y: 60 }, { x: 42, y: 80 }, { x: 58, y: 80 }],
      score: 1,
    });
    expect(yawRatio(face(50))).toBeCloseTo(0);
    expect(Math.abs(yawRatio(face(58)))).toBeCloseTo(0.4);
  });
});

describe('SFace alignment', () => {
  it('recovers a known similarity transform', () => {
    const truth = { s: 1.7, cos: Math.cos(0.3), sin: Math.sin(0.3), tx: 12, ty: -5 };
    const src = SFACE_TEMPLATE.map((p) => ({ x: p.x * 2 + 3, y: p.y * 2 - 1 }));
    const dst = src.map((p) => applySimilarity(truth, p));
    const m = similarityTransform(src, dst);
    expect(m.s).toBeCloseTo(1.7, 6);
    expect(m.cos).toBeCloseTo(truth.cos, 6);
    expect(m.tx).toBeCloseTo(12, 4);
  });

  it('a face already in template position comes out unchanged, as RGB planes', () => {
    const rgb = new Uint8Array(112 * 112 * 3).map((_, i) => (i * 7) % 251);
    const t = alignedFaceTensor(rgb, 112, 112, SFACE_TEMPLATE);
    const plane = 112 * 112;
    for (const [u, v] of [[0, 0], [50, 60], [111, 111]]) {
      const i = (v * 112 + u) * 3;
      expect(t[v * 112 + u]).toBeCloseTo(rgb[i], 3);
      expect(t[plane + v * 112 + u]).toBeCloseTo(rgb[i + 1], 3);
      expect(t[2 * plane + v * 112 + u]).toBeCloseTo(rgb[i + 2], 3);
    }
  });
});

describe('liveness', () => {
  const challenge: LivenessChallenge = { steps: ['smile', 'turn_left', 'blink'], photos: 3, timeout_ms: 25000 };
  const report = (over = {}) =>
    parseLivenessReport({
      steps: challenge.steps,
      completed: challenge.steps,
      passed: true,
      duration_ms: 6000,
      frames: 90,
      face_changes: 0,
      ...over,
    });

  it('asks for three different actions, always including a head turn', () => {
    for (let seed = 0; seed < 50; seed++) {
      let x = seed;
      const c = newLivenessChallenge((max) => (x = (x * 31 + 7) % 997) % max);
      expect(new Set(c.steps).size).toBe(3);
      expect(c.steps.every((s) => (LIVENESS_STEPS as readonly string[]).includes(s))).toBe(true);
      expect(c.steps.some((s) => s.startsWith('turn_'))).toBe(true);
    }
  });

  it('accepts the asked-for actions done in order by one face', () => {
    expect(livenessProblem(challenge, report())).toBeNull();
  });

  it('refuses a wrong order, a face swap, a not-passed report, a missing report and impossible timing', () => {
    expect(livenessProblem(challenge, report({ completed: ['turn_left', 'smile', 'blink'] }))).toBe('wrong_steps');
    expect(livenessProblem(challenge, report({ steps: ['blink', 'smile', 'turn_right'] }))).toBe('wrong_steps');
    expect(livenessProblem(challenge, report({ face_changes: 1 }))).toBe('face_changed');
    expect(livenessProblem(challenge, report({ passed: false }))).toBe('not_passed');
    expect(livenessProblem(challenge, null)).toBe('no_report');
    expect(livenessProblem(challenge, report({ duration_ms: 300 }))).toBe('timing');
    expect(livenessProblem(challenge, report({ frames: 2 }))).toBe('too_few_frames');
  });
});

describe('one-to-one match evidence', () => {
  /** Deterministic pseudo-random vectors: same seed = same person, `noise` = a different photo of them. */
  const random = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  const unit = (seed: number, noise = 0) => {
    const person = random(seed * 7919);
    const photo = random(seed * 31 + Math.round(noise * 1000));
    const v = Array.from({ length: 128 }, () => person() + noise * photo());
    const n = Math.hypot(...v);
    return Float32Array.from(v.map((x) => x / n));
  };
  const photo = (label: string, embedding: Float32Array | null, yaw = 0, faces = 1): PhotoResult => ({
    label,
    analysis: { faces, face: null, embedding, yaw },
  });
  const me = [unit(1), unit(1, 0.3)];

  it('the same person scores high, someone else low', () => {
    expect(cosine(unit(1), unit(1, 0.2))).toBeGreaterThan(0.9);
    expect(Math.abs(cosine(unit(1), unit(2)))).toBeLessThan(0.4);
  });

  it('reports the median best similarity, consistency and the head turn', () => {
    const e = buildFaceEvidence({
      livenessProblem: null,
      photos: [photo('start', unit(1, 0.1), 0.05), photo('turn_left', unit(1, 0.25), 0.45), photo('end', unit(1, 0.15), 0.02)],
      templates: me,
      engineAvailable: true,
      replayed: false,
    });
    expect(e.photos_with_face).toBe(3);
    expect(e.similarity).toBeGreaterThan(0.9);
    expect(e.consistent).toBe(true);
    expect(e.pose_seen).toBe(true);
  });

  it('notices someone else in one photo, a missing turn and a crowded frame', () => {
    const e = buildFaceEvidence({
      livenessProblem: null,
      photos: [photo('start', unit(1)), photo('turn_right', unit(2), 0.05), photo('end', unit(1), 0, 2)],
      templates: me,
      engineAvailable: true,
      replayed: false,
    });
    expect(e.consistent).toBe(false);
    expect(e.pose_seen).toBe(false);
    expect(e.multiple_faces).toBe(true);
    expect(e.photos_with_face).toBe(2);
  });

  it('without the engine there is nothing to compare', () => {
    const e = buildFaceEvidence({ livenessProblem: null, photos: [], templates: me, engineAvailable: false, replayed: false });
    expect(e.engine_available).toBe(false);
    expect(e.similarity).toBeNull();
  });
});

describe('photos from the phone', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(800, 7)]);

  it('decodes labelled base64 JPEGs and hashes them', () => {
    const [p] = parseFacePhotos([{ label: 'start', jpeg: jpeg.toString('base64') }], ['start'], 3);
    expect(p.jpeg.equals(jpeg)).toBe(true);
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses unknown labels, non-JPEG data, oversized photos and too many photos', () => {
    const ok = jpeg.toString('base64');
    expect(() => parseFacePhotos([{ label: 'selfie', jpeg: ok }], ['start'], 3)).toThrow();
    expect(() => parseFacePhotos([{ label: 'start', jpeg: Buffer.alloc(800, 1).toString('base64') }], ['start'], 3)).toThrow();
    const huge = Buffer.concat([jpeg, Buffer.alloc(400 * 1024)]).toString('base64');
    expect(() => parseFacePhotos([{ label: 'start', jpeg: huge }], ['start'], 3)).toThrow();
    expect(() => parseFacePhotos(Array(4).fill({ label: 'start', jpeg: ok }), ['start'], 3)).toThrow();
  });
});

// Runs the real ONNX models when `npm run face:models` has fetched them.
const haveModels = existsSync(faceModelPath('detector')) && existsSync(faceModelPath('recognizer'));
(haveModels ? describe : describe.skip)('engine with the real models', () => {
  jest.setTimeout(30000);

  it('finds no face in a plain picture', async () => {
    const plain = await sharp({ create: { width: 240, height: 300, channels: 3, background: '#9a8878' } })
      .jpeg()
      .toBuffer();
    const r = await analyzeFacePhoto(plain);
    expect(r.faces).toBe(0);
    expect(r.embedding).toBeNull();
  });

  it('refuses something that is not an image', async () => {
    await expect(analyzeFacePhoto(Buffer.from('not a jpeg'))).rejects.toThrow();
  });
});
