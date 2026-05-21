'use client';

/**
 * Full-screen document crop overlay.
 * Drag the 4 corner handles to define the invoice boundary, then tap "Use Photo".
 * On confirm, the bounding-box crop is applied via canvas and a new File is returned.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Check } from 'lucide-react';

interface Point { x: number; y: number } // 0–1 proportional to rendered image

interface Props {
  imageFile: File;
  onCrop: (croppedFile: File) => void;
  onRetake: () => void;
}

const HANDLE_R = 22; // px radius of touch handle

// Initial corners: slightly inset from the image edges
const DEFAULT_CORNERS: Point[] = [
  { x: 0.05, y: 0.05 }, // top-left
  { x: 0.95, y: 0.05 }, // top-right
  { x: 0.95, y: 0.95 }, // bottom-right
  { x: 0.05, y: 0.95 }, // bottom-left
];

export function DocumentCropScreen({ imageFile, onCrop, onRetake }: Props) {
  const [corners, setCorners] = useState<Point[]>(DEFAULT_CORNERS);
  const [dragging, setDragging] = useState<number | null>(null);
  const [imgSrc, setImgSrc] = useState('');
  const [applying, setApplying] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Create object URL for the captured file
  useEffect(() => {
    const url = URL.createObjectURL(imageFile);
    setImgSrc(url);
    setCorners(DEFAULT_CORNERS);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Convert client coords → proportional coords relative to rendered image
  const clientToImg = useCallback((clientX: number, clientY: number): Point => {
    const img = imgRef.current;
    if (!img) return { x: 0.5, y: 0.5 };
    const r = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    return { x, y };
  }, []);

  const handlePointerDown = useCallback((idx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(idx);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging === null) return;
    const pt = clientToImg(e.clientX, e.clientY);
    setCorners(prev => prev.map((c, i) => i === dragging ? pt : c));
  }, [dragging, clientToImg]);

  const handlePointerUp = useCallback(() => setDragging(null), []);

  // Convert proportional corner to CSS % string for positioning inside the image element
  const handleStyle = (p: Point): React.CSSProperties => ({
    left: `${p.x * 100}%`,
    top: `${p.y * 100}%`,
    transform: 'translate(-50%, -50%)',
  });

  // Polygon points for the SVG mask
  const polygonPoints = corners
    .map(c => `${c.x * 100}% ${c.y * 100}%`)
    .join(', ');

  // Crop using canvas: bounding-box of the 4 corners
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
            const ext = imageFile.name.replace(/\.[^.]+$/, '');
            onCrop(new File([blob], `${ext}_cropped.jpg`, { type: 'image/jpeg' }));
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Image + handles container */}
      <div
        ref={containerRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {imgSrc && (
          <>
            <img
              ref={imgRef}
              src={imgSrc}
              alt="Invoice"
              draggable={false}
              className="max-h-full max-w-full select-none object-contain"
              style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
            />

            {/* SVG overlay — darkens outside selection */}
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <clipPath id="crop-hole">
                  {/* We need to overlay the image, not full svg */}
                </clipPath>
              </defs>
            </svg>

            {/* Polygon overlay using absolute-positioned div that matches image */}
            <div
              className="pointer-events-none absolute"
              style={{
                left: imgRef.current ? imgRef.current.getBoundingClientRect().left - (containerRef.current?.getBoundingClientRect().left ?? 0) : 0,
                top:  imgRef.current ? imgRef.current.getBoundingClientRect().top  - (containerRef.current?.getBoundingClientRect().top  ?? 0) : 0,
                width:  imgRef.current?.getBoundingClientRect().width  ?? '100%',
                height: imgRef.current?.getBoundingClientRect().height ?? '100%',
              }}
            >
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {/* Dark mask outside the selection */}
                <defs>
                  <mask id="sel-mask">
                    <rect width="100" height="100" fill="white" />
                    <polygon
                      points={corners.map(c => `${c.x * 100},${c.y * 100}`).join(' ')}
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect width="100" height="100" fill="rgba(0,0,0,0.55)" mask="url(#sel-mask)" />
                {/* Selection border */}
                <polygon
                  points={corners.map(c => `${c.x * 100},${c.y * 100}`).join(' ')}
                  fill="none"
                  stroke="white"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                />
                {/* Edge midpoint lines */}
                {corners.map((c, i) => {
                  const next = corners[(i + 1) % 4];
                  const mx = (c.x + next.x) / 2 * 100;
                  const my = (c.y + next.y) / 2 * 100;
                  return (
                    <circle key={i} cx={mx} cy={my} r="1" fill="white" opacity="0.6" />
                  );
                })}
              </svg>
            </div>

            {/* Corner handles — positioned relative to the container, aligned to image */}
            {corners.map((corner, idx) => {
              const img = imgRef.current;
              const cont = containerRef.current;
              if (!img || !cont) return null;
              const ir = img.getBoundingClientRect();
              const cr = cont.getBoundingClientRect();
              const cx = (ir.left - cr.left) + corner.x * ir.width;
              const cy = (ir.top  - cr.top)  + corner.y * ir.height;
              return (
                <div
                  key={idx}
                  onPointerDown={handlePointerDown(idx)}
                  className="absolute flex cursor-grab items-center justify-center active:cursor-grabbing"
                  style={{
                    left: cx,
                    top: cy,
                    width: HANDLE_R * 2,
                    height: HANDLE_R * 2,
                    transform: 'translate(-50%, -50%)',
                    touchAction: 'none',
                    zIndex: 10,
                  }}
                >
                  {/* Outer ring */}
                  <div className="absolute inset-0 rounded-full border-2 border-white opacity-60" />
                  {/* Inner dot */}
                  <div className="h-4 w-4 rounded-full bg-white shadow-md" />
                </div>
              );
            })}
          </>
        )}
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
          disabled={applying}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-gray-900 disabled:opacity-60 active:bg-gray-100"
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
