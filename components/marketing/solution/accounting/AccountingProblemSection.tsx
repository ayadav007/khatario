import { AlertTriangle } from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const POINTS = [
  {
    title: 'You bill customers — but the “books” live somewhere else',
    body: 'Sales happen in invoices or at the counter. Copying them again into a ledger later means mistakes and late nights.',
  },
  {
    title: 'GST forms sound urgent every month',
    body: 'You want numbers that match what you actually billed and bought — without becoming a tax expert overnight.',
  },
  {
    title: 'Money in the bank does not explain itself',
    body: 'Matching real bank entries to what you recorded should not take a spreadsheet and ten tabs.',
  },
];

export function AccountingProblemSection() {
  return (
    <section className="scroll-mt-24 bg-slate-50/90 py-16 2xl:py-24" aria-labelledby="accounting-problem-heading">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 id="accounting-problem-heading" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            The everyday mess
          </h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            Most owners do not struggle with intent — they struggle with keeping one clean story across sales, purchases,
            tax, and cash.
          </p>
        </div>
        <ul className="mt-12 grid gap-6 md:grid-cols-3 2xl:mt-14 2xl:gap-8">
          {POINTS.map((p) => (
            <li
              key={p.title}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm 2xl:p-8"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <AlertTriangle className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 2xl:text-xl">{p.title}</h3>
                  <p className="mt-2 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{p.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
