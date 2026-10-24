import { LANDING_INTRO_SUBTEXT, LANDING_MAX_WIDE, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';
import { MarketingIcon } from '@/components/marketing/builder/icons';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type WhoItsForCase = { icon: string; title: string; pain: string; help: string };

export type LandingWhoItsForContent = {
  heading: string;
  subtext: string;
  painLabel: string;
  helpLabel: string;
  cases: WhoItsForCase[];
};

export const LANDING_WHO_ITS_FOR_DEFAULTS: LandingWhoItsForContent = {
  heading: 'Who it is for',
  subtext:
    'If you touch cash, credit, and GST in the same breath — you are the kind of business we had in mind.',
  painLabel: 'Pain:',
  helpLabel: 'Khatario helps:',
  cases: [
    {
      icon: 'store',
      title: 'Retail shops',
      pain: 'Long queues, price changes, and stock that never matches the shelf.',
      help: 'Fast POS-style billing, barcode-friendly items, and stock that moves with every bill.',
    },
    {
      icon: 'restaurant',
      title: 'Restaurants & cafés',
      pain: 'Splitting orders, KOT confusion, and unclear daily totals till month-end.',
      help: 'Clear tickets, add-ons, and day-end numbers your staff can actually follow.',
    },
    {
      icon: 'package',
      title: 'Wholesalers',
      pain: 'Credit limits, bulk pricing, and chasing distributors for dues.',
      help: 'Party-wise credit, rate tiers, and statements that your buyers cannot argue with.',
    },
    {
      icon: 'wrench',
      title: 'Service businesses',
      pain: 'Estimates, repeat jobs, and GST on services without a full-time accountant in the room.',
      help: 'Professional invoices, job history, and tax lines that look legit to your clients.',
    },
  ],
};

export function LandingWhoItsFor(props: Partial<LandingWhoItsForContent> = {}) {
  const c = withDefaults(LANDING_WHO_ITS_FOR_DEFAULTS, props);
  return (
    <section className="relative scroll-mt-24 overflow-hidden bg-slate-900 py-20 2xl:py-24">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(45,212,191,0.12),_transparent_55%)]"
        aria-hidden
      />
      <div className={`${LANDING_PAGE_GUTTER} relative`}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl 2xl:text-5xl">{c.heading}</h2>
          {c.subtext && <p className={`${LANDING_INTRO_SUBTEXT} !text-slate-300`}>{c.subtext}</p>}
        </div>
        <div
          className={`mt-12 grid w-full gap-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4 lg:gap-8 2xl:mt-14 2xl:gap-10 ${LANDING_MAX_WIDE}`}
        >
          {c.cases.map(({ icon, title, pain, help }, i) => (
            <div
              key={`${title}-${i}`}
              className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition hover:border-white/20 hover:bg-white/[0.07] 2xl:p-8"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[rgba(45,212,191,0.12)] ring-1 ring-[rgba(45,212,191,0.3)]">
                <MarketingIcon name={icon} className="h-6 w-6 text-primary-300" />
              </div>
              <h3 className="text-lg font-bold text-white">{title}</h3>
              {pain && (
                <p className="mt-2 text-sm font-medium text-rose-200">
                  {c.painLabel} {pain}
                </p>
              )}
              {help && (
                <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-300">
                  <span className="font-semibold text-white">{c.helpLabel} </span>
                  {help}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
