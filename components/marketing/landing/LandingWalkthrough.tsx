import { LANDING_INTRO_SUBTEXT, LANDING_MAX_MEDIUM, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const STEPS = [
  {
    n: 1,
    title: 'Create a GST bill',
    blurb: 'Add items, apply the right HSN and tax, and see totals before you say the number aloud.',
    placeholder: 'Invoice editor',
  },
  {
    n: 2,
    title: 'Send on WhatsApp',
    blurb: 'Share PDF or a payment link in one flow — your customer has proof on the phone they already use.',
    placeholder: 'Share sheet',
  },
  {
    n: 3,
    title: 'Track payment & credit',
    blurb: 'Mark partial, full, or due — and see the balance next to the name, not buried in a register.',
    placeholder: 'Payment status',
  },
  {
    n: 4,
    title: 'Open reports for filing',
    blurb: 'GSTR-leaning views and exports with less back-and-forth with your CA.',
    placeholder: 'GST reports',
  },
];

export function LandingWalkthrough() {
  return (
    <section className="scroll-mt-24 bg-white py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">A simple path from sale to statement</h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            Four steps your staff can learn without a day-long “training”.
          </p>
        </div>
        <ol
          className={`mt-14 w-full list-none gap-8 space-y-0 p-0 sm:grid sm:grid-cols-2 sm:gap-x-10 sm:gap-y-12 xl:grid-cols-4 xl:gap-x-6 xl:gap-y-8 2xl:mt-16 2xl:gap-x-8 2xl:gap-y-10 ${LANDING_MAX_MEDIUM}`}
        >
          {STEPS.map((step) => (
            <li key={step.n} className="flex gap-4 xl:flex-col xl:gap-3 2xl:gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm font-bold text-white 2xl:h-12 2xl:w-12 2xl:text-base">
                {step.n}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-slate-900 2xl:text-xl">{step.title}</h3>
                <p className="mt-1 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{step.blurb}</p>
                <div
                  className="mt-4 flex aspect-[16/10] min-h-[10rem] items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-2 text-center text-sm font-medium text-slate-400 2xl:aspect-[16/9] 2xl:min-h-[12rem] 2xl:text-base"
                  role="img"
                  aria-label={`${step.placeholder} — placeholder for product screenshot`}
                >
                  {step.placeholder} — your screenshot
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
