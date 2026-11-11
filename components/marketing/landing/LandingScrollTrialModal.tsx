'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, CheckCircle2, IndianRupee, MapPin, MessageCircle, Wifi, X } from 'lucide-react';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { SIGNUP_PHONE_STORAGE_KEY } from '@/lib/signup-prefill';
import type { ProductLine } from '@/lib/product-lines';

/** Once the modal has been shown this browser session, do not show again (survives refresh). */
const SESSION_FIRED_KEY = 'khatario_landing_trial_modal_fired';
/** Visitors who leave within this window were never going to read a pitch. */
const MIN_DWELL_MS = 20_000;
const MIN_SCROLL_PROGRESS = 0.25;

const COPY: Record<ProductLine, { kicker: string; title: string; points: string[]; cta: string }> = {
  billing: {
    kicker: 'Before you go',
    title: 'Make your next bill on Khatario. Free.',
    points: ['Unlimited GST bills on the Free plan', 'Send bills on WhatsApp from your own number', 'Works on your phone and your computer'],
    cta: 'Start free',
  },
  hr: {
    kicker: 'Before you go',
    title: 'Try attendance and payroll free for 30 days',
    points: ['Phone check-in with fake GPS blocked', 'Salary worked out from attendance', 'No card needed to begin'],
    cta: 'Start HR trial',
  },
  connect: {
    kicker: 'Before you go',
    title: 'Bring your customers back on WhatsApp',
    points: ['Your own Meta account on the official API', 'You pay Meta directly, we add no markup', 'Shared inbox and AI replies for your team'],
    cta: 'Create Connect account',
  },
};

/* Left-hand illustrations, one per product (sample data). */

function BillingVisual() {
  return (
    <div className="relative w-full max-w-[15rem]">
      <div className="rotate-[-3deg] rounded-xl bg-white p-4 text-slate-900 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Tax invoice</p>
            <p className="text-sm font-bold">INV-1042</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">GST ✓</span>
        </div>
        {[
          ['Basmati Rice 5kg', '1,180'],
          ['Toor Dal 1kg', '330'],
          ['Sunflower Oil 1L', '290'],
        ].map(([n, a]) => (
          <div key={n} className="mt-2 flex justify-between border-b border-slate-100 pb-1.5 text-[11px]">
            <span>{n}</span>
            <span className="font-semibold">₹{a}</span>
          </div>
        ))}
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-[11px] text-slate-500">Total</span>
          <span className="text-lg font-extrabold text-primary-600">₹1,800</span>
        </div>
      </div>
      <div className="absolute -right-6 -top-4 flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-900 shadow-xl">
        <MessageCircle className="h-4 w-4 text-emerald-600" aria-hidden /> Sent on WhatsApp
      </div>
      <div className="absolute -bottom-5 -left-5 flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-900 shadow-xl">
        <IndianRupee className="h-4 w-4 text-accent-600" aria-hidden /> ₹1,800 paid by UPI
      </div>
    </div>
  );
}

function HrVisual() {
  return (
    <div className="w-full max-w-[13rem] rounded-[1.6rem] bg-slate-900 p-2 shadow-2xl">
      <div className="flex flex-col items-center gap-1.5 rounded-[1.3rem] bg-white px-4 py-5 text-center">
        <p className="text-[10px] text-slate-500">FC Road shop</p>
        <p className="text-2xl font-extrabold text-primary-600">9:02 AM</p>
        <CheckCircle2 className="my-1 h-12 w-12 text-emerald-600" aria-hidden />
        <p className="text-sm font-bold text-slate-900">Checked in</p>
        <p className="flex items-center gap-1 text-[11px] text-emerald-800">
          <MapPin className="h-3.5 w-3.5" aria-hidden /> At the shop
        </p>
        <p className="flex items-center gap-1 text-[11px] text-emerald-800">
          <Wifi className="h-3.5 w-3.5" aria-hidden /> Shop Wi-Fi seen
        </p>
      </div>
    </div>
  );
}

function ConnectVisual() {
  return (
    <div className="flex w-full max-w-[15rem] flex-col gap-2 rounded-2xl bg-[#efeae2] p-3 text-[12px] text-slate-900 shadow-2xl">
      <p className="self-start rounded-lg bg-white px-3 py-2">Is the 5kg basmati in stock?</p>
      <p className="self-end rounded-lg bg-[#d9fdd3] px-3 py-2">
        Yes ji, 46 packs at ₹590. Shall I add it?
        <span className="mt-0.5 block text-[9px] font-bold text-emerald-800">AI REPLY</span>
      </p>
      <p className="self-start rounded-lg bg-white px-3 py-2">Haan, 2 bhej do 🙏</p>
    </div>
  );
}

/**
 * Exit-intent trial prompt: desktop pointer only (phones already have the sticky CTA), fired when the
 * cursor leaves through the top of the window, once per session, and never while pricing is on screen.
 */
export function LandingScrollTrialModal() {
  const router = useRouter();
  const { productLine, signupHref } = useLandingProduct();
  const copy = COPY[productLine];
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const openedRef = useRef(false);
  const maxProgressRef = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (sessionStorage.getItem(SESSION_FIRED_KEY) === '1') return;

    const startedAt = Date.now();

    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable > 0) {
        maxProgressRef.current = Math.max(maxProgressRef.current, window.scrollY / scrollable);
      }
    };

    const pricingVisible = () => {
      const rect = document.getElementById('pricing')?.getBoundingClientRect();
      return !!rect && rect.top < window.innerHeight && rect.bottom > 0;
    };

    const onMouseOut = (e: MouseEvent) => {
      if (openedRef.current || e.relatedTarget || e.clientY > 0) return;
      if (Date.now() - startedAt < MIN_DWELL_MS) return;
      if (maxProgressRef.current < MIN_SCROLL_PROGRESS) return;
      if (pricingVisible()) return;
      openedRef.current = true;
      sessionStorage.setItem(SESSION_FIRED_KEY, '1');
      setOpen(true);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('mouseout', onMouseOut);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('mouseout', onMouseOut);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '').slice(-10);
    try {
      if (digits.length === 10) sessionStorage.setItem(SIGNUP_PHONE_STORAGE_KEY, digits);
    } catch {
      // Storage blocked: sign-up simply starts with an empty number.
    }
    close();
    router.push(signupHref);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div
        className="animate-marketing-nav-backdrop-in absolute inset-0 bg-slate-950/60 backdrop-blur-md"
        onClick={close}
        role="presentation"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="landing-trial-modal-title"
        className="animate-marketing-menu-in relative grid w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/30 md:grid-cols-[0.9fr_1.1fr]"
      >
        <div className="relative hidden items-center justify-center overflow-hidden bg-primary-600 p-10 md:flex">
          <div className="landing-glow landing-glow-orange pointer-events-none absolute -bottom-24 -left-24 h-72 w-72" aria-hidden />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]"
            aria-hidden
          />
          <div className="relative flex w-full justify-center">
            {productLine === 'hr' ? <HrVisual /> : productLine === 'connect' ? <ConnectVisual /> : <BillingVisual />}
          </div>
        </div>

        <div className="relative p-7 sm:p-9">
          <button
            type="button"
            onClick={close}
            className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>

          <p className="landing-kicker">{copy.kicker}</p>
          <h2
            id="landing-trial-modal-title"
            className="mt-3 pr-8 text-2xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[1.75rem]"
          >
            {copy.title}
          </h2>
          <ul className="mt-5 space-y-2.5">
            {copy.points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[15px] text-slate-700">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                </span>
                {p}
              </li>
            ))}
          </ul>

          <form onSubmit={onSubmit} className="mt-6 space-y-2.5">
            <label htmlFor="trial-modal-phone" className="sr-only">
              Mobile number
            </label>
            <div className="flex min-h-[3.25rem] items-center gap-2 rounded-xl border border-slate-300 px-4 focus-within:border-primary-600 focus-within:ring-2 focus-within:ring-primary-600/20">
              <span className="font-semibold text-slate-500">+91</span>
              <input
                id="trial-modal-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={14}
                placeholder="Your mobile number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
            <button
              type="submit"
              className="group inline-flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-6 text-base font-semibold text-slate-950 shadow-md transition hover:bg-accent-400 hover:shadow-lg"
            >
              {copy.cta}
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <button
              type="button"
              onClick={() => {
                close();
                router.push('/book-demo');
              }}
              className="font-semibold text-primary-600 underline-offset-4 hover:underline"
            >
              Rather see a demo first?
            </button>
            <button type="button" onClick={close} className="font-medium text-slate-500 hover:text-slate-800">
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
