'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Upload, Download, Loader2, Info, AlertCircle, Sparkles, Eraser, Paintbrush } from 'lucide-react';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task';
const POSITIVE_STROKE = 1;
const MAX_EDGE = 1600;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type NormPoint = { x: number; y: number };

type ConfidenceMask = {
  width: number;
  height: number;
  getAsFloat32Array: () => Float32Array;
  close: () => void;
};

type Segmenter = {
  setImage: (image: CanvasImageSource) => void;
  segment: (
    strokes: Array<{ brushMode: number; point: NormPoint[]; isCompleted: boolean }>
  ) => ConfidenceMask;
};

type VisionModule = {
  FilesetResolver: {
    forVisionTasks: (path: string) => Promise<unknown>;
  };
  InteractiveSegmenter: {
    createFromOptions: (
      wasm: unknown,
      options: { baseOptions: { modelAssetPath: string; delegate?: 'CPU' | 'GPU' } }
    ) => Promise<Segmenter>;
  };
};

type BrushMode = 'erase' | 'restore';
type Backdrop = 'transparent' | 'white' | 'custom';

declare global {
  interface Window {
    __khatarioVision?: VisionModule;
  }
}

function loadVisionModule(): Promise<VisionModule> {
  if (window.__khatarioVision) return Promise.resolve(window.__khatarioVision);
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (window.__khatarioVision) resolve(window.__khatarioVision);
      else reject(new Error('Selection model failed to start.'));
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-khatario-vision="1"]');
    if (existing) {
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Selection model failed to download.')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/tools/mediapipe-vision.js';
    script.dataset.khatarioVision = '1';
    script.onload = finish;
    script.onerror = () => reject(new Error('Selection model failed to download.'));
    document.head.appendChild(script);
  });
}

let segmenterPromise: Promise<Segmenter> | null = null;

function loadSegmenter(): Promise<Segmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const vision = await loadVisionModule();
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      try {
        return await vision.InteractiveSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        });
      } catch {
        return await vision.InteractiveSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        });
      }
    })();
    segmenterPromise.catch(() => {
      segmenterPromise = null;
    });
  }
  return segmenterPromise;
}

function scaleToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the image.');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This browser could not read that image.'));
    image.src = src;
  });
}

function writeConfidenceMask(
  mask: HTMLCanvasElement,
  data: Float32Array,
  width: number,
  height: number
) {
  const raw = document.createElement('canvas');
  raw.width = width;
  raw.height = height;
  const rawCtx = raw.getContext('2d');
  const maskCtx = mask.getContext('2d');
  if (!rawCtx || !maskCtx) throw new Error('Could not build the cutout.');

  const pixels = rawCtx.createImageData(width, height);
  const channel = pixels.data;
  for (let i = 0; i < width * height; i += 1) {
    const confidence = data[i] ?? 0;
    const alpha = Math.round(Math.min(1, Math.max(0, (confidence - 0.2) / 0.5)) * 255);
    const offset = i * 4;
    channel[offset] = 255;
    channel[offset + 1] = 255;
    channel[offset + 2] = 255;
    channel[offset + 3] = alpha;
  }
  rawCtx.putImageData(pixels, 0, 0);
  maskCtx.clearRect(0, 0, mask.width, mask.height);
  maskCtx.drawImage(raw, 0, 0, mask.width, mask.height);
}

function paintComposite(
  preview: HTMLCanvasElement,
  source: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  backdrop: Backdrop,
  customColor: string
) {
  preview.width = source.width;
  preview.height = source.height;
  const ctx = preview.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, preview.width, preview.height);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  if (backdrop !== 'transparent') {
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = backdrop === 'white' ? '#ffffff' : customColor;
    ctx.fillRect(0, 0, preview.width, preview.height);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function canvasPoint(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLElement>) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

export default function ImageBackgroundRemoverPage() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [brushMode, setBrushMode] = useState<BrushMode>('erase');
  const [brushSize, setBrushSize] = useState(24);
  const [backdrop, setBackdrop] = useState<Backdrop>('transparent');
  const [customColor, setCustomColor] = useState('#f4f1ea');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const segmenterRef = useRef<Segmenter | null>(null);
  const imageTokenRef = useRef(0);
  const preparedTokenRef = useRef(0);
  const generationRef = useRef(0);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const brushModeRef = useRef(brushMode);
  const brushSizeRef = useRef(brushSize);
  const backdropRef = useRef(backdrop);
  const customColorRef = useRef(customColor);

  useEffect(() => {
    brushModeRef.current = brushMode;
    brushSizeRef.current = brushSize;
    backdropRef.current = backdrop;
    customColorRef.current = customColor;
  }, [brushMode, brushSize, backdrop, customColor]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const redraw = () => {
    const preview = previewRef.current;
    const source = sourceRef.current;
    const mask = maskRef.current;
    if (!preview || !source || !mask) return;
    paintComposite(preview, source, mask, backdropRef.current, customColorRef.current);
  };

  useEffect(() => {
    if (hasResult) redraw();
  }, [hasResult, backdrop, customColor]);

  const ensureModel = async () => {
    if (segmenterRef.current) return segmenterRef.current;
    setLoadingModel(true);
    try {
      const segmenter = await loadSegmenter();
      segmenterRef.current = segmenter;
      setModelReady(true);
      return segmenter;
    } catch (err) {
      console.error('Background model failed to load', err);
      setError('The selection model could not be downloaded. Check your connection and try again.');
      throw err;
    } finally {
      setLoadingModel(false);
    }
  };

  const cutOut = async (point: NormPoint) => {
    const source = sourceRef.current;
    if (!source) return;
    const generation = generationRef.current;
    const token = imageTokenRef.current;
    setProcessing(true);
    setError(null);
    try {
      const segmenter = await ensureModel();
      if (generation !== generationRef.current) return;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      if (preparedTokenRef.current !== token) {
        segmenter.setImage(source);
        preparedTokenRef.current = token;
      }
      const maskResult = segmenter.segment([
        { brushMode: POSITIVE_STROKE, point: [point], isCompleted: true },
      ]);
      try {
        if (!maskRef.current) maskRef.current = document.createElement('canvas');
        maskRef.current.width = source.width;
        maskRef.current.height = source.height;
        writeConfidenceMask(
          maskRef.current,
          maskResult.getAsFloat32Array(),
          maskResult.width,
          maskResult.height
        );
      } finally {
        maskResult.close();
      }
      if (generation !== generationRef.current) return;
      redraw();
      setHasResult(true);
      setIsRefining(false);
    } catch (err) {
      if (generation !== generationRef.current) return;
      console.error('Background removal failed', err);
      setError('Could not cut that subject out. Click directly on the product or person and try again.');
    } finally {
      if (generation === generationRef.current) setProcessing(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('Use an image under 20 MB.');
      return;
    }

    generationRef.current += 1;
    imageTokenRef.current += 1;
    const url = URL.createObjectURL(file);
    setError(null);
    setHasResult(false);
    setIsRefining(false);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });

    try {
      const image = await loadHtmlImage(url);
      sourceRef.current = scaleToCanvas(image);
      maskRef.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This browser could not read that image.');
      sourceRef.current = null;
    }
  };

  const reset = () => {
    generationRef.current += 1;
    sourceRef.current = null;
    maskRef.current = null;
    setHasResult(false);
    setIsRefining(false);
    setError(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadImage = () => {
    const preview = previewRef.current;
    if (!preview || !hasResult) return;
    const link = document.createElement('a');
    link.download = `khatario-cutout-${Date.now()}.png`;
    link.href = preview.toDataURL('image/png');
    link.click();
  };

  const subjectClick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (processing || !sourceRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    void cutOut({ x, y });
  };

  const stamp = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const mask = maskRef.current;
    const ctx = mask?.getContext('2d');
    if (!mask || !ctx) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSizeRef.current;
    ctx.strokeStyle = '#ffffff';
    ctx.globalCompositeOperation =
      brushModeRef.current === 'erase' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
    redraw();
  };

  const startBrush = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isRefining || !previewRef.current) return;
    const point = canvasPoint(previewRef.current, event);
    if (!point) return;
    drawingRef.current = true;
    lastPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    stamp(point, point);
  };

  const moveBrush = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !previewRef.current) return;
    const point = canvasPoint(previewRef.current, event);
    const last = lastPointRef.current;
    if (!point || !last) return;
    stamp(last, point);
    lastPointRef.current = point;
  };

  const stopBrush = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const checkerboard = {
    backgroundImage:
      'linear-gradient(45deg, #ece7df 25%, transparent 25%), linear-gradient(-45deg, #ece7df 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ece7df 75%), linear-gradient(-45deg, transparent 75%, #ece7df 75%)',
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <PageHeader
          title="Background remover"
          subtitle="Click a product or person. The cutout is made on this device."
        />
        {loadingModel && (
          <div className="flex items-center gap-2 self-start rounded-full border border-primary-100 bg-slate-50 px-3 py-2 text-sm text-primary-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            Downloading selection model
          </div>
        )}
        {modelReady && !loadingModel && (
          <div className="flex items-center gap-2 self-start rounded-full border border-success-100 bg-success-50 px-3 py-2 text-sm text-success-700">
            <span className="h-2 w-2 rounded-full bg-success-500" />
            Model ready
          </div>
        )}
      </div>

      {!previewUrl && (
        <Card padding="md">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            id="image-upload"
          />
          <label
            htmlFor="image-upload"
            className="group flex h-80 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100"
          >
            <div className="mb-4 rounded-full bg-white p-4 shadow-sm">
              <Upload className="h-10 w-10 text-primary-500" />
            </div>
            <div className="text-center">
              <div className="mb-2 text-xl font-bold text-gray-700">Upload a product or portrait</div>
              <div className="max-w-xs text-sm text-gray-500">
                JPG, PNG, or WebP under 20 MB. Click the subject after it opens.
              </div>
            </div>
          </label>
        </Card>
      )}

      {error && (
        <Card padding="md" className="border-red-200 bg-red-50">
          <div className="flex items-start gap-3 text-red-800">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-bold">Could not finish the cutout</div>
              <div className="text-sm">{error}</div>
            </div>
          </div>
        </Card>
      )}

      {previewUrl && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold uppercase tracking-widest text-text-secondary">
                Original
              </span>
              <button type="button" onClick={reset} className="text-sm text-red-600 hover:underline">
                Change image
              </button>
            </div>
            <Card padding="none" className="flex min-h-[280px] items-center justify-center overflow-hidden bg-gray-100">
              <img
                src={previewUrl}
                alt="Original"
                onClick={subjectClick}
                className="max-h-[450px] max-w-full cursor-crosshair object-contain"
              />
            </Card>
            <p className="px-1 text-xs text-text-secondary">
              Click the item you want to keep. Click again to choose a different one.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold uppercase tracking-widest text-text-secondary">
                Cutout
              </span>
              {hasResult && (
                <button
                  type="button"
                  onClick={downloadImage}
                  className="flex items-center gap-1 text-sm font-bold text-primary-600 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> Save PNG
                </button>
              )}
            </div>

            <Card padding="none" className="relative flex min-h-[280px] items-center justify-center overflow-hidden border-2 border-primary-50">
              {!hasResult && !processing && (
                <div className="p-8 text-center">
                  <Sparkles className="mx-auto mb-4 h-12 w-12 text-primary-200" />
                  <Button onClick={() => void cutOut({ x: 0.5, y: 0.5 })} disabled={processing}>
                    Cut out the center
                  </Button>
                  <p className="mt-3 text-sm text-text-secondary">Or click the subject on the original photo.</p>
                </div>
              )}

              {processing && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90">
                  <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary-500" />
                  <div className="font-bold text-primary-900">
                    {loadingModel ? 'Downloading the model…' : 'Finding the subject…'}
                  </div>
                </div>
              )}

              {hasResult && (
                <div className="flex w-full flex-col">
                  <div className="flex min-h-[280px] items-center justify-center" style={checkerboard}>
                    <canvas
                      ref={previewRef}
                      onPointerDown={startBrush}
                      onPointerMove={moveBrush}
                      onPointerUp={stopBrush}
                      onPointerCancel={stopBrush}
                      className={`h-auto max-h-[450px] w-auto max-w-full ${isRefining ? 'cursor-crosshair touch-none' : 'pointer-events-none'}`}
                    />
                  </div>

                  <div className="space-y-3 border-t bg-white p-3">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ['transparent', 'Transparent'],
                          ['white', 'White'],
                          ['custom', 'Color'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setBackdrop(value)}
                          className={`h-10 rounded-lg px-3 text-sm ${
                            backdrop === value
                              ? 'bg-primary-500 text-white'
                              : 'border border-gray-200 text-gray-700'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      {backdrop === 'custom' && (
                        <input
                          type="color"
                          value={customColor}
                          onChange={(event) => setCustomColor(event.target.value)}
                          aria-label="Background color"
                          className="h-10 w-14 cursor-pointer rounded-lg border border-gray-200 bg-white"
                        />
                      )}
                    </div>

                    {!isRefining ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setIsRefining(true)}
                        className="w-full"
                      >
                        <Eraser className="mr-2 h-4 w-4" /> Tidy the edge
                      </Button>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setBrushMode('erase')}
                            className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-sm ${
                              brushMode === 'erase' ? 'bg-primary-500 text-white' : 'border border-gray-200'
                            }`}
                          >
                            <Eraser className="h-4 w-4" /> Erase
                          </button>
                          <button
                            type="button"
                            onClick={() => setBrushMode('restore')}
                            className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-sm ${
                              brushMode === 'restore' ? 'bg-primary-500 text-white' : 'border border-gray-200'
                            }`}
                          >
                            <Paintbrush className="h-4 w-4" /> Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsRefining(false)}
                            className="h-10 rounded-lg border border-gray-200 px-3 text-sm"
                          >
                            Done
                          </button>
                        </div>
                        <label className="flex items-center gap-3 text-sm text-gray-600">
                          <span className="whitespace-nowrap">Size {brushSize}</span>
                          <input
                            type="range"
                            min={4}
                            max={80}
                            value={brushSize}
                            onChange={(event) => setBrushSize(Number(event.target.value))}
                            className="w-full accent-primary-500"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card padding="md" className="border-primary-100 bg-slate-100/50">
          <div className="flex items-start gap-3 text-sm text-primary-900">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
            <p>
              Click the product, person, or logo you want to keep. Erase removes leftover background.
              Restore paints the original pixels back.
            </p>
          </div>
        </Card>
        <Card padding="md" className="border-success-100 bg-success-50/50">
          <div className="flex items-start gap-3 text-sm text-success-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
            <p>
              The photo stays in this browser. The first cutout downloads a selection model of about 30 MB,
              then later photos reuse it.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
