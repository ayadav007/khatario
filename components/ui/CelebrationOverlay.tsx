'use client';

import { useEffect, useRef, useState } from 'react';

interface CelebrationOverlayProps {
  planName: string;
  onComplete: () => void;
  duration?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  type: 'confetti' | 'spark';
  life: number;
  maxLife: number;
}

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F1948A', '#82E0AA', '#F8C471', '#AED6F1', '#D7BDE2',
];

export function CelebrationOverlay({ planName, onComplete, duration = 3500 }: CelebrationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function randomColor() {
      return COLORS[Math.floor(Math.random() * COLORS.length)];
    }

    function spawnConfetti(count: number) {
      const w = canvas!.width;
      for (let i = 0; i < count; i++) {
        particlesRef.current.push({
          x: Math.random() * w,
          y: -20 - Math.random() * 200,
          vx: (Math.random() - 0.5) * 4,
          vy: Math.random() * 3 + 2,
          color: randomColor(),
          size: Math.random() * 8 + 4,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.15,
          opacity: 1,
          type: 'confetti',
          life: 0,
          maxLife: 300,
        });
      }
    }

    function spawnFirework(cx: number, cy: number) {
      const sparkCount = 30 + Math.floor(Math.random() * 20);
      const color = randomColor();
      for (let i = 0; i < sparkCount; i++) {
        const angle = (Math.PI * 2 * i) / sparkCount + (Math.random() - 0.5) * 0.3;
        const speed = Math.random() * 5 + 2;
        particlesRef.current.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: Math.random() * 3 + 1.5,
          rotation: 0,
          rotationSpeed: 0,
          opacity: 1,
          type: 'spark',
          life: 0,
          maxLife: 60 + Math.random() * 40,
        });
      }
    }

    // Initial burst
    spawnConfetti(120);
    const w = canvas.width;
    const h = canvas.height;
    spawnFirework(w * 0.2, h * 0.3);
    spawnFirework(w * 0.8, h * 0.25);

    // Staggered bursts
    const t1 = setTimeout(() => {
      spawnConfetti(60);
      spawnFirework(w * 0.5, h * 0.2);
    }, 400);
    const t2 = setTimeout(() => {
      spawnFirework(w * 0.3, h * 0.35);
      spawnFirework(w * 0.7, h * 0.3);
    }, 900);
    const t3 = setTimeout(() => {
      spawnConfetti(40);
    }, 1400);

    function animate() {
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      const particles = particlesRef.current;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        p.x += p.vx;
        p.y += p.vy;

        if (p.type === 'confetti') {
          p.vy += 0.04; // gravity
          p.vx *= 0.999;
          p.rotation += p.rotationSpeed;
          p.opacity = Math.max(0, 1 - p.life / p.maxLife);

          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        } else {
          p.vy += 0.06;
          p.vx *= 0.97;
          p.vy *= 0.97;
          const progress = p.life / p.maxLife;
          p.opacity = Math.max(0, 1 - progress * progress);

          ctx.save();
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - progress * 0.5), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        if (p.life >= p.maxLife || p.y > canvas!.height + 50) {
          particles.splice(i, 1);
        }
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);

    const fadeTimer = setTimeout(() => setFadeOut(true), duration - 600);
    const endTimer = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, duration);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animFrameRef.current);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(fadeTimer);
      clearTimeout(endTimer);
    };
  }, [duration, onComplete]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ pointerEvents: 'none' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      <div
        className="relative z-10 text-center animate-celebration-enter"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-10 py-8 border border-white/50 max-w-sm mx-auto">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">
            Congratulations!
          </h2>
          <p className="text-gray-600 text-sm mb-3">
            You've been upgraded to
          </p>
          <div className="inline-block bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-lg font-bold px-6 py-2 rounded-full shadow-lg">
            {planName}
          </div>
          <p className="text-gray-500 text-xs mt-3">
            All premium features are now unlocked
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes celebration-enter {
          0% {
            opacity: 0;
            transform: scale(0.7) translateY(20px);
          }
          50% {
            transform: scale(1.05) translateY(-5px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .animate-celebration-enter {
          animation: celebration-enter 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
