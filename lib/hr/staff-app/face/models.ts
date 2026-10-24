/**
 * The two ONNX models, kept on our own server (never sent anywhere):
 *  - YuNet face detector, OpenCV Zoo face_detection_yunet_2023mar — MIT.
 *  - SFace face recognizer, OpenCV Zoo face_recognition_sface_2021dec — Apache-2.0.
 * Both allow commercial use. InsightFace's pretrained weights are non-commercial and are not used.
 * `npm run face:models` downloads them into models/face and checks the hashes in manifest.json.
 */
import path from 'path';
import manifest from '@/models/face/manifest.json';

/** Stored with every template, so a later model change can tell old templates apart. */
export const FACE_MODEL_ID = 'sface_2021dec';

export const FACE_MODELS = manifest;

/** FACE_MODEL_DIR overrides where the .onnx files are read from. */
export function faceModelDir(): string {
  return process.env.FACE_MODEL_DIR || path.join(process.cwd(), 'models', 'face');
}

export function faceModelPath(which: keyof typeof manifest): string {
  return path.join(faceModelDir(), manifest[which].file);
}
