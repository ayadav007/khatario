import { Briefcase, Globe2, ShoppingBag, Store } from 'lucide-react';
import { LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const AUDIENCES: { icon: typeof Store; label: string; text: string }[] = [
  {
    icon: Store,
    label: 'Retail shops',
    text: 'Fast billing at the counter with records that stay tidy for GST and month-end.',
  },
  {
    icon: ShoppingBag,
    label: 'General traders & distributors',
    text: 'Purchases, credit sales, and stock-heavy workflows without juggling five spreadsheets.',
  },
  {
    icon: Globe2,
    label: 'Growing SMEs',
    text: 'Branches and stronger reporting when one register is no longer the whole picture.',
  },
  {
    icon: Briefcase,
    label: 'Owner-operators wearing many hats',
    text: 'One calm flow — bill today, track dues, reconcile cash — without hiring “spreadsheet staff” first.',
  },
];

export function AccountingAudienceSection() {
  return (
    <section className="scroll-mt-24 bg-slate-50/90 py-16 2xl:py-24" aria-labelledby="accounting-audience-heading">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 id="accounting-audience-heading" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            Built for busy Indian businesses
          </h2>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-slate-600 md:mx-0 2xl:mt-4 2xl:max-w-3xl 2xl:text-xl">
            Whether you run one shop or more than one location, you get the same idea: fewer handoffs between “billing”
            and “accounts”.
          </p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 2xl:mt-12 2xl:grid-cols-4 2xl:gap-8">
          {AUDIENCES.map(({ icon: Icon, label, text }) => (
            <div
              key={label}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm 2xl:p-8"
            >
              <Icon className="h-9 w-9 text-slate-700 2xl:h-10 2xl:w-10" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-4 text-lg font-semibold text-slate-900 2xl:text-xl">{label}</h3>
              <p className="mt-2 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
