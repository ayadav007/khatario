import {
  BarChart3,
  MessageCircle,
  Package,
  Printer,
  UserRound,
} from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_MAX_WIDE, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const SCENARIOS = [
  {
    icon: MessageCircle,
    title: 'When a payment is late, you do not have to call',
    body: 'Send a professional WhatsApp reminder with the invoice link — the same number your customer already trusts.',
    tag: 'Collections',
  },
  {
    icon: Package,
    title: 'When stock runs low, you see it before the shelf is empty',
    body: 'Low-stock signals tied to your sales rhythm, so replenishment is a decision — not a surprise.',
    tag: 'Inventory',
  },
  {
    icon: UserRound,
    title: 'When a regular walks in, you do not retype their GSTIN',
    body: 'Save party-wise defaults: credit, price list, and shipping — bill the relationship, not just the line items.',
    tag: 'Customers',
  },
  {
    icon: Printer,
    title: 'When the counter is crowded, the printer keeps up',
    body: 'Thermal paths for 58mm and 80mm — short queues, clear totals, and fewer handwritten totals at close.',
    tag: 'Counter',
  },
  {
    icon: BarChart3,
    title: 'When the CA asks for returns, you open one place',
    body: 'GST summaries and exports that match what you already billed — not a weekend of stitching Excel.',
    tag: 'Compliance',
  },
];

export function LandingScenarios() {
  return (
    <section className="border-y border-slate-200/80 bg-slate-50/90 py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">How it feels in the real day</h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            Not a feature list — a few stories that map to the way you actually work.
          </p>
        </div>
        <div className="mt-10 max-sm:-mx-4 sm:mt-12">
          <div
            className={`flex w-full max-w-none max-sm:snap-x max-sm:snap-mandatory max-sm:gap-4 max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-2 sm:grid sm:min-w-0 sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-3 xl:grid-cols-5 xl:gap-5 2xl:gap-6 ${LANDING_MAX_WIDE}`}
          >
            {SCENARIOS.map((s) => (
              <div
                key={s.title}
                className="max-sm:min-w-[18rem] max-sm:shrink-0 max-sm:snap-center rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:min-w-0 2xl:p-6 2xl:shadow"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    {s.tag}
                  </span>
                  <s.icon className="h-5 w-5 text-slate-500" aria-hidden />
                </div>
                <h3 className="text-base font-bold leading-snug text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
