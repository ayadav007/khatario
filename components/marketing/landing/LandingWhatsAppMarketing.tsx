'use client';

import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

export type LandingWhatsAppMarketingContent = {
  kicker: string;
  heading: string;
  intro: string;
  cards: { tier: string; title: string; text: string }[];
  ctaLabel: string;
  ctaHref: string;
  markupTitle: string;
  markupText: string;
  markupNote: string;
};

export const LANDING_WHATSAPP_MARKETING_DEFAULTS: LandingWhatsAppMarketingContent = {
  kicker: 'WhatsApp marketing',
  heading: 'Bring customers back on the app they already use',
  intro:
    'Send bills and reminders free from your own number. When you want more, Khatario Connect runs offers, a team inbox and AI replies on the official WhatsApp Business API.',
  cards: [
    { tier: 'Free with Billing', title: 'Bills & reminders', text: 'Link your number with a QR code. Bills, statements and polite payment reminders go out by themselves.' },
    { tier: 'Khatario Connect', title: 'Offers & campaigns', text: 'Festival offers to the right customers with approved templates, sent from your own Meta account.' },
    { tier: 'Khatario Connect', title: 'Shared inbox', text: 'One WhatsApp number, many staff replying. Nothing gets missed.' },
    { tier: 'Khatario Connect', title: 'Bot rules & AI replies', text: 'Answers the late-night “is it in stock?” questions for you.' },
  ],
  ctaLabel: 'See Khatario Connect',
  ctaHref: '/?product=connect',
  markupTitle: 'Your own Meta account. You pay Meta, not us.',
  markupText:
    'Many WhatsApp tools send your messages through their account and add their own margin on every message. Connect runs on your own WhatsApp Business account with Meta, so Meta bills you directly at its own rates and Khatario adds nothing on top.',
  markupNote: 'Your Connect plan is a fixed fee. Message charges are only between you and Meta.',
};

/** A campaign being written, plus an inbox reply. Illustration with sample data. */
function CampaignMock() {
  return (
    <div className="relative pb-24 pr-0 sm:pr-16">
      <div className="absolute inset-y-8 left-8 right-0 rounded-[2rem] bg-emerald-50" aria-hidden />
      <div className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/15">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-bold text-slate-900">New campaign</p>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Approved template</span>
        </div>
        <p className="text-xs text-slate-600">Send to</p>
        <p className="mb-4 mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800">
          Customers who bought in the last 90 days · <strong>1,240</strong>
        </p>
        <div className="rounded-xl bg-[#efeae2] p-3">
          <div className="max-w-[18rem] rounded-lg bg-white p-3 text-[13px] leading-relaxed text-slate-900">
            <div className="mb-2 h-20 rounded-md bg-gradient-to-br from-accent-100 to-accent-300" aria-hidden />
            <strong>Diwali offer at Shree Ganesh Traders</strong>
            <br />
            10% off dry fruits and gift packs till 5 Nov. Tap below to order.
            <p className="mt-2 border-t border-slate-200 pt-2 text-center font-semibold text-sky-700">Order now</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] text-slate-600">Meta’s charge only, no markup</span>
          <span className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">Schedule for 6 PM</span>
        </div>
      </div>
      <div className="absolute bottom-0 right-0 w-64 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl">
        <p className="mb-2 text-xs font-bold text-slate-600">Shared inbox</p>
        <p className="mb-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[13px]">Is the 5kg basmati in stock?</p>
        <p className="ml-6 rounded-lg bg-[#d9fdd3] px-3 py-2 text-[13px]">
          Yes ji, 46 packs at ₹590. Shall I add it to your order?
          <span className="mt-1 block text-[10px] font-bold text-emerald-800">AI REPLY</span>
        </p>
      </div>
    </div>
  );
}

export function LandingWhatsAppMarketing(props: Partial<LandingWhatsAppMarketingContent> = {}) {
  const c = withDefaults(LANDING_WHATSAPP_MARKETING_DEFAULTS, props);
  return (
    <section id="whatsapp" className="scroll-mt-24 bg-white py-20 2xl:py-28">
      <div className={`${LANDING_PAGE_GUTTER} grid items-center gap-14 lg:grid-cols-[0.95fr_1fr]`}>
        <div className="lg:col-start-2 lg:row-start-1">
          <LandingSectionHead kicker={c.kicker} heading={c.heading} intro={c.intro} />
          <div className="mt-8 grid gap-3.5 sm:grid-cols-2">
            {c.cards.map((card, i) => (
              <LandingReveal key={card.title} delay={i * 60}>
                <div className="h-full rounded-2xl border border-slate-200 p-5">
                  <p className={`text-xs font-bold uppercase tracking-wide ${i === 0 ? 'text-emerald-700' : 'text-accent-700'}`}>
                    {card.tier}
                  </p>
                  <p className="mt-1.5 font-bold text-slate-900">{card.title}</p>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{card.text}</p>
                </div>
              </LandingReveal>
            ))}
          </div>
          {c.ctaLabel && (
            <Link
              href={c.ctaHref || '/?product=connect'}
              className="mt-8 inline-flex min-h-[48px] items-center rounded-xl bg-primary-600 px-6 text-base font-semibold text-white transition hover:bg-primary-700"
            >
              {c.ctaLabel}
            </Link>
          )}
        </div>
        <div className="lg:col-start-1 lg:row-start-1">
          <CampaignMock />
        </div>
        {c.markupTitle && (
          <LandingReveal className="lg:col-span-2 lg:row-start-2">
            <div className="grid gap-8 rounded-3xl bg-primary-600 p-7 text-white sm:p-9 lg:grid-cols-[1fr_1.05fr] lg:items-center">
              <div>
                <p className="landing-kicker landing-kicker-light">No markup on WhatsApp</p>
                <h3 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">{c.markupTitle}</h3>
                <p className="mt-3 text-[16px] leading-relaxed text-primary-100">{c.markupText}</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/5 p-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-primary-100">
                    <X className="h-4 w-4" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-primary-100">Many WhatsApp tools</span>
                    <span className="block text-lg font-bold">Meta’s charge + their markup on every message</span>
                  </span>
                </div>
                <div className="flex items-start gap-3 rounded-2xl bg-white p-4 text-slate-900 shadow-xl">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-500 text-slate-950">
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-accent-700">Khatario Connect</span>
                    <span className="block text-lg font-bold">Meta’s charge only, paid by you to Meta</span>
                  </span>
                </div>
                {c.markupNote && <p className="text-sm text-primary-100">{c.markupNote}</p>}
              </div>
            </div>
          </LandingReveal>
        )}
      </div>
    </section>
  );
}
