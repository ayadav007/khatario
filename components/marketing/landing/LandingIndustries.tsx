'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import {
  ArrowRight,
  Hammer,
  Pill,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Truck,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

type IndustryIcon = 'grocery' | 'pharmacy' | 'clothing' | 'mobile' | 'hardware' | 'restaurant' | 'wholesale' | 'services';

export type LandingIndustriesContent = {
  kicker: string;
  heading: string;
  intro: string;
  /** `href` empty = a plain card until that industry page exists. */
  /** `tags`: short labels separated by commas, shown as chips. */
  industries: { icon: IndustryIcon; name: string; text: string; tags: string; href: string }[];
};

export const LANDING_INDUSTRIES_DEFAULTS: LandingIndustriesContent = {
  kicker: 'Built for your trade',
  heading: 'Billing software for every kind of shop',
  intro: 'One app, set up the way your trade actually bills.',
  industries: [
    { icon: 'grocery', name: 'Grocery & kirana', text: 'Loose items by weight, quick barcode billing, udhaar tracking.', tags: 'Sell by kg, Udhaar', href: '' },
    { icon: 'pharmacy', name: 'Pharmacy & medical', text: 'Batch, expiry and MRP on every strip, alerts before stock expires.', tags: 'Batch & expiry, MRP', href: '' },
    { icon: 'clothing', name: 'Clothing & footwear', text: 'Sizes and colours as variants, barcode labels, exchange slips.', tags: 'Size & colour, Labels', href: '' },
    { icon: 'mobile', name: 'Mobile & electronics', text: 'IMEI and serial numbers, warranty on the bill.', tags: 'IMEI, Warranty', href: '' },
    { icon: 'hardware', name: 'Hardware & paints', text: 'Box, piece and kg on one item. Contractor credit.', tags: 'Multi-unit, Credit', href: '' },
    { icon: 'restaurant', name: 'Restaurant & cafe', text: 'Table billing and thermal receipts that print fast.', tags: 'Tables, 80mm print', href: '' },
    { icon: 'wholesale', name: 'Wholesale & distribution', text: 'Party-wise rates, delivery challans, e-way bills, outstanding.', tags: 'Challans, E-way bill', href: '' },
    { icon: 'services', name: 'Services & repairs', text: 'Work orders, service bills and customer history.', tags: 'Work orders, History', href: '' },
  ],
};

/** Full class strings per trade so Tailwind keeps them: card wash, icon tile, watermark, chip text. */
const LOOKS: Record<IndustryIcon, { icon: LucideIcon; card: string; tile: string; mark: string; chip: string }> = {
  grocery: { icon: ShoppingBasket, card: 'bg-emerald-50 border-emerald-100 hover:border-emerald-300', tile: 'bg-emerald-600', mark: 'text-emerald-200/70', chip: 'text-emerald-800' },
  pharmacy: { icon: Pill, card: 'bg-sky-50 border-sky-100 hover:border-sky-300', tile: 'bg-sky-600', mark: 'text-sky-200/70', chip: 'text-sky-800' },
  clothing: { icon: Shirt, card: 'bg-rose-50 border-rose-100 hover:border-rose-300', tile: 'bg-rose-500', mark: 'text-rose-200/70', chip: 'text-rose-800' },
  mobile: { icon: Smartphone, card: 'bg-violet-50 border-violet-100 hover:border-violet-300', tile: 'bg-violet-600', mark: 'text-violet-200/70', chip: 'text-violet-800' },
  hardware: { icon: Hammer, card: 'bg-amber-50 border-amber-100 hover:border-amber-300', tile: 'bg-amber-600', mark: 'text-amber-200/70', chip: 'text-amber-900' },
  restaurant: { icon: UtensilsCrossed, card: 'bg-orange-50 border-orange-100 hover:border-orange-300', tile: 'bg-orange-500', mark: 'text-orange-200/70', chip: 'text-orange-800' },
  wholesale: { icon: Truck, card: 'bg-teal-50 border-teal-100 hover:border-teal-300', tile: 'bg-teal-600', mark: 'text-teal-200/70', chip: 'text-teal-800' },
  services: { icon: Wrench, card: 'bg-indigo-50 border-indigo-100 hover:border-indigo-300', tile: 'bg-indigo-600', mark: 'text-indigo-200/70', chip: 'text-indigo-800' },
};

function tagList(tags: string | undefined): string[] {
  return (tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
}

export function LandingIndustries(props: Partial<LandingIndustriesContent> = {}) {
  const c = withDefaults(LANDING_INDUSTRIES_DEFAULTS, props);
  return (
    <section id="industries" className="scroll-mt-24 bg-[#FBF7F0] py-20 2xl:py-28">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingSectionHead kicker={c.kicker} heading={c.heading} intro={c.intro} />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {c.industries.map((it, i) => {
            const look = LOOKS[it.icon] ?? LOOKS.services;
            const Icon = look.icon;
            const body = (
              <>
                <Icon
                  className={clsx('pointer-events-none absolute -bottom-6 -right-6 h-32 w-32 rotate-[-12deg]', look.mark)}
                  strokeWidth={1.5}
                  aria-hidden
                />
                <span
                  className={clsx(
                    'relative grid h-12 w-12 place-items-center rounded-2xl text-white shadow-lg shadow-slate-900/10 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110',
                    look.tile,
                  )}
                >
                  <Icon className="h-6 w-6" strokeWidth={2} aria-hidden />
                </span>
                <span className="relative mt-1 text-lg font-bold text-slate-900">{it.name}</span>
                <span className="relative text-[15px] leading-relaxed text-slate-700">{it.text}</span>
                {tagList(it.tags).length > 0 && (
                  <span className="relative mt-auto flex flex-wrap gap-1.5 pt-2">
                    {tagList(it.tags).map((tag) => (
                      <span
                        key={tag}
                        className={clsx('rounded-full bg-white px-2.5 py-1 text-xs font-semibold shadow-sm', look.chip)}
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
                {it.href && (
                  <span className="relative inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
                    See how it works <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                )}
              </>
            );
            const cls = clsx(
              'group relative flex h-full flex-col gap-2 overflow-hidden rounded-2xl border p-6 transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/10',
              look.card,
            );
            return (
              <LandingReveal key={it.name} delay={(i % 4) * 60}>
                {it.href ? (
                  <Link href={it.href} className={cls}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </LandingReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
