'use client';

import {
  LANDING_INTRO_SUBTEXT,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { MarketingIcon } from '@/components/marketing/builder/icons';
import { MarketingImg } from '@/components/marketing/builder/MarketingImg';
import { cleanAnchor } from '@/components/marketing/builder/blocks/tone';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type KeyFeatureItem = {
  anchor: string;
  icon: string;
  title: string;
  benefit: string;
  tag: string;
  href: string;
};

export type LandingKeyFeaturesContent = {
  heading: string;
  subtext: string;
  image: string;
  imageAlt: string;
  caption: string;
  features: KeyFeatureItem[];
};

export const LANDING_KEY_FEATURES_DEFAULTS: LandingKeyFeaturesContent = {
  heading: 'Everything in one app',
  subtext: 'Billing, customers, stock, WhatsApp, GST and your online store — one login, one set of numbers.',
  image: '/marketing/screens/dashboard.png',
  imageAlt:
    "Khatario dashboard showing this month's sales, collection, purchases, profit and a daily sales chart",
  caption: 'The dashboard of a Pune kirana store: sales, collections and profit for the month at a glance.',
  features: [
    {
      anchor: 'solution-invoicing',
      icon: 'fileText',
      title: 'GST bills your CA will recognize',
      benefit: 'Templates, HSN, and line-level tax that stay consistent from counter to GSTR work.',
      tag: '',
      href: '',
    },
    {
      anchor: 'solution-customers',
      icon: 'users',
      title: 'Know who owes you before you open the register',
      benefit: 'Credit, outstanding, and contact history in one place — not across three diaries.',
      tag: '',
      href: '',
    },
    {
      anchor: 'solution-inventory',
      icon: 'package',
      title: 'Stock that updates when you actually sell',
      benefit: 'Fewer “phantom” items on the shelf; clearer reorder points for busy SKUs.',
      tag: '',
      href: '',
    },
    {
      anchor: 'solution-whatsapp',
      icon: 'message',
      title: 'Invoices in the chat your customer checks daily',
      benefit: 'Share bills and nudges on WhatsApp without copy-paste mistakes.',
      tag: '',
      href: '',
    },
    {
      anchor: 'solution-thermal',
      icon: 'printer',
      title: 'Print that matches how counters move',
      benefit: '58mm & 80mm thermal support for tight spaces and long queues.',
      tag: '',
      href: '',
    },
    {
      anchor: 'solution-gst-reports',
      icon: 'spreadsheet',
      title: 'File GST in minutes, not in panic mode',
      benefit: 'GSTR-1 and GSTR-3B views and exports that match what you already billed.',
      tag: '',
      href: '',
    },
    {
      anchor: 'solution-online-store',
      icon: 'store',
      title: 'Your own online store',
      benefit:
        'A shop page customers can browse and order from on their phone — items, prices and stock come straight from your billing.',
      tag: 'Enterprise plan',
      href: '',
    },
    {
      anchor: 'solution-supply',
      icon: 'truck',
      title: 'Suppliers see your low stock early',
      benefit:
        'Connected suppliers get restock requests when fast movers run low — fewer empty racks and phone calls.',
      tag: 'Shops & suppliers',
      href: '#connected-supply',
    },
  ],
};

export function LandingKeyFeatures(props: Partial<LandingKeyFeaturesContent> = {}) {
  const c = withDefaults(LANDING_KEY_FEATURES_DEFAULTS, props);
  return (
    <section className="scroll-mt-24 border-t border-slate-200/80 bg-slate-50/90 py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal>
          <div className={LANDING_SECTION_INTRO}>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
              {c.heading}
            </h2>
            {c.subtext && <p className={LANDING_INTRO_SUBTEXT}>{c.subtext}</p>}
          </div>
        </LandingReveal>

        <div className="mt-12 grid w-full items-start gap-10 lg:grid-cols-12 lg:gap-12 2xl:mt-14 2xl:gap-16">
          {c.image && (
            <LandingReveal className="lg:sticky lg:top-28 lg:col-span-5">
              <figure>
                <div className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
                  <MarketingImg
                    src={c.image}
                    alt={c.imageAlt}
                    fill
                    sizes="(min-width: 1024px) 42vw, 100vw"
                    className="object-cover object-left-top"
                  />
                </div>
                {c.caption && <figcaption className="mt-3 text-sm text-slate-600">{c.caption}</figcaption>}
              </figure>
            </LandingReveal>
          )}

          <ul className={`grid gap-x-8 gap-y-7 sm:grid-cols-2 ${c.image ? 'lg:col-span-7' : 'lg:col-span-12 lg:grid-cols-4'}`}>
            {c.features.map(({ anchor, icon, title, benefit, tag, href }, i) => (
              <LandingReveal
                key={`${title}-${i}`}
                id={cleanAnchor(anchor)}
                as="li"
                delay={i * 50}
                className="flex scroll-mt-24 gap-4"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-primary-700 shadow-sm ring-1 ring-slate-200">
                  <MarketingIcon name={icon} className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-bold leading-snug text-slate-900 2xl:text-lg">
                    {href ? (
                      <a href={href} className="hover:text-primary-700 hover:underline">
                        {title}
                      </a>
                    ) : (
                      title
                    )}
                  </h3>
                  {tag && (
                    <span className="mt-1 inline-block rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                      {tag}
                    </span>
                  )}
                  <p className="mt-1.5 text-slate-600 2xl:text-lg 2xl:leading-relaxed">{benefit}</p>
                </div>
              </LandingReveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
