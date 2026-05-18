import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

export function InventorySolutionCta() {
  return (
    <section className="border-t border-slate-800 bg-slate-900 py-16 2xl:py-24" aria-labelledby="inventory-cta-heading">
      <div className={`${LANDING_PAGE_GUTTER} w-full`}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 id="inventory-cta-heading" className="text-3xl font-bold text-white sm:text-4xl 2xl:text-5xl">
            Ready to see stock stay true?
          </h2>
          <p className="mt-4 max-w-3xl text-lg text-slate-300 md:mx-0 2xl:mt-5 2xl:max-w-4xl 2xl:text-xl 2xl:leading-relaxed">
            Start free or book a walkthrough — bring your real categories and branches, not a pretend checklist.
          </p>
          <p className="mt-2 text-sm text-slate-400 2xl:text-base">Start Free · Book Demo — your pace.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg transition hover:bg-primary-700 2xl:px-10 2xl:py-4 2xl:text-lg"
            >
              Start Free
              <ArrowRight className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href="/book-demo"
              className="inline-flex items-center justify-center rounded-xl border border-slate-500 bg-transparent px-8 py-3.5 text-base font-semibold text-white transition hover:bg-white/10 2xl:px-10 2xl:py-4 2xl:text-lg"
            >
              Book Demo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
