/**
 * Runs YuNet + SFace on our own server with onnxruntime-node. A JPEG goes in; the number of
 * faces, the main face and its 128-number template come out. Sessions load once, on first use.
 */
import { existsSync } from 'fs';
import sharp from 'sharp';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { alignedFaceTensor, SFACE_SIZE } from '@/lib/hr/staff-app/face/align';
import { decodeYunet, yawRatio, yunetInput, YUNET_INPUT, type DetectedFace } from '@/lib/hr/staff-app/face/detect';
import { faceModelPath } from '@/lib/hr/staff-app/face/models';

/** Photos bigger than this are refused before decoding. */
export const MAX_PHOTO_BYTES = 300 * 1024;
const MAX_PHOTO_SIDE = 1600;
/** A detected face must be at least this many pixels wide to be worth matching. */
export const MIN_FACE_PX = 60;

export class FaceEngineUnavailable extends Error {}

type Engine = { ort: typeof import('onnxruntime-node'); detector: InferenceSession; recognizer: InferenceSession };
let loading: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  if (!loading) {
    loading = (async () => {
      const detectorPath = faceModelPath('detector');
      const recognizerPath = faceModelPath('recognizer');
      if (!existsSync(detectorPath) || !existsSync(recognizerPath)) {
        throw new FaceEngineUnavailable('Face models are missing. Run `npm run face:models` on the server.');
      }
      const ort = await import('onnxruntime-node');
      const options: InferenceSession.SessionOptions = { logSeverityLevel: 3, intraOpNumThreads: 2 };
      const [detector, recognizer] = await Promise.all([
        ort.InferenceSession.create(detectorPath, options),
        ort.InferenceSession.create(recognizerPath, options),
      ]);
      return { ort, detector, recognizer };
    })().catch((error) => {
      loading = null;
      throw error instanceof FaceEngineUnavailable ? error : new FaceEngineUnavailable(String(error?.message ?? error));
    });
  }
  return loading;
}

export type FaceAnalysis = {
  /** Faces YuNet found. */
  faces: number;
  /** The strongest face, or null. */
  face: DetectedFace | null;
  /** L2-normalised SFace template of `face`; null when there is no usable face. */
  embedding: Float32Array | null;
  yaw: number | null;
};

async function decodeJpeg(jpeg: Buffer): Promise<{ rgb: Uint8Array; width: number; height: number }> {
  if (jpeg.length === 0 || jpeg.length > MAX_PHOTO_BYTES) throw new Error('photo size');
  const { data, info } = await sharp(jpeg, { limitInputPixels: MAX_PHOTO_SIDE * MAX_PHOTO_SIDE })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || info.width > MAX_PHOTO_SIDE || info.height > MAX_PHOTO_SIDE) throw new Error('photo shape');
  return { rgb: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  return v.map((x) => x / n);
}

/** Throws FaceEngineUnavailable when the models cannot load, a plain Error for an unreadable photo. */
export async function analyzeFacePhoto(jpeg: Buffer): Promise<FaceAnalysis> {
  const engine = await loadEngine();
  const { rgb, width, height } = await decodeJpeg(jpeg);

  const input = yunetInput(rgb, width, height);
  const detOut = await engine.detector.run({
    [engine.detector.inputNames[0]]: new engine.ort.Tensor('float32', input.data, [1, 3, YUNET_INPUT, YUNET_INPUT]),
  });
  const outputs: Record<string, Float32Array> = {};
  for (const [name, t] of Object.entries(detOut)) outputs[name] = (t as Tensor).data as Float32Array;
  const faces = decodeYunet(outputs, input.scale);
  const face = faces[0] ?? null;
  if (!face || face.box.w < MIN_FACE_PX) return { faces: faces.length, face, embedding: null, yaw: face ? yawRatio(face) : null };

  const aligned = alignedFaceTensor(rgb, width, height, face.landmarks);
  const recOut = await engine.recognizer.run({
    [engine.recognizer.inputNames[0]]: new engine.ort.Tensor('float32', aligned, [1, 3, SFACE_SIZE, SFACE_SIZE]),
  });
  const raw = recOut[engine.recognizer.outputNames[0]].data as Float32Array;
  return { faces: faces.length, face, embedding: normalize(Float32Array.from(raw)), yaw: yawRatio(face) };
}

/** True once both models have loaded (used by a health check / the owner screen). */
export async function faceEngineReady(): Promise<boolean> {
  try {
    await loadEngine();
    return true;
  } catch {
    return false;
  }
}
