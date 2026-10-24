'use client';

import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { LandingCountUp } from '@/components/marketing/landing/LandingCountUp';
import { SafeMarkdown } from '@/components/marketing/builder/SafeMarkdown';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type LandingSocialProofContent = {
  eyebrow: string;
  intro: string;
  chips: { label: string }[];
  facts: { value: string; label: string }[];
};

export const LANDING_SOCIAL_PROOF_DEFAULTS: LandingSocialProofContent = {
  eyebrow: 'Built for the counter',
  intro: 'Everything a shop needs, **nothing it does not.**',
  chips: [
    { label: 'Retail & grocery' },
    { label: 'Restaurants & F&B' },
    { label: 'Distribution & wholesale' },
    { label: 'Services & repairs' },
    { label: 'Traders & stockists' },
    { label: 'Pharmacy & wellness' },
    { label: 'Electricals & hardware' },
    { label: 'Mobile & electronics' },
    { label: 'Garments & footwear' },
    { label: 'Auto parts' },
    { label: 'Building materials' },
  ],
  facts: [
    { value: '20+', label: 'GST-ready invoice, challan and note templates' },
    { value: '58 & 80mm', label: 'Thermal receipt printing for busy counters' },
    { value: '13', label: 'Languages your bills can print in' },
    { value: 'GSTR-1 & 3B', label: 'Plus 2B matching and GSTR-9, from your own bills' },
  ],
};

/** Leading number + short suffix ("20+", "13") counts up; anything else is shown as written. */
function FactValue({ value }: { value: string }) {
  const match = /^(\d+)(\D{0,2})$/.exec(value.trim());
  if (!match) return <>{value}</>;
  return <LandingCountUp value={Number(match[1])} suffix={match[2]} />;
}

export function LandingSocialProof(props: Partial<LandingSocialProofContent> = {}) {
  const c = withDefaults(LANDING_SOCIAL_PROOF_DEFAULTS, props);
  const chips = c.chips.map((chip) => chip.label).filter(Boolean);

  return (
    <section className="overflow-hidden bg-white pb-16 2xl:pb-20">
      {chips.length > 0 && (
        <div className="landing-marquee-mask group border-b border-slate-200 py-5" aria-label="Businesses that use Khatario">
          <div className="landing-marquee-track flex w-max gap-12 group-hover:[animation-play-state:paused]">
            {[0, 1].map((copy) =>
              chips.map((label, i) => (
                <span
                  key={`${copy}-${label}-${i}`}
                  aria-hidden={copy === 1}
                  className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap text-[15px] font-semibold text-slate-500"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                  {label}
                </span>
              )),
            )}
          </div>
        </div>
      )}

      <div className={`${LANDING_PAGE_GUTTER} pt-16 2xl:pt-20`}>
        <LandingReveal>
          {c.eyebrow && <p className="landing-kicker max-md:justify-center">{c.eyebrow}</p>}
          {c.intro && (
            <p className="mt-3 max-w-3xl text-2xl font-bold leading-snug tracking-tight text-slate-900 max-md:mx-auto max-md:text-center sm:text-3xl">
              <SafeMarkdown inline text={c.intro} className="[&_strong]:text-primary-600" />
            </p>
          )}
        </LandingReveal>

        {c.facts.length > 0 && (
          <div className="mt-10 grid w-full grid-cols-2 gap-4 lg:grid-cols-4 2xl:gap-6">
            {c.facts.map((fact, i) => (
              <LandingReveal key={`${fact.value}-${i}`} delay={i * 80}>
                <div className="h-full rounded-2xl border border-slate-200 bg-white p-5 transition duration-300 hover:-translate-y-1 hover:shadow-lg sm:p-6 2xl:p-8">
                  <p className="text-3xl font-extrabold tracking-tight text-primary-600 tabular-nums sm:text-4xl 2xl:text-5xl">
                    <FactValue value={fact.value} />
                  </p>
                  <p className="mt-1.5 text-sm font-medium text-slate-600">{fact.label}</p>
                </div>
              </LandingReveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
