'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { MarketingImg } from '@/components/marketing/builder/MarketingImg';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

export type LandingProductTourContent = {
  kicker: string;
  heading: string;
  /** `points`: one tick point per line. */
  tabs: { label: string; title: string; text: string; points: string; image: string; imageAlt: string }[];
};

export const LANDING_PRODUCT_TOUR_DEFAULTS: LandingProductTourContent = {
  kicker: 'See it working',
  heading: 'Everything the counter needs, on one screen',
  tabs: [
    {
      label: 'Billing',
      title: 'A GST bill in seconds',
      text: 'Pick an item or scan its barcode. HSN and GST fill in by themselves, and Save & Send prints it or sends it on WhatsApp.',
      points: 'HSN and tax rate come from the item\nCGST, SGST or IGST from the place of supply\nThermal, A4 or WhatsApp in one tap',
      image: '/marketing/screens/invoice-new.png',
      imageAlt: 'Khatario new invoice screen with items, HSN codes, tax and totals',
    },
    {
      label: 'Payments',
      title: 'Know who has paid',
      text: 'Every bill shows paid or unpaid, and dues are tracked per customer so you know whom to remind.',
      points: 'Paid and unpaid at a glance\nUPI QR and payment link on the bill\nCustomer ledger and outstanding',
      image: '/marketing/screens/invoices-list.png',
      imageAlt: 'Khatario invoice list with paid and unpaid status for each bill',
    },
    {
      label: 'GST reports',
      title: 'Hand your CA a clean file',
      text: 'GSTR-1 is built from your bills, with B2B, B2C and HSN summary already split out.',
      points: 'Export Excel or JSON for the GST portal\nHSN summary done for you\nMark the month as filed',
      image: '/marketing/screens/gstr1.png',
      imageAlt: 'Khatario GSTR-1 report with taxable value, tax and B2B invoices',
    },
    {
      label: 'Dashboard',
      title: 'Your shop in one look',
      text: 'Sales, collection, purchases and profit for the month, with a day-by-day sales chart.',
      points: 'This month’s sales and profit\nDaily sales chart\nSame numbers on phone and computer',
      image: '/marketing/screens/dashboard.png',
      imageAlt: 'Khatario dashboard with sales, collection, purchases, profit and a daily sales chart',
    },
  ],
};

export function LandingProductTour(props: Partial<LandingProductTourContent> = {}) {
  const c = withDefaults(LANDING_PRODUCT_TOUR_DEFAULTS, props);
  const [active, setActive] = useState(0);
  const tab = c.tabs[Math.min(active, c.tabs.length - 1)];
  if (!tab) return null;

  return (
    <section id="tour" className="scroll-mt-24 bg-primary-50 py-20 2xl:py-28">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingSectionHead kicker={c.kicker} heading={c.heading} />
        <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Product tour">
          {c.tabs.map((t, i) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              id={`tour-tab-${i}`}
              aria-selected={i === active}
              aria-controls="tour-panel"
              onClick={() => setActive(i)}
              className={clsx(
                'min-h-[44px] rounded-full border px-5 text-[15px] font-semibold transition',
                i === active
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-slate-300 bg-white text-slate-800 hover:border-primary-600',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          id="tour-panel"
          role="tabpanel"
          aria-labelledby={`tour-tab-${active}`}
          className="mt-6 grid items-center gap-10 lg:grid-cols-[1.7fr_1fr]"
        >
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15">
            <div className="flex gap-1.5 border-b border-slate-200 px-4 py-3" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            </div>
            <MarketingImg
              key={tab.image}
              src={tab.image}
              alt={tab.imageAlt}
              width={2880}
              height={1800}
              sizes="(min-width: 1024px) 62vw, 100vw"
            />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-slate-900 2xl:text-3xl">{tab.title}</h3>
            <p className="mt-3 text-[17px] leading-relaxed text-slate-600">{tab.text}</p>
            <ul className="mt-5 space-y-3">
              {(tab.points ?? '')
                .split('\n')
                .map((p) => p.trim())
                .filter(Boolean)
                .map((p) => (
                  <li key={p} className="flex gap-3 text-[16px] text-slate-800">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                    {p}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
