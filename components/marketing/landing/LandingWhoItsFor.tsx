import { Store, UtensilsCrossed, Package, Wrench } from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_MAX_WIDE, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const CASES = [
  {
    icon: Store,
    title: 'Retail shops',
    pain: 'Long queues, price changes, and stock that never matches the shelf.',
    help: 'Fast POS-style billing, barcode-friendly items, and stock that moves with every bill.',
  },
  {
    icon: UtensilsCrossed,
    title: 'Restaurants & cafés',
    pain: 'Splitting orders, KOT confusion, and unclear daily totals till month-end.',
    help: 'Clear tickets, add-ons, and day-end numbers your staff can actually follow.',
  },
  {
    icon: Package,
    title: 'Wholesalers',
    pain: 'Credit limits, bulk pricing, and chasing distributors for dues.',
    help: 'Party-wise credit, rate tiers, and statements that your buyers cannot argue with.',
  },
  {
    icon: Wrench,
    title: 'Service businesses',
    pain: 'Estimates, repeat jobs, and GST on services without a full-time accountant in the room.',
    help: 'Professional invoices, job history, and tax lines that look legit to your clients.',
  },
];

export function LandingWhoItsFor() {
  return (
    <section className="scroll-mt-24 bg-white py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">Who it is for</h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            If you touch cash, credit, and GST in the same breath — you are the kind of business we had in
            mind.
          </p>
        </div>
        <div
          className={`mt-12 grid w-full gap-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4 lg:gap-8 2xl:mt-14 2xl:gap-10 ${LANDING_MAX_WIDE}`}
        >
          {CASES.map(({ icon: Icon, title, pain, help }) => (
            <div
              key={title}
              className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50/50 p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md 2xl:p-8"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <Icon className="h-6 w-6 text-slate-700" aria-hidden />
              </div>
              <h3 className="text-lg font-bold text-slate-900">{title}</h3>
              <p className="mt-2 text-sm font-medium text-rose-900/80">Pain: {pain}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">
                <span className="font-semibold text-slate-800">Khatario helps: </span>
                {help}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
