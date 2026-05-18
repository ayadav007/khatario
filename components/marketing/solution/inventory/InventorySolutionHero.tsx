import Link from 'next/link';
import { ArrowRight, Package } from 'lucide-react';
import { LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

export function InventorySolutionHero() {
  return (
    <section className="border-b border-slate-200/80 bg-white pb-16 pt-28 md:pb-20 md:pt-32 2xl:pb-24 2xl:pt-36">
      <div className={`${LANDING_PAGE_GUTTER} w-full`}>
        <div className={LANDING_SECTION_INTRO}>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
            <Package className="h-4 w-4 text-slate-600" aria-hidden />
            Stock that stays honest with your sales
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl 2xl:text-6xl 2xl:leading-[1.1]">
            Inventory management that moves when your shop moves
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-lg leading-relaxed text-slate-600 md:mx-0 2xl:mt-6 2xl:max-w-4xl 2xl:text-xl 2xl:leading-relaxed">
            Khatario automatically updates inventory in real-time based on invoices, purchases, and stock movements.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-8 py-3.5 text-base font-semibold text-white shadow-md transition hover:bg-primary-700 2xl:px-10 2xl:py-4 2xl:text-lg"
            >
              Start Free
              <ArrowRight className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href="/book-demo"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-8 py-3.5 text-base font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 2xl:px-10 2xl:py-4 2xl:text-lg"
            >
              Book Demo
            </Link>
          </div>
          <p className="mt-4 text-sm text-slate-500 2xl:text-base">Built for counters, warehouses, and growing teams.</p>
        </div>
      </div>
    </section>
  );
}
