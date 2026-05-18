import { FileText, MessageCircle, Package, Printer, Users, FileSpreadsheet } from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_MAX_WIDE, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';

const FEATURES: {
  id: string;
  icon: typeof FileText;
  title: string;
  benefit: string;
}[] = [
  {
    id: 'solution-invoicing',
    icon: FileText,
    title: 'GST bills your CA will recognize',
    benefit: 'Templates, HSN, and line-level tax that stay consistent from counter to GSTR work.',
  },
  {
    id: 'solution-customers',
    icon: Users,
    title: 'Know who owes you before you open the register',
    benefit: 'Credit, outstanding, and contact history in one place — not across three diaries.',
  },
  {
    id: 'solution-inventory',
    icon: Package,
    title: 'Stock that updates when you actually sell',
    benefit: 'Fewer “phantom” items on the shelf; clearer reorder points for busy SKUs.',
  },
  {
    id: 'solution-whatsapp',
    icon: MessageCircle,
    title: 'Invoices in the same chat your customer checks daily',
    benefit: 'Share bills and nudges on WhatsApp without copy-paste mistakes.',
  },
  {
    id: 'solution-thermal',
    icon: Printer,
    title: 'Print that matches how counters move',
    benefit: '58mm & 80mm thermal support for tight spaces and long queues.',
  },
  {
    id: 'solution-gst-reports',
    icon: FileSpreadsheet,
    title: 'File GST in minutes, not in panic mode',
    benefit: 'GSTR-1 / GSTR-3B style exports to reduce confusion before you upload to the portal.',
  },
];

export function LandingKeyFeatures() {
  return (
    <section className="scroll-mt-24 border-t border-slate-200/80 bg-slate-50/90 py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">Everything in one app — explained by outcomes</h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            Jump deeper from the same spots linked in the menu above: billing, people, stock, and filing.
          </p>
        </div>
        <div
          className={`mt-12 grid w-full grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-8 2xl:mt-14 2xl:gap-10 ${LANDING_MAX_WIDE}`}
        >
          {FEATURES.map(({ id, icon: Icon, title, benefit }) => (
            <div
              key={id}
              id={id}
              className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md 2xl:p-8 2xl:shadow"
            >
              <Icon
                className="h-10 w-10 text-slate-700 2xl:h-12 2xl:w-12"
                strokeWidth={1.5}
                aria-hidden
              />
              <h3 className="mt-4 text-lg font-bold text-slate-900 2xl:text-xl">{title}</h3>
              <p className="mt-2 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{benefit}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
