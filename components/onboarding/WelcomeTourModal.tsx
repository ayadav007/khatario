'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type WelcomeTourModalProps = {
  userName?: string | null;
  onShowAround: () => void;
  onDismiss: () => void;
  /** Optional: opens Settings → Business Profile with a field-by-field guided tour */
  onTourBusinessProfile?: () => void;
};

/** Decorative “confetti” accents — CSS only, no assets */
function WelcomeConfettiBand() {
  const dots = [
    { l: '12%', t: '30%', s: 'w-2 h-2', c: 'bg-pink-400/90' },
    { l: '22%', t: '55%', s: 'w-1.5 h-1.5', c: 'bg-amber-400/90' },
    { l: '38%', t: '22%', s: 'w-2.5 h-2.5', c: 'bg-sky-400/90' },
    { l: '55%', t: '60%', s: 'w-1.5 h-1.5', c: 'bg-emerald-400/90' },
    { l: '68%', t: '28%', s: 'w-2 h-2', c: 'bg-violet-400/90' },
    { l: '78%', t: '48%', s: 'w-2 h-2', c: 'bg-cyan-400/90' },
    { l: '88%', t: '35%', s: 'w-1.5 h-1.5', c: 'bg-orange-400/90' },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-t-[inherit]">
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `radial-gradient(circle at 10% 20%, rgba(244, 114, 182, 0.45) 0, transparent 35%),
            radial-gradient(circle at 90% 30%, rgba(56, 189, 248, 0.35) 0, transparent 38%),
            radial-gradient(circle at 50% 80%, rgba(52, 211, 153, 0.3) 0, transparent 40%)`,
        }}
      />
      {dots.map((d, i) => (
        <span
          key={i}
          className={`absolute ${d.s} ${d.c} rounded-full shadow-sm opacity-90 blur-[0.3px]`}
          style={{ left: d.l, top: d.t }}
        />
      ))}
    </div>
  );
}

export function WelcomeTourModal({ userName, onShowAround, onDismiss, onTourBusinessProfile }: WelcomeTourModalProps) {
  const first = userName?.trim().split(/\s+/)[0];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-tour-welcome-title"
    >
      {/* Warm, soft backdrop */}
      <button
        type="button"
        aria-label="Close welcome"
        className="product-tour-backdrop-in absolute inset-0 bg-gradient-to-br from-primary-900/55 via-indigo-950/40 to-teal-900/35 backdrop-blur-[2px]"
        onClick={onDismiss}
      />

      <div className="product-tour-modal-in relative w-full max-w-[440px]">
        <div className="overflow-hidden rounded-3xl border border-white/60 bg-white shadow-[0_32px_64px_-16px_rgba(30,41,59,0.28),0_0_0_1px_rgba(255,255,255,0.9)_inset]">
          {/* Header band */}
          <div className="relative h-32 overflow-hidden bg-gradient-to-br from-amber-50 via-sky-50 to-teal-50">
            <div className="absolute inset-0 bg-gradient-to-t from-white/40 to-transparent" />
            <WelcomeConfettiBand />
            <div className="relative flex h-full items-end justify-center pb-2">
              <div className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-primary-700 shadow-sm ring-1 ring-primary-100">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                Quick tour
              </div>
            </div>
          </div>

          {/* Avatar overlaps header */}
          <div className="relative -mt-11 flex flex-col items-center px-8 pb-8 pt-0 text-center">
            <div
              className="ring-4 ring-white shadow-xl shadow-primary-900/10"
              style={{ borderRadius: '1.25rem' }}
            >
              <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-primary-500 via-primary-600 to-accent-500 text-3xl font-bold tracking-tight text-white">
                {(userName || '?').trim().charAt(0).toUpperCase()}
              </div>
            </div>

            <h2
              id="product-tour-welcome-title"
              className="mt-5 text-2xl font-bold tracking-tight text-text-primary sm:text-[1.65rem]"
            >
              Welcome aboard
              {first ? (
                <>
                  ,{' '}
                  <span className="bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">
                    {first}
                  </span>
                </>
              ) : null}
              !
            </h2>
            <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-text-secondary">
              We&apos;re glad you&apos;re here. Take a short guided walk through the sidebar — or jump in and
              explore whenever you&apos;re ready.
            </p>

            <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
              <Button
                type="button"
                size="lg"
                className="w-full rounded-full !py-3 text-base font-semibold shadow-lg shadow-primary-500/25 transition hover:shadow-xl hover:shadow-primary-500/30"
                onClick={onShowAround}
              >
                Show me around
              </Button>
              <button
                type="button"
                className="text-sm font-medium text-text-secondary underline decoration-border underline-offset-4 transition hover:text-primary-600 hover:decoration-primary-300"
                onClick={onDismiss}
              >
                No thanks — I&apos;ll explore on my own
              </button>
              {onTourBusinessProfile ? (
                <button
                  type="button"
                  className="text-sm font-medium text-primary-600 underline decoration-primary-200 underline-offset-4 transition hover:text-primary-700 hover:decoration-primary-400"
                  onClick={onTourBusinessProfile}
                >
                  Tour business profile settings (what each field does)
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
