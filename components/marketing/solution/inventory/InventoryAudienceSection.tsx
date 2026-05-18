import { Briefcase, Pill, ShoppingBag, Store } from 'lucide-react';
import { LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const AUDIENCES: { icon: typeof Store; label: string; text: string }[] = [
  {
    icon: Store,
    label: 'Retail stores',
    text: 'Keep shelf truth aligned with billing — especially when queues are long and staff rotate.',
  },
  {
    icon: ShoppingBag,
    label: 'Wholesale & distribution',
    text: 'Multiple SKUs, credit sales, and stock across locations without losing thread of quantity or value.',
  },
  {
    icon: Pill,
    label: 'Pharma & dated goods',
    text: 'Batch and expiry awareness so what you sell matches what you still hold.',
  },
  {
    icon: Briefcase,
    label: 'Owner-managers',
    text: 'One stock tracking app that matches how you actually work — not a second office job.',
  },
];

export function InventoryAudienceSection() {
  return (
    <section className="scroll-mt-24 bg-slate-50/90 py-16 2xl:py-24" aria-labelledby="inventory-audience-heading">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 id="inventory-audience-heading" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            Who it is for
          </h2>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-slate-600 md:mx-0 2xl:mt-4 2xl:max-w-3xl 2xl:text-xl">
            From a single shop to more than one branch — same idea: stock you can explain to yourself, your team, and
            your CA.
          </p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 2xl:mt-12 2xl:gap-8">
          {AUDIENCES.map(({ icon: Icon, label, text }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm 2xl:p-8">
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
