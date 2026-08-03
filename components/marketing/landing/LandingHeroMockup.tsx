'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { LandingCrossfade } from '@/components/marketing/landing/LandingCrossfade';
import type { ProductLine } from '@/lib/product-lines';

type Phase = 0 | 1 | 2 | 3 | 4;

const PHASE_MS = [400, 500, 500, 600, 400] as const;

function MockupChrome({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
      </div>
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <div className="w-8" />
    </div>
  );
}

function BillingMockupBody({ phase }: { phase: Phase }) {
  return (
    <div className="space-y-4 p-5 sm:p-6 2xl:p-8 2xl:space-y-5">
      <div
        className={clsx(
          'transition-all duration-500',
          phase >= 0 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        )}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</p>
        <p className="text-lg font-semibold text-slate-900 2xl:text-xl">Sharma & Sons</p>
        <p className="text-sm text-slate-500 2xl:text-base">+91 98xxx xxxxx · Local · GST 09ABCDE1FGH2J5</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50/80">
        <div className="grid grid-cols-12 gap-x-1 gap-y-1 border-b border-slate-200 px-2 py-2 text-[11px] font-medium leading-tight text-slate-500 sm:gap-x-2 sm:px-3 sm:text-xs">
          <span className="col-span-4">Item</span>
          <span className="col-span-2 text-center">HSN</span>
          <span className="col-span-2 text-right">GST%</span>
          <span className="col-span-1 text-right">Qty</span>
          <span className="col-span-3 text-right">Amount</span>
        </div>
        <div className="divide-y divide-slate-100">
          <div
            className={clsx(
              'grid grid-cols-12 items-center gap-x-1 px-2 py-2 text-[13px] sm:gap-x-2 sm:px-3 sm:text-sm transition-all duration-500',
              phase >= 1 ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0',
            )}
          >
            <span className="col-span-4 min-w-0 truncate text-slate-800">Basmathi rice 5kg</span>
            <span className="col-span-2 text-center tabular-nums text-slate-600">10063030</span>
            <span className="col-span-2 text-right tabular-nums text-slate-600">5%</span>
            <span className="col-span-1 text-right tabular-nums text-slate-600">2</span>
            <span className="col-span-3 text-right font-medium tabular-nums text-slate-900">₹1,180</span>
          </div>
          <div
            className={clsx(
              'grid grid-cols-12 items-center gap-x-1 px-2 py-2 text-[13px] sm:gap-x-2 sm:px-3 sm:text-sm transition-all duration-500 delay-75',
              phase >= 2 ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0',
            )}
          >
            <span className="col-span-4 min-w-0 truncate text-slate-800">Groundnut oil 1L</span>
            <span className="col-span-2 text-center tabular-nums text-slate-600">15179090</span>
            <span className="col-span-2 text-right tabular-nums text-slate-600">18%</span>
            <span className="col-span-1 text-right tabular-nums text-slate-600">1</span>
            <span className="col-span-3 text-right font-medium tabular-nums text-slate-900">₹185</span>
          </div>
        </div>
        <div
          className={clsx(
            'space-y-1.5 border-t border-slate-200 bg-white px-3 py-3 text-sm transition-all duration-500',
            phase >= 3 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
          )}
        >
          <div className="flex justify-between text-slate-600">
            <span>Taxable value</span>
            <span className="tabular-nums">₹1,280.59</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>CGST + SGST</span>
            <span className="tabular-nums">₹84.41</span>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold text-slate-900">
            <span>Total</span>
            <span className="tabular-nums landing-mockup-total-pop">₹1,365</span>
          </div>
        </div>
      </div>
      <div
        className={clsx(
          'flex flex-wrap gap-2 transition-all duration-500',
          phase >= 4 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        )}
      >
        <span className="landing-mockup-badge-pop inline-flex items-center gap-1 rounded-md bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-200">
          Bill ready
        </span>
        <span
          className="landing-mockup-badge-pop inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
          style={{ animationDelay: '120ms' }}
        >
          WhatsApp share
        </span>
        <span
          className="landing-mockup-badge-pop inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200"
          style={{ animationDelay: '220ms' }}
        >
          Print · 80mm
        </span>
      </div>
    </div>
  );
}

function HrMockupBody({ phase }: { phase: Phase }) {
  const rows = [
    { name: 'Ravi K.', role: 'Counter staff', status: 'Present', time: '9:02 AM' },
    { name: 'Meena S.', role: 'Store manager', status: 'Present', time: '8:55 AM' },
    { name: 'Arjun P.', role: 'Delivery', status: 'On leave', time: '—' },
  ];

  return (
    <div className="space-y-4 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Today</p>
          <p className="text-lg font-semibold text-slate-900">Attendance · Main branch</p>
        </div>
        <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800 ring-1 ring-green-200">
          2 / 3 in
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div
            key={row.name}
            className={clsx(
              'flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-all duration-500',
              phase >= i + 1 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
            )}
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">{row.name}</p>
              <p className="text-xs text-slate-500">{row.role}</p>
            </div>
            <div className="text-right">
              <p
                className={clsx(
                  'text-xs font-semibold',
                  row.status === 'Present' ? 'text-green-700' : 'text-amber-700',
                )}
              >
                {row.status}
              </p>
              <p className="text-xs tabular-nums text-slate-500">{row.time}</p>
            </div>
          </div>
        ))}
      </div>
      <div
        className={clsx(
          'rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 transition-all duration-500',
          phase >= 3 ? 'opacity-100' : 'opacity-0',
        )}
      >
        <p className="text-xs font-medium text-slate-500">Payroll preview · March</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">₹1,42,500</p>
      </div>
    </div>
  );
}

function ConnectMockupBody({ phase }: { phase: Phase }) {
  const messages = [
    { from: 'customer', text: 'Bhai, kal wala bill bhej do' },
    { from: 'you', text: 'Invoice #1042 · ₹1,365 · PDF attached' },
    { from: 'customer', text: 'Payment kar diya UPI se' },
    { from: 'you', text: 'Received ✓ Marked paid in Khatario' },
  ];

  return (
    <div className="space-y-3 bg-[#e5ddd5] p-4 sm:p-5">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={clsx(
            'flex transition-all duration-500',
            msg.from === 'you' ? 'justify-end' : 'justify-start',
            phase >= Math.min(i, 4) ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
          )}
        >
          <div
            className={clsx(
              'max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm',
              msg.from === 'you'
                ? 'rounded-tr-none bg-[#d9fdd3] text-slate-900'
                : 'rounded-tl-none bg-white text-slate-800',
            )}
          >
            {msg.text}
          </div>
        </div>
      ))}
      <div
        className={clsx(
          'flex justify-end transition-all duration-500',
          phase >= 4 ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="rounded-md bg-white/90 px-2 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
          Bot rule · auto-reply enabled
        </span>
      </div>
    </div>
  );
}

const MOCKUP_META: Record<
  ProductLine,
  { title: string; Body: typeof BillingMockupBody }
> = {
  billing: { title: 'Khatario · New sale', Body: BillingMockupBody },
  hr: { title: 'Khatario · HR', Body: HrMockupBody },
  connect: { title: 'Khatario · WhatsApp', Body: ConnectMockupBody },
};

function LandingHeroMockupPanel({ productLine }: { productLine: ProductLine }) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>(reduced ? 4 : 0);
  const { title, Body } = MOCKUP_META[productLine];

  useEffect(() => {
    if (reduced) {
      setPhase(4);
      return;
    }

    setPhase(0);
    let cancelled = false;
    let timeoutId = 0;
    let current = 0;

    const advance = () => {
      if (cancelled) return;
      if (current >= 4) {
        timeoutId = window.setTimeout(() => {
          current = 0;
          setPhase(0);
          advance();
        }, 2400);
        return;
      }
      current += 1;
      setPhase(current as Phase);
      timeoutId = window.setTimeout(advance, PHASE_MS[current] ?? 500);
    };

    timeoutId = window.setTimeout(advance, PHASE_MS[0]);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [productLine, reduced]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl landing-hero-mockup-float">
      <MockupChrome title={title} />
      <Body phase={phase} />
    </div>
  );
}

export function LandingHeroMockup({ productLine }: { productLine: ProductLine }) {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none 2xl:min-w-0">
      <div
        className="absolute -inset-3 rounded-3xl bg-slate-200/40 blur-2xl landing-hero-glow"
        aria-hidden
      />
      <LandingCrossfade
        contentKey={productLine}
        className="relative min-h-[22rem] sm:min-h-[24rem]"
      >
        {(line) => <LandingHeroMockupPanel productLine={line} />}
      </LandingCrossfade>
    </div>
  );
}
