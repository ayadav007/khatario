import { LANDING_INTRO_SUBTEXT, LANDING_MAX_MEDIUM, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const PAIRS: { manual: string; khatario: string }[] = [
  { manual: 'Handwritten khata and loose sheets', khatario: 'Searchable bills and one ledger' },
  { manual: 'Recalculating tax for every return', khatario: 'Same logic at sale time and in reports' },
  { manual: 'Chasing payments from memory', khatario: 'WhatsApp + balances by party' },
  { manual: 'End-of-month Excel patchwork for GST', khatario: 'Exports that mirror what you sold' },
  { manual: "Training every new person on an informal, paper system", khatario: 'Clear screens built for real shops' },
];

export function LandingComparison() {
  return (
    <section className="scroll-mt-24 bg-white py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">Manual vs Khatario</h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            You are not slow — the old tools are. Here is a straight comparison.
          </p>
        </div>
        <div
          className={`mt-10 w-full overflow-hidden rounded-2xl border border-slate-200 shadow-sm 2xl:mt-12 2xl:shadow-md ${LANDING_MAX_MEDIUM}`}
        >
          <div className="grid grid-cols-2 bg-slate-100 text-sm font-semibold text-slate-700 sm:text-base 2xl:py-1 2xl:text-lg">
            <div className="border-r border-slate-200 px-4 py-3 sm:px-6 2xl:px-8 2xl:py-4">Manual / ad-hoc</div>
            <div className="px-4 py-3 sm:px-6 2xl:px-8 2xl:py-4">With Khatario</div>
          </div>
          <ul className="divide-y divide-slate-200">
            {PAIRS.map((row) => (
              <li key={row.manual} className="grid grid-cols-1 sm:grid-cols-2">
                <div className="border-b border-slate-100 bg-rose-50/30 px-4 py-4 text-slate-700 sm:border-b-0 sm:border-r sm:border-slate-200 sm:px-6 2xl:px-8 2xl:py-5 2xl:text-lg 2xl:leading-relaxed">
                  {row.manual}
                </div>
                <div className="px-4 py-4 text-slate-800 sm:px-6 2xl:px-8 2xl:py-5 2xl:text-lg 2xl:leading-relaxed">
                  {row.khatario}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
