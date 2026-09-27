import { ChevronDown } from 'lucide-react';
import {
  LANDING_INTRO_SUBTEXT,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';
import { SafeMarkdown } from '@/components/marketing/builder/SafeMarkdown';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type FaqItem = { q: string; a: string };

export type LandingFaqContent = {
  heading: string;
  intro: string;
  items: FaqItem[];
};

export const LANDING_FAQ_DEFAULTS: LandingFaqContent = {
  heading: 'Questions shop owners ask us',
  intro: 'Still unsure? [Book a free demo](/book-demo) and ask us anything.',
  items: [
    {
      q: 'Are the bills GST compliant? Can I file GSTR-1 from Khatario?',
      a: 'Yes. Every bill carries HSN/SAC codes and works out CGST, SGST or IGST from the place of supply. Khatario prepares GSTR-1 and GSTR-3B views that you can export as Excel or JSON for the GST portal, or send to your CA.',
    },
    {
      q: 'What happens if the internet goes down at the counter?',
      a: 'You can keep billing. Bills made offline are saved on the device and sync automatically when the connection is back, so the queue does not stop.',
    },
    {
      q: 'Does it work on my phone?',
      a: 'Yes. Khatario runs in the browser on your computer, tablet or phone, and you can add it to your home screen like an app. Your data is the same on every device.',
    },
    {
      q: 'Which printers does it support?',
      a: '58mm and 80mm thermal receipt printers over Bluetooth, USB or network, plus A4 PDF bills for any regular printer.',
    },
    {
      q: 'I use Tally, Vyapar or a notebook today. How hard is it to switch?',
      a: 'Most shops start billing on day one. Import your item list from a CSV file (we give you the template), add customers as they come in, and keep your old books for past years. If you want help, book a demo and we will walk through it on your data.',
    },
    {
      q: 'Is my business data safe?',
      a: 'Everything travels over encrypted HTTPS, and role-based access means staff only see what they should. Your customer list and bills are yours — we do not sell them to advertisers. Business and Enterprise plans include automatic backups.',
    },
    {
      q: 'Is there really a free plan?',
      a: 'Yes. The Free plan covers up to 20 invoices a month with 10 customers and 10 items — enough to try Khatario properly. New accounts also start with a trial of the full product, and no card is needed to begin.',
    },
    {
      q: 'Can my staff and other branches use it too?',
      a: 'Yes. Professional includes up to 3 users and Business up to 10, each with their own login and permissions. Business and Enterprise plans support multiple branches.',
    },
  ],
};

/** Plain text for search-engine data: strips the markdown markers used in answers. */
function plainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

export function LandingFaq(props: Partial<LandingFaqContent> = {}) {
  const c = withDefaults(LANDING_FAQ_DEFAULTS, props);
  const items = c.items.filter((f) => f.q && f.a);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: plainText(a) },
    })),
  };

  return (
    <section id="faq" className="scroll-mt-24 bg-white py-20 2xl:py-24" aria-labelledby="landing-faq-heading">
      {items.length > 0 && (
        <script
          type="application/ld+json"
          // JSON.stringify output with "<" escaped cannot break out of the script element.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      <div className={`${LANDING_PAGE_GUTTER} grid gap-10 lg:grid-cols-12 lg:gap-16`}>
        <div className={`${LANDING_SECTION_INTRO} lg:col-span-4`}>
          <h2
            id="landing-faq-heading"
            className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl"
          >
            {c.heading}
          </h2>
          {c.intro && (
            <p className={LANDING_INTRO_SUBTEXT}>
              <SafeMarkdown inline text={c.intro} />
            </p>
          )}
        </div>

        <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-slate-50/60 lg:col-span-8">
          {items.map(({ q, a }, i) => (
            <details key={`${q}-${i}`} className="group px-5 sm:px-6 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-base font-semibold text-slate-900 sm:text-lg">
                {q}
                <ChevronDown
                  className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <SafeMarkdown text={a} className="-mt-1 pb-5 leading-relaxed text-slate-600 2xl:text-lg" />
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
