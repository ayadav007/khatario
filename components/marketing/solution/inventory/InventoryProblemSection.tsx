import { AlertTriangle } from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const POINTS = [
  {
    title: 'The register says one thing — the shelf says another',
    body: 'When stock lives in memory, notebooks, or a second app, disagreements show up during billing or GST time.',
  },
  {
    title: 'Branches and godowns multiply the confusion',
    body: 'Without a single view of what sits where, you either over-promise or play safe and lose sales.',
  },
  {
    title: 'Returns, damage, and expiry are easy to forget',
    body: 'Small slips add up: wrong counts, expired lots still counted as good, or transfers nobody wrote down.',
  },
];

export function InventoryProblemSection() {
  return (
    <section className="scroll-mt-24 bg-slate-50/90 py-16 2xl:py-24" aria-labelledby="inventory-problem-heading">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 id="inventory-problem-heading" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            Where inventory usually hurts
          </h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            Most shops do not fail because people are careless — they fail because stock updates are separate from the
            actual sale or purchase.
          </p>
        </div>
        <ul className="mt-12 grid gap-6 md:grid-cols-3 2xl:mt-14 2xl:gap-8">
          {POINTS.map((p) => (
            <li key={p.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm 2xl:p-8">
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
