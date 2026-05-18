import { LANDING_INTRO_SUBTEXT, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

export function AccountingWhatIsSection() {
  return (
    <section className="scroll-mt-24 border-t border-slate-200/80 bg-white py-16 2xl:py-24" aria-labelledby="accounting-what-heading">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={`${LANDING_SECTION_INTRO} max-w-4xl`}>
          <h2 id="accounting-what-heading" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            What “accounting” really means here
          </h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            It is simply a clear record of what you sold, what you bought, what you owe, what others owe you, and how cash
            moved — so you can run the shop today and answer questions tomorrow (including GST time).
          </p>
          <p className="mt-4 text-lg leading-relaxed text-slate-600 2xl:mt-5 2xl:text-xl 2xl:leading-relaxed">
            You should not need to learn debit-and-credit rules before your first bill. Khatario turns the work you already
            do — invoices, purchases, expenses — into structured entries behind the scenes.
          </p>
        </div>
      </div>
    </section>
  );
}
