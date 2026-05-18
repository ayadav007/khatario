import { LANDING_INTRO_SUBTEXT, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

export function InventoryWhatIsSection() {
  return (
    <section className="scroll-mt-24 border-t border-slate-200/80 bg-white py-16 2xl:py-24" aria-labelledby="inventory-what-heading">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={`${LANDING_SECTION_INTRO} max-w-4xl`}>
          <h2 id="inventory-what-heading" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            What good inventory means on the floor
          </h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            It is knowing how much you truly have, where it sits, and at what cost — so pricing, promises, and
            month-end numbers all point the same way.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-slate-600 2xl:mt-5 2xl:text-xl 2xl:leading-relaxed">
            Khatario ties those answers to everyday work: every bill, purchase, return, adjustment, or move between
            locations updates stock in step — not in a separate late-night round.
          </p>
        </div>
      </div>
    </section>
  );
}
