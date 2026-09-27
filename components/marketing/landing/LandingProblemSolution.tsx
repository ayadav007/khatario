'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import {
  LANDING_INTRO_SUBTEXT,
  LANDING_MAX_MEDIUM,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type ProblemSolutionRow = {
  problem: string;
  problemDetail: string;
  solution: string;
  solutionDetail: string;
};

export type LandingProblemSolutionContent = {
  heading: string;
  subtext: string;
  painLabel: string;
  solutionLabel: string;
  rows: ProblemSolutionRow[];
};

export const LANDING_PROBLEM_SOLUTION_DEFAULTS: LandingProblemSolutionContent = {
  heading: 'Sound familiar?',
  subtext: 'Most billing tools only list features. Khatario is built around what actually breaks your day.',
  painLabel: 'The pain',
  solutionLabel: 'With Khatario',
  rows: [
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
    {
      problem: 'Stock on paper never matches the shelf',
      problemDetail: 'You find out an item is finished when a customer asks for it.',
      solution: 'Stock that moves with every bill',
      solutionDetail:
        'Every sale and purchase updates quantity, and low-stock alerts warn you before the rack is empty.',
    },
  ],
};

export function LandingProblemSolution(props: Partial<LandingProblemSolutionContent> = {}) {
  const c = withDefaults(LANDING_PROBLEM_SOLUTION_DEFAULTS, props);
  return (
    <section className="scroll-mt-24 bg-slate-50/90 py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal>
          <div className={LANDING_SECTION_INTRO}>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
              {c.heading}
            </h2>
            {c.subtext && <p className={LANDING_INTRO_SUBTEXT}>{c.subtext}</p>}
          </div>
        </LandingReveal>
        <div className={`mt-12 grid w-full gap-6 xl:grid-cols-2 2xl:mt-14 ${LANDING_MAX_MEDIUM}`}>
          {c.rows.map((row, i) => (
            <LandingReveal key={`${row.problem}-${i}`} delay={i * 90}>
              <div className="grid h-full gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition duration-300 hover:shadow-md md:grid-cols-2 2xl:shadow-md">
                <div className="border-b border-slate-100 bg-rose-50/40 p-6 md:border-b-0 md:border-r 2xl:p-8 2xl:pr-10">
                  <div className="mb-2 flex items-center gap-2 text-rose-800">
                    <XCircle className="h-5 w-5 shrink-0" aria-hidden />
                    <span className="text-xs font-bold uppercase tracking-wide">{c.painLabel}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 2xl:text-xl">{row.problem}</h3>
                  <p className="mt-2 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{row.problemDetail}</p>
                </div>
                <div className="p-6 2xl:p-8 2xl:pl-10">
                  <div className="mb-2 flex items-center gap-2 text-primary-700">
                    <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
                    <span className="text-xs font-bold uppercase tracking-wide">{c.solutionLabel}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 2xl:text-xl">{row.solution}</h3>
                  <p className="mt-2 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{row.solutionDetail}</p>
                </div>
              </div>
            </LandingReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
