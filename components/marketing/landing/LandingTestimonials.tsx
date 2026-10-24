'use client';

import { LANDING_INTRO_SUBTEXT, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type LandingTestimonial = { quote: string; name: string; role: string; result: string };

export type LandingTestimonialsContent = {
  kicker: string;
  heading: string;
  subtext: string;
  quotes: LandingTestimonial[];
};

export const LANDING_TESTIMONIALS_DEFAULTS: LandingTestimonialsContent = {
  kicker: 'From shop owners',
  heading: 'Built for counters, not boardrooms.',
  subtext: '',
  quotes: [
    {
      quote:
        'Earlier our evening went into rewriting bills. Now the same person at the counter finishes billing before the next customer shouts the next item. GST figures match what we actually charged.',
      name: 'Priya Nair',
      role: 'Grocery & staples · Kochi',
      result: '~40% faster checkouts on busy days',
    },
    {
      quote:
        'We send WhatsApp bills from the same screen. Payment follow-ups are not “we will do it when free”. They happen from the app.',
      name: 'Harish Bhatt',
      role: 'Electricals & fittings · Indore',
      result: 'Fewer follow-up calls, clearer credit',
    },
    {
      quote:
        'I did not want another “enterprise” tool. Khatario looked like my shop, not a bank dashboard. Reports for my CA take minutes now.',
      name: 'Sulekha R.',
      role: 'Uniform & school supplies · Coimbatore',
      result: 'More time in the store, not in files',
    },
  ],
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z]/g, '').charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function LandingTestimonials(props: Partial<LandingTestimonialsContent> = {}) {
  const c = withDefaults(LANDING_TESTIMONIALS_DEFAULTS, props);
  const quotes = c.quotes.filter((q) => q.quote && q.name);
  if (quotes.length === 0) return null;

  return (
    <section className="bg-white py-20 2xl:py-28">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal className={LANDING_SECTION_INTRO}>
          {c.kicker && <p className="landing-kicker">{c.kicker}</p>}
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">{c.heading}</h2>
          {c.subtext && <p className={LANDING_INTRO_SUBTEXT}>{c.subtext}</p>}
        </LandingReveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-3 2xl:gap-6">
          {quotes.map((t, i) => (
            <LandingReveal key={`${t.name}-${i}`} delay={i * 80}>
              <figure className="flex h-full flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-7 transition duration-300 hover:-translate-y-1.5 hover:shadow-xl motion-reduce:hover:translate-y-0">
                <blockquote className="text-[17px] leading-relaxed text-slate-700">“{t.quote}”</blockquote>
                {t.result && (
                  <p className="rounded-xl bg-primary-50 px-3.5 py-2 text-sm font-bold text-primary-600">{t.result}</p>
                )}
                <figcaption className="mt-auto flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-600 text-sm font-bold text-white">
                    {initials(t.name)}
                  </span>
                  <span>
                    <span className="block font-semibold text-slate-900">{t.name}</span>
                    <span className="block text-sm text-slate-500">{t.role}</span>
                  </span>
                </figcaption>
              </figure>
            </LandingReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
