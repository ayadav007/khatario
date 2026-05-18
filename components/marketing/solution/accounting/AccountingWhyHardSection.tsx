import { HelpCircle } from 'lucide-react';
import { LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const REASONS = [
  'Traditional tools assume you already speak “ledger language”.',
  'Sales, purchases, bank, and GST each live in separate mental boxes.',
  'One wrong copy-paste breaks reports — and you notice too late.',
  'Owners want answers while serving customers, not after exporting five files.',
];

export function AccountingWhyHardSection() {
  return (
    <section className="scroll-mt-24 bg-slate-50/90 py-16 2xl:py-24" aria-labelledby="accounting-why-hard-heading">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={`${LANDING_SECTION_INTRO} max-w-4xl`}>
          <h2 id="accounting-why-hard-heading" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            Why it feels difficult
          </h2>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-slate-600 md:mx-0 2xl:mt-4 2xl:max-w-3xl 2xl:text-xl">
            Accounting is not “hard math” for most shops — it is keeping everything aligned without slowing the counter.
          </p>
          <ul className="mt-8 space-y-4 text-lg text-slate-700 2xl:mt-10 2xl:space-y-5 2xl:text-xl">
            {REASONS.map((line) => (
              <li key={line} className="flex gap-3">
                <HelpCircle className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
