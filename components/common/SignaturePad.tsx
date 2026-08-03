'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

type SignaturePadProps = {
  onChange?: (dataUrl: string | null) => void;
  height?: number;
  className?: string;
};

export function SignaturePad({ onChange, height = 160, className }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const getPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const emitChange = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (empty) {
      onChange?.(null);
      return;
    }
    onChange?.(canvas.toDataURL('image/png'));
  }, [empty, onChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.offsetWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111';
  }, [height]);

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    canvas?.setPointerCapture(e.pointerId);
    const { x, y } = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (empty) setEmpty(false);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    emitChange();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange?.(null);
  };

  return (
    <div className={className}>
      <div className="rounded-lg border border-border bg-white">
        <canvas
          ref={canvasRef}
          className="w-full touch-none cursor-crosshair"
          style={{ height }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={clear}>
          Clear signature
        </Button>
      </div>
    </div>
  );
}
