'use client';

import React, { useEffect, useMemo } from 'react';
import { Check } from 'lucide-react';

const COLORS = [
  '#9b59b6', '#e74c3c', '#f39c12', '#2ecc71',
  '#3498db', '#e67e22', '#1abc9c', '#e91e63',
  '#ff5722', '#4caf50', '#2196f3', '#ff9800',
];

interface ConfettiPiece {
  id: number;
  color: string;
  left: number;       // %
  delay: number;      // s
  duration: number;   // s
  width: number;      // px
  height: number;     // px
  rotation: number;   // deg
}

function useConfetti(count = 48): ConfettiPiece[] {
  return useMemo(() => {
    // Use a seeded sequence so SSR and client match (no Math.random on first render)
    const pieces: ConfettiPiece[] = [];
    for (let i = 0; i < count; i++) {
      // Deterministic-enough spread using index
      const t = (i / count);
      const jitter = ((i * 7919) % 100) / 100; // pseudo-random from index
      pieces.push({
        id: i,
        color: COLORS[i % COLORS.length],
        left: (t * 100 + jitter * 8 - 4 + 2) % 100,
        delay: (jitter * 0.6),
        duration: 1.4 + jitter * 0.8,
        width: 6 + (i % 3) * 3,
        height: 8 + (i % 4) * 3,
        rotation: (i * 37) % 360,
      });
    }
    return pieces;
  }, [count]);
}

interface Props {
  elapsedMs: number;
  itemCount: number;
  onDismiss: () => void;
}

export function ScanSuccessScreen({ elapsedMs, itemCount, onDismiss }: Props) {
  const confetti = useConfetti();
  const seconds = (elapsedMs / 1000).toFixed(1);
  const minutesSaved = Math.max(2, Math.round(itemCount * 1.2));

  // Auto-dismiss after 2.8s
  useEffect(() => {
    const t = setTimeout(onDismiss, 2800);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-background"
      onClick={onDismiss}
    >
      {/* Confetti */}
      <div className="pointer-events-none absolute inset-0">
        {confetti.map(p => (
          <div
            key={p.id}
            className="animate-confetti-fall absolute"
            style={{
              left: `${p.left}%`,
              top: '-20px',
              width: p.width,
              height: p.height,
              backgroundColor: p.color,
              transform: `rotate(${p.rotation}deg)`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              borderRadius: p.id % 3 === 0 ? '50%' : '2px',
            }}
          />
        ))}
      </div>

      {/* Success checkmark */}
      <div className="animate-scan-success-pop mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-500 shadow-lg">
        <Check className="h-10 w-10 text-white" strokeWidth={3} />
      </div>

      {/* Text */}
      <div className="animate-scan-fade-up text-center" style={{ animationDelay: '0.15s', opacity: 0 }}>
        <p className="mb-1 text-2xl font-bold text-text-primary">
          Scanned in {seconds}s!
        </p>
        <p className="text-sm font-medium text-amber-600">
          ✨ We saved you ~{minutesSaved} mins of typing
        </p>
      </div>
    </div>
  );
}
