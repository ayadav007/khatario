'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Check, IndianRupee, Send, TrendingUp } from 'lucide-react';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { LandingCrossfade } from '@/components/marketing/landing/LandingCrossfade';
import { sleep, useAnimatedNumber } from '@/components/marketing/landing/LandingMotion';
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

type BillLine = { name: string; hsn: string; qty: number; price: number; gst: number };

const BILL_LINES: BillLine[] = [
  { name: 'Basmati Rice 5kg', hsn: '1006302', qty: 4, price: 590, gst: 5 },
  { name: 'Toor Dal 1kg', hsn: '0713600', qty: 10, price: 165, gst: 5 },
  { name: 'Sunflower Oil 1L', hsn: '1512191', qty: 6, price: 145, gst: 5 },
  { name: 'Detergent Powder 1kg', hsn: '3402209', qty: 5, price: 165, gst: 18 },
];

const lineTotal = (l: BillLine) => l.qty * l.price * (1 + l.gst / 100);
const money = (n: number, decimals = 2) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** 0 = empty, 1–4 = lines typed in, 5 = sent on WhatsApp, 6 = added to GSTR-1, 7 = paid. */
const LAST_STAGE = 7;
const STAGE_MS = [700, 1000, 1000, 1000, 900, 1300, 1300, 4200] as const;

function useBillStage(reduced: boolean): number {
  const [stage, setStage] = useState(reduced ? LAST_STAGE : 0);
  useEffect(() => {
    if (reduced) {
      setStage(LAST_STAGE);
      return;
    }
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        for (let i = 0; i <= LAST_STAGE && !cancelled; i += 1) {
          setStage(i);
          await sleep(STAGE_MS[i]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reduced]);
  return stage;
}

function Chip({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-500',
        on ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500',
      )}
    >
      {children}
    </span>
  );
}

const BILL_GRID =
  'grid grid-cols-[minmax(0,1fr)_2.5rem_5.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_2.5rem_2.75rem_5.5rem] 2xl:grid-cols-[minmax(0,1fr)_4.5rem_2.5rem_2.75rem_5.5rem]';

function BillingMockupBody({ stage }: { stage: number }) {
  const typed = BILL_LINES.slice(0, Math.min(stage, BILL_LINES.length));
  const typing = stage >= 1 && stage <= BILL_LINES.length;
  const taxable = typed.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = typed.reduce((s, l) => s + (l.qty * l.price * l.gst) / 100, 0);
  const shownTaxable = useAnimatedNumber(taxable, 600);
  const shownTax = useAnimatedNumber(tax, 600);

  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Customer</p>
          <p className="text-lg font-bold text-slate-900">Sharma &amp; Sons</p>
          <p className="text-xs text-slate-500">FC Road, Pune · GSTIN 27ABCDE1234F1Z5</p>
        </div>
        <p className="text-right text-xs text-slate-500">
          <span className="block text-sm font-bold text-slate-900">INV-0142</span>
          15 Oct 2026
        </p>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 text-[13px] sm:text-sm">
        <div className={`${BILL_GRID} bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400`}>
          <span>Item</span>
          <span className="hidden 2xl:block">HSN</span>
          <span className="text-right">Qty</span>
          <span className="hidden text-right sm:block">GST</span>
          <span className="text-right">Amount</span>
        </div>
        <div className="min-h-[9.5rem]">
          {typed.map((l, i) => {
            const current = typing && i === typed.length - 1;
            return (
              <div
                key={l.name}
                className={clsx(
                  `${BILL_GRID} landing-bill-line items-center border-t border-slate-100 px-3 py-2 tabular-nums transition-colors duration-700`,
                  current && 'bg-accent-50',
                )}
              >
                <span className={clsx('truncate text-slate-800', current && 'landing-caret')}>{l.name}</span>
                <span className="hidden text-xs text-slate-500 2xl:block">{l.hsn}</span>
                <span className="text-right text-slate-600">{l.qty}</span>
                <span className="hidden text-right text-slate-600 sm:block">{l.gst}%</span>
                <span className="text-right font-medium text-slate-900">{money(lineTotal(l))}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 items-end gap-4">
        <div className="flex flex-wrap gap-1.5">
          <Chip on={stage >= BILL_LINES.length}>GST checked</Chip>
          <Chip on={stage >= 6}>Print · 80mm</Chip>
          <Chip on={stage >= 5}>WhatsApp</Chip>
        </div>
        <div className="text-sm tabular-nums">
          <div className="flex justify-between text-slate-500">
            <span>Taxable</span>
            <span>₹{money(shownTaxable)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>CGST + SGST</span>
            <span>₹{money(shownTax)}</span>
          </div>
          <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1.5 text-lg font-extrabold text-slate-900">
            <span>Total</span>
            <span>₹{money(shownTaxable + shownTax, 0)}</span>
          </div>
          <div
            className={clsx(
              'mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-bold text-white transition duration-200',
              stage === 5 && 'scale-95 ring-4 ring-primary-600/20',
            )}
          >
            <Send className="h-4 w-4" aria-hidden />
            Save &amp; Send
          </div>
        </div>
      </div>
    </div>
  );
}

function FloatCard({
  show,
  className,
  icon,
  tone,
  title,
  sub,
}: {
  show: boolean;
  className: string;
  icon: ReactNode;
  tone: string;
  title: string;
  sub: string;
}) {
  return (
    <div
      aria-hidden={!show}
      className={clsx(
        'absolute z-10 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-xl shadow-primary-900/15 transition-all duration-500 ease-out motion-reduce:transition-none',
        show ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-3 scale-95 opacity-0',
        className,
      )}
    >
      <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', tone)}>{icon}</span>
      <span>
        <span className="block text-sm font-bold text-slate-900">{title}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
    </div>
  );
}

function BillingLiveBill() {
  const reduced = usePrefersReducedMotion();
  const stage = useBillStage(reduced);
  return (
    <div className="relative py-4 sm:px-4">
      <div className="landing-hero-tilt relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-primary-900/20">
        <MockupChrome title="Khatario · New sale" />
        <BillingMockupBody stage={stage} />
      </div>
      <FloatCard
        show={stage >= 5}
        className="-bottom-2 left-0 sm:-left-6"
        tone="bg-green-100 text-green-600"
        icon={<Check className="h-5 w-5" strokeWidth={2.6} aria-hidden />}
        title="Sent on WhatsApp"
        sub="PDF + UPI link to +91 98xxx 41230"
      />
      <FloatCard
        show={stage >= 6}
        className="bottom-36 right-0 hidden sm:-right-6 sm:flex"
        tone="bg-primary-50 text-primary-600"
        icon={<TrendingUp className="h-5 w-5" aria-hidden />}
        title="Added to GSTR-1"
        sub="October · B2B"
      />
      <FloatCard
        show={stage >= 7}
        className="-top-2 right-0 sm:-right-4"
        tone="bg-accent-100 text-accent-600"
        icon={<IndianRupee className="h-5 w-5" aria-hidden />}
        title="₹6,098 received"
        sub="UPI · matched to INV-0142"
      />
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

const MOCKUP_META: Record<Exclude<ProductLine, 'billing'>, { title: string; Body: typeof HrMockupBody }> = {
  hr: { title: 'Khatario · HR', Body: HrMockupBody },
  connect: { title: 'Khatario · WhatsApp', Body: ConnectMockupBody },
};

function PhasedMockupPanel({ productLine }: { productLine: Exclude<ProductLine, 'billing'> }) {
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
      if (cancelled || current >= 4) return;
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

function LandingHeroMockupPanel({ productLine }: { productLine: ProductLine }) {
  if (productLine === 'billing') return <BillingLiveBill />;
  return <PhasedMockupPanel productLine={productLine} />;
}

export function LandingHeroMockup({ productLine }: { productLine: ProductLine }) {
  return (
    <div className="relative mx-auto w-full max-w-xl lg:max-w-none 2xl:min-w-0">
      <LandingCrossfade contentKey={productLine} className="relative min-h-[22rem] sm:min-h-[24rem]">
        {(line) => <LandingHeroMockupPanel productLine={line} />}
      </LandingCrossfade>
    </div>
  );
}
