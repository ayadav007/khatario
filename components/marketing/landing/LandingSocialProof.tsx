import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';

/** Sectors we serve (text-only; swap for customer logos in `/public` when you have permission). */
const SECTOR_CHIPS = [
  'Retail & grocery',
  'Restaurants & F&B',
  'Distribution & wholesale',
  'Services & repairs',
  'Traders & stockists',
  'Pharmacy & wellness',
] as const;

export function LandingSocialProof() {
  return (
    <section className="border-b border-slate-200/80 bg-white py-10 2xl:py-14">
      <div className={`${LANDING_PAGE_GUTTER}`}>
        <div className="w-full">
          <p className="w-full text-center text-sm font-medium uppercase tracking-wider text-slate-500 max-md:mx-auto md:text-left xl:text-base">
            Built for the kind of businesses that live or die on the counter
          </p>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 max-md:mx-auto max-md:text-center md:text-left 2xl:text-base">
            Teams across <strong className="font-medium text-slate-700">retail, wholesale, and services</strong> use
            Khatario for bills, stock, and payments — in towns and cities across India.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-3 md:justify-start xl:mt-6 xl:gap-3 2xl:mt-7">
            {SECTOR_CHIPS.map((label) => (
              <div
                key={label}
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm 2xl:px-4 2xl:text-sm"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="mt-10 grid w-full grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8 2xl:mt-14 2xl:gap-10">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-center max-md:mx-auto max-md:max-w-md sm:text-left 2xl:p-8">
              <p className="text-3xl font-bold text-slate-900 sm:text-4xl 2xl:text-5xl">5,000+</p>
              <p className="mt-1 text-sm font-medium text-slate-600">Businesses on Khatario</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-center max-md:mx-auto max-md:max-w-md sm:text-left 2xl:p-8">
              <p className="text-3xl font-bold text-slate-900 sm:text-4xl 2xl:text-5xl">10,000+</p>
              <p className="mt-1 text-sm font-medium text-slate-600">Invoices generated (and counting)</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-center max-md:mx-auto max-md:max-w-md sm:text-left 2xl:p-8">
              <p className="text-3xl font-bold text-slate-900 sm:text-4xl 2xl:text-5xl">4.8 / 5</p>
              <p className="mt-1 text-sm font-medium text-slate-600">Shopkeeper-rated ease of use</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
