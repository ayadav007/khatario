import {
  BarChart3,
  Building2,
  Landmark,
  MessageCircle,
  PieChart,
  Receipt,
  Wallet,
} from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_MAX_WIDE, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const FEATURES: { id: string; icon: typeof Landmark; title: string; body: string }[] = [
  {
    id: 'auto-ledger',
    icon: Landmark,
    title: 'Automatic ledger from real work',
    body: 'Invoices, purchases, and expenses flow into proper entries — fewer late-night fixes and fewer mismatches.',
  },
  {
    id: 'gst',
    icon: Receipt,
    title: 'GST-aware: GSTR-1, GSTR-3B, GSTR-2B & checks',
    body: 'See the story your bills tell before you upload: outward data, summary views, imports, and reconciliation help.',
  },
  {
    id: 'credit',
    icon: Wallet,
    title: 'Credit tracking that matches the counter',
    body: 'Know what customers still owe — tied to invoices and payments, not a half-updated notebook.',
  },
  {
    id: 'bank',
    icon: Building2,
    title: 'Bank reconciliation you can finish',
    body: 'Bring statements in, match to what you recorded, and clear the month without guessing.',
  },
  {
    id: 'reports',
    icon: PieChart,
    title: 'Reports: profit, balance sheet, cash flow',
    body: 'Understand how the period actually performed — so you can decide, not just file.',
  },
  {
    id: 'whatsapp',
    icon: MessageCircle,
    title: 'WhatsApp reminders for dues',
    body: 'Send payment nudges from the same place you run the shop — polite, tracked, practical.',
  },
];

export function AccountingFeaturesSection() {
  return (
    <section className="scroll-mt-24 border-t border-slate-200/80 bg-white py-16 2xl:py-24" aria-labelledby="accounting-features-heading">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 id="accounting-features-heading" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            How Khatario keeps accounting simple
          </h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            GST accounting and an easy accounting app only help if the flow matches your day. These pieces are built to
            work together — not as six disconnected tools.
          </p>
        </div>
        <div className={`mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8 2xl:mt-14 2xl:gap-10 ${LANDING_MAX_WIDE}`}>
          {FEATURES.map(({ id, icon: Icon, title, body }) => (
            <article
              key={id}
              id={id}
              className="scroll-mt-24 rounded-2xl border border-slate-200 bg-slate-50/40 p-6 shadow-sm transition hover:shadow-md 2xl:p-8"
            >
              <Icon className="h-10 w-10 text-slate-700 2xl:h-12 2xl:w-12" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-4 text-lg font-bold text-slate-900 2xl:text-xl">{title}</h3>
              <p className="mt-2 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{body}</p>
            </article>
          ))}
        </div>
        <p className="mt-10 flex items-center gap-2 text-sm text-slate-500 2xl:mt-12 2xl:text-base">
          <BarChart3 className="h-4 w-4 shrink-0" aria-hidden />
          Accounting software for small business should reduce steps — not add screens.
        </p>
      </div>
    </section>
  );
}
