'use client';

import Link from 'next/link';
import { ArrowRight, Camera, Check, MessageCircle, Sparkles } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

export type LandingAiToolsContent = {
  kicker: string;
  heading: string;
  intro: string;
  scanTitle: string;
  scanText: string;
  scanPoints: { text: string }[];
  askTitle: string;
  askText: string;
  askQuestions: { text: string }[];
  replyTitle: string;
  replyText: string;
};

export const LANDING_AI_TOOLS_DEFAULTS: LandingAiToolsContent = {
  kicker: 'Khatario AI',
  heading: 'Let AI do the typing and the counting',
  intro: 'Stop copying supplier bills by hand and digging through reports. Snap a photo or ask a question.',
  scanTitle: 'Snap a supplier bill. The purchase fills itself.',
  scanText:
    'Take a photo or upload the PDF of any supplier bill. Khatario reads it and opens the purchase entry already filled in, ready for you to check and save.',
  scanPoints: [
    { text: 'Supplier, GSTIN, bill number and date' },
    { text: 'Every item with HSN, quantity, rate and GST' },
    { text: 'CGST, SGST or IGST and the bill total' },
  ],
  askTitle: 'Ask your business anything',
  askText: 'Ask Khatario in the app or on WhatsApp, in plain words, and get the answer from your own books.',
  askQuestions: [
    { text: 'How was sale today?' },
    { text: 'Who owes me the most?' },
    { text: 'Low stock' },
    { text: 'Supplier bills due this week' },
    { text: 'GST alerts' },
  ],
  replyTitle: 'AI that replies to your customers',
  replyText: 'On Khatario Connect, AI answers price and stock questions on WhatsApp from your real item list, even at night.',
};

/** Paper bill → filled purchase form. Illustration with sample data. */
function ScanVisual() {
  return (
    <div className="relative mt-8 grid items-center justify-items-center gap-3 sm:grid-cols-[0.8fr_auto_1.2fr] sm:justify-items-stretch">
      <div className="w-full max-w-[14rem] rotate-[-4deg] rounded-lg border border-stone-200 bg-[#fffdf6] p-3 font-mono text-[10px] leading-relaxed text-stone-700 shadow-lg sm:max-w-none">
        <p className="text-center font-bold">SHIV TRADERS</p>
        <p className="text-center">GSTIN 27AAQFS…</p>
        <p className="mt-1 border-t border-dashed border-stone-300 pt-1">Bill 4471 · 28/10</p>
        <p>Atta 10kg x20 ...8,400</p>
        <p>Sugar 1kg x50 ...2,250</p>
        <p>Ghee 1L x12 ....7,440</p>
        <p className="border-t border-dashed border-stone-300 pt-1 font-bold">TOTAL ..18,994.50</p>
      </div>
      <span className="grid h-10 w-10 rotate-90 place-items-center rounded-full bg-accent-500 text-slate-950 shadow-lg sm:rotate-0">
        <Sparkles className="h-5 w-5" aria-hidden />
      </span>
      <div className="w-full rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">New purchase</p>
        <p className="mt-1 text-sm font-bold text-slate-900">Shiv Traders · Bill 4471</p>
        {[
          ['Atta 10kg', '20', '5%'],
          ['Sugar 1kg', '50', '5%'],
          ['Ghee 1L', '12', '5%'],
        ].map(([n, q, g]) => (
          <div key={n} className="mt-1.5 flex items-center justify-between rounded-md bg-emerald-50 px-2 py-1 text-[11px]">
            <span className="font-medium text-slate-900">{n}</span>
            <span className="text-slate-600">
              × {q} · GST {g}
            </span>
          </div>
        ))}
        <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
          <Check className="h-3.5 w-3.5" aria-hidden /> Filled from photo · check and save
        </p>
      </div>
    </div>
  );
}

export function LandingAiTools(props: Partial<LandingAiToolsContent> = {}) {
  const c = withDefaults(LANDING_AI_TOOLS_DEFAULTS, props);
  return (
    <section id="ai" className="relative scroll-mt-24 overflow-hidden bg-slate-950 py-20 text-white 2xl:py-28">
      <div className="landing-glow landing-glow-orange pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] opacity-60" aria-hidden />
      <div className="landing-glow landing-glow-green pointer-events-none absolute -bottom-48 -left-40 h-[34rem] w-[34rem] opacity-70" aria-hidden />
      <div className={`${LANDING_PAGE_GUTTER} relative`}>
        <LandingSectionHead kicker={c.kicker} heading={c.heading} intro={c.intro} light />

        <div className="mt-10 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <LandingReveal className="h-full">
            <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/[0.06] p-7 backdrop-blur">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-500 text-slate-950">
                <Camera className="h-6 w-6" aria-hidden />
              </span>
              <h3 className="mt-4 text-2xl font-bold">{c.scanTitle}</h3>
              <p className="mt-2 text-[16px] leading-relaxed text-slate-300">{c.scanText}</p>
              <ul className="mt-4 space-y-2">
                {c.scanPoints.map((p) => (
                  <li key={p.text} className="flex gap-2.5 text-[15px] text-slate-200">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent-400" aria-hidden />
                    {p.text}
                  </li>
                ))}
              </ul>
              <ScanVisual />
              <p className="mt-5 text-xs text-slate-400">Photo (JPG, PNG) or PDF, up to 10 MB</p>
              <p className="mt-4 flex gap-2.5 border-t border-white/10 pt-4 text-[15px] text-slate-200">
                <Camera className="mt-0.5 h-5 w-5 shrink-0 text-accent-400" aria-hidden />
                <span>
                  <strong className="text-white">New stock?</strong> Add items by photographing the pack: its name, MRP,
                  batch, expiry and pack size.
                </span>
              </p>
            </div>
          </LandingReveal>

          <div className="flex flex-col gap-5">
            <LandingReveal delay={80} className="flex-1">
              <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/[0.06] p-7 backdrop-blur">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-primary-600">
                  <Sparkles className="h-6 w-6" aria-hidden />
                </span>
                <h3 className="mt-4 text-2xl font-bold">{c.askTitle}</h3>
                <p className="mt-2 text-[16px] leading-relaxed text-slate-300">{c.askText}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {c.askQuestions.map((q) => (
                    <span key={q.text} className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm">
                      “{q.text}”
                    </span>
                  ))}
                </div>
                <div className="mt-5 rounded-2xl bg-white p-4 text-slate-900">
                  <p className="text-xs font-semibold text-slate-500">Ask Khatario · sample answer</p>
                  <p className="mt-1 text-sm">
                    Today: <strong>₹48,250</strong> from <strong>86 bills</strong>. ₹12,400 still to collect, 7 items low on
                    stock.
                  </p>
                </div>
              </div>
            </LandingReveal>
            <LandingReveal delay={140}>
              <Link
                href="/#whatsapp"
                className="group flex items-center gap-4 rounded-3xl border border-white/10 bg-emerald-500/15 p-6 transition hover:bg-emerald-500/25"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-500 text-white">
                  <MessageCircle className="h-6 w-6" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-bold">{c.replyTitle}</span>
                  <span className="block text-sm leading-relaxed text-slate-300">{c.replyText}</span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden />
              </Link>
            </LandingReveal>
          </div>
        </div>
      </div>
    </section>
  );
}
