/**
 * Lazy-loaded OpenCV 4.x runtime (@techstark/opencv-js, WASM).
 * Used by invoice image preprocessing; keep import server-only.
 */

import type * as OpenCV from '@techstark/opencv-js';

export type OpenCvModule = typeof OpenCV;

let cvInstance: OpenCvModule | null = null;
let cvInitPromise: Promise<OpenCvModule> | null = null;

async function loadOpenCvModule(): Promise<OpenCvModule> {
  const mod = await import('@techstark/opencv-js');
  const cvModule = mod.default ?? mod;

  if (cvModule instanceof Promise) {
    return (await cvModule) as OpenCvModule;
  }

  if (typeof (cvModule as OpenCvModule).getBuildInformation === 'function') {
    return cvModule as OpenCvModule;
  }

  await new Promise<void>((resolve) => {
    (cvModule as OpenCvModule & { onRuntimeInitialized?: () => void }).onRuntimeInitialized =
      () => resolve();
  });
  return cvModule as OpenCvModule;
}

const OPENCV_INIT_TIMEOUT_MS = Number.parseInt(
  process.env.OPENCV_INIT_TIMEOUT_MS || '45000',
  10
);

/** Singleton OpenCV module (initialized once per process). */
export async function getOpenCv(): Promise<OpenCvModule> {
  if (cvInstance) return cvInstance;
  if (!cvInitPromise) {
    const load = loadOpenCvModule().then((cv) => {
      cvInstance = cv;
      return cv;
    });
    cvInitPromise = Promise.race([
      load,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`OpenCV WASM init exceeded ${OPENCV_INIT_TIMEOUT_MS}ms`)),
          OPENCV_INIT_TIMEOUT_MS
        );
      }),
    ]);
  }
  return cvInitPromise;
}

/** Release OpenCV Mats safely (no-op for non-Mats). */
export function releaseMats(...mats: Array<{ delete?: () => void } | null | undefined>): void {
  for (const m of mats) {
    try {
      m?.delete?.();
    } catch {
      /* already freed */
    }
  }
}
