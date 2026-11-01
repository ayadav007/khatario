'use client';

import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

export type LandingEverywhereContent = {
  kicker: string;
  heading: string;
  intro: string;
  chips: { label: string }[];
  trust: { title: string; text: string }[];
};

export const LANDING_EVERYWHERE_DEFAULTS: LandingEverywhereContent = {
  kicker: 'Works where you work',
  heading: 'Counter computer, phone in your pocket, same data',
  intro: 'Bill at the shop and check today’s sales from home. Your data is the same on every device.',
  chips: [
    { label: 'Phone, tablet & computer' },
    { label: 'Add to home screen like an app' },
    { label: 'Thermal & A4 printers' },
    { label: 'Bills in 13 languages' },
  ],
  trust: [
    { title: 'Encrypted, always', text: 'Everything travels over HTTPS.' },
    { title: 'Backups on every plan', text: 'Free plan included.' },
    { title: 'Staff see only what you allow', text: 'Role-based access for every login.' },
    { title: 'Your data is yours', text: 'We never sell your customer list or bills to advertisers.' },
    {
      title: 'GST-ready, CA-friendly',
      text: 'HSN/SAC on every bill, CGST/SGST/IGST worked out for you, GSTR-1 and 3B as Excel or JSON for your CA.',
    },
  ],
};

export function LandingEverywhere(props: Partial<LandingEverywhereContent> = {}) {
  const c = withDefaults(LANDING_EVERYWHERE_DEFAULTS, props);
  return (
    <section id="trust" className="relative scroll-mt-24 overflow-hidden bg-primary-600 py-20 text-white 2xl:py-28">
      <div className={`${LANDING_PAGE_GUTTER} relative grid gap-14 lg:grid-cols-2`}>
        <div>
          <LandingSectionHead kicker={c.kicker} heading={c.heading} intro={c.intro} light />
          <ul className="mt-7 flex flex-wrap gap-2.5">
            {c.chips.map((chip) => (
              <li key={chip.label} className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium">
                {chip.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="grid content-start gap-3.5 sm:grid-cols-2">
          {c.trust.map((t, i) => (
            <div
              key={t.title}
              className={`rounded-2xl border border-white/15 p-5 ${i === c.trust.length - 1 && c.trust.length % 2 === 1 ? 'sm:col-span-2' : ''}`}
            >
              <p className="font-bold">{t.title}</p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-primary-100">{t.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
