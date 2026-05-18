import { CheckCircle2, XCircle } from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_MAX_MEDIUM, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const ROWS = [
  {
    problem: 'Manual billing eats your evening',
    problemDetail: 'Handwritten khata, duplicate entry, and searching old bills when a customer disputes.',
    solution: 'One bill in under a minute',
    solutionDetail: 'Items, tax, and customer saved — reprint, share, or add returns without red ink chaos.',
  },
  {
    problem: 'GST looks scary on a busy day',
    problemDetail: 'HSN, slabs, and reports feel like a second job after you have already run the store.',
    solution: 'Built-in tax logic and clean exports',
    solutionDetail: 'Right calculations at billing time; GSTR-friendly views when it is time to file.',
  },
  {
    problem: 'Payment follow-up slips through the cracks',
    problemDetail: 'Unpaid sales pile up when reminders live only in your head (or a notebook).',
    solution: 'WhatsApp reminders, tracked',
    solutionDetail: 'Send bills and nudges from the same place you record the sale. See who owes what.',
  },
];

export function LandingProblemSolution() {
  return (
    <section className="scroll-mt-24 bg-slate-50/90 py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">Sound familiar?</h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            Most billing tools only list features. Khatario is built around what actually breaks your day.
          </p>
        </div>
        <div className={`mt-14 w-full space-y-6 2xl:mt-16 ${LANDING_MAX_MEDIUM}`}>
          {ROWS.map((row) => (
            <div
              key={row.problem}
              className="grid gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-2 2xl:shadow-md"
            >
              <div className="border-b border-slate-100 bg-rose-50/40 p-6 md:border-b-0 md:border-r 2xl:p-8 2xl:pr-10">
                <div className="mb-2 flex items-center gap-2 text-rose-800">
                  <XCircle className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="text-xs font-bold uppercase tracking-wide">The pain</span>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 2xl:text-xl">{row.problem}</h3>
                <p className="mt-2 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{row.problemDetail}</p>
              </div>
              <div className="p-6 2xl:p-8 2xl:pl-10">
                <div className="mb-2 flex items-center gap-2 text-green-800">
                  <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="text-xs font-bold uppercase tracking-wide">With Khatario</span>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 2xl:text-xl">{row.solution}</h3>
                <p className="mt-2 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{row.solutionDetail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
