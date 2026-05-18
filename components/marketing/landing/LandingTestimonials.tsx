import { LANDING_INTRO_SUBTEXT, LANDING_MAX_WIDE, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const QUOTES = [
  {
    quote:
      'Earlier our evening went into rewriting bills. Now the same person at the counter finishes billing before the next customer shouts the next item. GST figures match what we actually charged.',
    name: 'Priya Nair',
    role: 'Grocery & staples · Kochi',
    result: '~40% faster checkouts on busy days',
  },
  {
    quote:
      'We send WhatsApp bills from the same screen. Payment follow-ups are not “we will do it when free” — they happen from the app.',
    name: 'Harish Bhatt',
    role: 'Electricals & fittings · Indore',
    result: 'Fewer follow-up calls, clearer credit',
  },
  {
    quote:
      'I did not want another “enterprise” tool. Khatario looked like my shop, not a bank dashboard. Reports for my CA take minutes now.',
    name: 'Sulekha R.',
    role: 'Uniform & school supplies · Coimbatore',
    result: 'More time in the store, not in files',
  },
];

export function LandingTestimonials() {
  return (
    <section className="border-t border-slate-200/80 bg-slate-50/90 py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">What business owners say</h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            The themes below are <strong className="font-medium text-slate-800">typical of what we hear</strong> from
            shop and warehouse teams after they move day-to-day billing off paper and random WhatsApp math.
          </p>
        </div>
        <div
          className={`mt-12 grid w-full gap-6 md:grid-cols-3 md:gap-8 2xl:mt-14 2xl:gap-10 ${LANDING_MAX_WIDE}`}
        >
          {QUOTES.map((t) => (
            <blockquote
              key={t.name}
              className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm 2xl:p-8 2xl:shadow"
            >
              <p className="flex-1 text-slate-700 leading-relaxed 2xl:text-lg 2xl:leading-relaxed">“{t.quote}”</p>
              <footer className="mt-6 border-t border-slate-100 pt-4">
                <p className="font-semibold text-slate-900">{t.name}</p>
                <p className="text-sm text-slate-500">{t.role}</p>
                <p className="mt-2 text-sm font-medium text-green-800">{t.result}</p>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}
