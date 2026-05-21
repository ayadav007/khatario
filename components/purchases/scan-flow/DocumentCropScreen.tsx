'use client';

/**
 * Full-screen document crop overlay.
 *
 * Layout approach:
 * - The <img> sits inside a `relative` wrapper that is exactly as large as the
 *   rendered image.  All handles and the SVG overlay are `absolute` children of
 *   that same wrapper, so we can use plain percentage positioning (corner.x * 100%)
 *   without ever calling getBoundingClientRect() during render.
 * - Pointer tracking uses document-level listeners added while a drag is active,
 *   which works reliably across the full viewport including outside the image.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Check } from 'lucide-react';

interface Point { x: number; y: number } // 0–1 proportional to rendered image

interface Props {
  imageFile: File;
  onCrop: (croppedFile: File) => void;
  onRetake: () => void;
}

const HANDLE_TOUCH_SIZE = 44; // px — minimum tap target
const DEFAULT_CORNERS: Point[] = [
  { x: 0.05, y: 0.05 }, // top-left
  { x: 0.95, y: 0.05 }, // top-right
  { x: 0.95, y: 0.95 }, // bottom-right
  { x: 0.05, y: 0.95 }, // bottom-left
];

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

export function DocumentCropScreen({ imageFile, onCrop, onRetake }: Props) {
  const [corners, setCorners] = useState<Point[]>(DEFAULT_CORNERS);
  const [dragging, setDragging] = useState<number | null>(null);
  const [imgSrc, setImgSrc] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [applying, setApplying] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Create object URL for the captured file
  useEffect(() => {
    const url = URL.createObjectURL(imageFile);
    setImgSrc(url);
    setLoaded(false);
    setCorners(DEFAULT_CORNERS);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Convert client coords → proportional coords relative to rendered image
  const clientToImg = useCallback((clientX: number, clientY: number): Point => {
    const img = imgRef.current;
    if (!img) return { x: 0.5, y: 0.5 };
    const r = img.getBoundingClientRect();
    return {
      x: clamp01((clientX - r.left) / r.width),
      y: clamp01((clientY - r.top) / r.height),
    };
  }, []);

  // Document-level listeners during drag (more reliable than container onPointerMove)
  useEffect(() => {
    if (dragging === null) return;

    const onMove = (e: PointerEvent) => {
      const pt = clientToImg(e.clientX, e.clientY);
      setCorners(prev => prev.map((c, i) => (i === dragging ? pt : c)));
    };
    const onUp = () => setDragging(null);

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, clientToImg]);

  const handlePointerDown = (idx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(idx);
  };

  // Crop: bounding-box of the 4 corners on the natural image
  const handleCrop = useCallback(async () => {
    const img = imgRef.current;
    if (!img || applying) return;
    setApplying(true);
    try {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const xs = corners.map(c => c.x * nw);
      const ys = corners.map(c => c.y * nh);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const x1 = Math.min(nw, Math.ceil(Math.max(...xs)));
      const y1 = Math.min(nh, Math.ceil(Math.max(...ys)));
      const w = x1 - x0;
      const h = y1 - y0;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);

      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(
          blob => {
            if (!blob) { reject(new Error('Crop failed')); return; }
            const base = imageFile.name.replace(/\.[^.]+$/, '');
            onCrop(new File([blob], `${base}_cropped.jpg`, { type: 'image/jpeg' }));
            resolve();
          },
          'image/jpeg',
          0.92,
        );
      });
    } finally {
      setApplying(false);
    }
  }, [corners, imageFile, onCrop, applying]);

  const polyPoints = corners.map(c => `${c.x * 100},${c.y * 100}`).join(' ');

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* Image area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {/* The `inline-block` wrapper shrinks to fit the <img> exactly */}
        <div className="relative inline-block max-h-full max-w-full">
          <img
            ref={imgRef}
            src={imgSrc}
            alt="Invoice"
            draggable={false}
            onLoad={() => setLoaded(true)}
            className="block max-h-[calc(100dvh-8rem)] max-w-full select-none object-contain"
            style={{ userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
          />

          {loaded && (
            <>
              {/* SVG overlay — darkens area outside selection */}
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <defs>
                  <mask id="crop-mask">
                    <rect width="100" height="100" fill="white" />
                    <polygon points={polyPoints} fill="black" />
                  </mask>
                </defs>
                {/* Dark overlay outside selection */}
                <rect width="100" height="100" fill="rgba(0,0,0,0.55)" mask="url(#crop-mask)" />
                {/* Selection border */}
                <polygon
                  points={polyPoints}
                  fill="none"
                  stroke="white"
                  strokeWidth="0.6"
                  vectorEffect="non-scaling-stroke"
                />
                {/* Mid-edge dots */}
                {corners.map((c, i) => {
                  const next = corners[(i + 1) % 4]!;
                  return (
                    <circle
                      key={i}
                      cx={(c.x + next.x) / 2 * 100}
                      cy={(c.y + next.y) / 2 * 100}
                      r="1"
                      fill="white"
                      opacity="0.7"
                    />
                  );
                })}
              </svg>

              {/* Corner handles — percentage-positioned within this relative wrapper */}
              {corners.map((corner, idx) => (
                <div
                  key={idx}
                  onPointerDown={handlePointerDown(idx)}
                  className="absolute flex cursor-grab items-center justify-center active:cursor-grabbing"
                  style={{
                    left: `${corner.x * 100}%`,
                    top: `${corner.y * 100}%`,
                    width: HANDLE_TOUCH_SIZE,
                    height: HANDLE_TOUCH_SIZE,
                    transform: 'translate(-50%, -50%)',
                    touchAction: 'none',
                    zIndex: 10,
                  }}
                >
                  {/* L-bracket corners for each handle */}
                  <div className="relative h-full w-full">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-5 w-5 rounded-full bg-white shadow-lg ring-2 ring-white/40" />
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div
        className="flex shrink-0 items-center justify-between gap-4 bg-black/90 px-6 py-4"
        style={{ paddingBottom: `calc(1rem + env(safe-area-inset-bottom, 0px))` }}
      >
        <button
          type="button"
          onClick={onRetake}
          className="flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-medium text-white active:bg-white/10"
        >
          <RotateCcw className="h-4 w-4" />
          Retake
        </button>

        <button
          type="button"
          onClick={handleCrop}
          disabled={applying || !loaded}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-gray-900 disabled:opacity-50 active:bg-gray-100"
        >
          {applying ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-gray-900" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Use Photo
        </button>
      </div>
    </div>
  );
}
