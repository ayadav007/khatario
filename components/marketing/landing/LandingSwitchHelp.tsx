'use client';

import Link from 'next/link';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { MarketingImg } from '@/components/marketing/builder/MarketingImg';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

export type LandingSwitchHelpContent = {
  kicker: string;
  heading: string;
  intro: string;
  steps: { title: string; text: string }[];
  ctaLabel: string;
  ctaHref: string;
  image: string;
  imageAlt: string;
};

export const LANDING_SWITCH_HELP_DEFAULTS: LandingSwitchHelpContent = {
  kicker: 'Switching is easy',
  heading: 'Coming from Tally, Vyapar or a notebook?',
  intro: 'Most shops bill on day one. Book a free call and we set it up with you, on your own data.',
  steps: [
    { title: 'Bring your items', text: 'Import your item list from a CSV file. We give you the template.' },
    { title: 'Design your bill', text: 'Your logo, GSTIN, bank and UPI details, terms.' },
    { title: 'Connect your printer', text: '58 or 80mm thermal over Bluetooth, USB or network, or A4.' },
    { title: 'Add your staff', text: 'Each person gets a login with only the access you allow.' },
  ],
  ctaLabel: 'Book a free setup call',
  ctaHref: '/book-demo',
  image: '/marketing/khatario-shop-counter.webp',
  imageAlt: 'Shop owner at a grocery counter with a tablet and a receipt printer',
};

export function LandingSwitchHelp(props: Partial<LandingSwitchHelpContent> = {}) {
  const c = withDefaults(LANDING_SWITCH_HELP_DEFAULTS, props);
  return (
    <section id="switch" className="scroll-mt-24 bg-accent-50 py-20 2xl:py-28">
      <div className={`${LANDING_PAGE_GUTTER} grid items-center gap-12 lg:grid-cols-2`}>
        <div>
          <LandingSectionHead kicker={c.kicker} heading={c.heading} intro={c.intro} />
          {c.ctaLabel && (
            <Link
              href={c.ctaHref || '/book-demo'}
              className="mt-7 inline-flex min-h-[48px] items-center rounded-xl bg-primary-600 px-6 text-base font-semibold text-white transition hover:bg-primary-700"
            >
              {c.ctaLabel}
            </Link>
          )}
          {c.image && (
            <MarketingImg
              src={c.image}
              alt={c.imageAlt}
              width={1536}
              height={1024}
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="mt-8 rounded-2xl shadow-xl shadow-slate-900/10"
            />
          )}
        </div>
        <ol className="grid gap-3.5 sm:grid-cols-2">
          {c.steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-accent-200 bg-white p-5">
              <span className="text-3xl font-extrabold text-accent-700">{i + 1}</span>
              <p className="mt-2 font-bold text-slate-900">{s.title}</p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
