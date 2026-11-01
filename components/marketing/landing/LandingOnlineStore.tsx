'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

export type LandingOnlineStoreContent = {
  kicker: string;
  heading: string;
  intro: string;
  points: { title: string; text: string }[];
  ctaLabel: string;
  ctaHref: string;
};

export const LANDING_ONLINE_STORE_DEFAULTS: LandingOnlineStoreContent = {
  kicker: 'Online store',
  heading: 'Put your shop online. Orders arrive as bills.',
  intro:
    'Your item list becomes a store with your name and logo. Customers order from their phone, and each order turns into a proper GST bill on the screen you already bill on.',
  points: [
    { title: 'Ready-made store themes', text: 'pick one, add your logo, apply it in a click' },
    { title: 'One link', text: 'to share on WhatsApp, Instagram and Google' },
    { title: 'Orders become tax invoices', text: 'with coupons and delivery charges taxed correctly' },
    { title: 'No overselling', text: 'online orders hold stock, so the counter and the store never sell the same pack twice' },
  ],
  ctaLabel: 'Explore store themes',
  ctaHref: '/themes',
};

const SAMPLE_ITEMS = [
  { name: 'Basmati Rice 5kg', price: '₹590', tint: 'bg-stone-100' },
  { name: 'Sunflower Oil 1L', price: '₹145', tint: 'bg-amber-50' },
  { name: 'Toor Dal 1kg', price: '₹165', tint: 'bg-accent-50' },
  { name: 'Wheat Atta 10kg', price: '₹460', tint: 'bg-emerald-50' },
];

/** A phone showing a sample storefront. Illustration only: the names and prices are sample data. */
function StorePhone() {
  return (
    <div className="relative mx-auto w-full max-w-[18rem] rounded-[2.4rem] bg-slate-900 p-2.5 shadow-2xl shadow-slate-900/15">
      <div className="flex min-h-[34rem] flex-col overflow-hidden rounded-[1.9rem] bg-white">
        <div className="bg-primary-600 px-4 pb-4 pt-5 text-white">
          <p className="font-bold">Shree Ganesh Traders</p>
          <p className="text-xs text-primary-100">FC Road, Pune · Order on WhatsApp or online</p>
          <p className="mt-3 rounded-lg bg-white px-3 py-2 text-[13px] text-slate-500">Search rice, oil, dal…</p>
        </div>
        <div className="flex gap-1.5 overflow-hidden px-3 py-3 text-xs font-semibold">
          <span className="whitespace-nowrap rounded-full bg-primary-600 px-3 py-1.5 text-white">Staples</span>
          <span className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5 text-slate-800">Snacks</span>
          <span className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5 text-slate-800">Beverages</span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2.5 px-3">
          {SAMPLE_ITEMS.map((it) => (
            <div key={it.name} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-2">
              <div className={`h-16 rounded-lg ${it.tint}`} aria-hidden />
              <p className="text-xs font-semibold text-slate-900">{it.name}</p>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-extrabold text-slate-900">{it.price}</span>
                <span className="rounded-md border border-emerald-700 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  ADD
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="m-3 flex justify-between rounded-xl bg-emerald-700 px-4 py-3 text-[13px] font-semibold text-white">
          <span>3 items · ₹900</span>
          <span>Place order →</span>
        </div>
      </div>
    </div>
  );
}

export function LandingOnlineStore(props: Partial<LandingOnlineStoreContent> = {}) {
  const c = withDefaults(LANDING_ONLINE_STORE_DEFAULTS, props);
  return (
    <section id="store" className="scroll-mt-24 bg-[#FBF7F0] py-20 2xl:py-28">
      <div className={`${LANDING_PAGE_GUTTER} grid items-center gap-14 lg:grid-cols-[1fr_0.9fr]`}>
        <div>
          <LandingSectionHead kicker={c.kicker} heading={c.heading} intro={c.intro} />
          <ul className="mt-7 space-y-3.5">
            {c.points.map((p) => (
              <li key={p.title} className="flex gap-3 text-[16px] leading-relaxed text-slate-700">
                <Check className="mt-1 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  <strong className="text-slate-900">{p.title}</strong> {p.text}
                </span>
              </li>
            ))}
          </ul>
          {c.ctaLabel && (
            <Link
              href={c.ctaHref || '/themes'}
              className="mt-8 inline-flex min-h-[48px] items-center rounded-xl bg-primary-600 px-6 text-base font-semibold text-white transition hover:bg-primary-700"
            >
              {c.ctaLabel}
            </Link>
          )}
        </div>
        <div className="relative py-6">
          <div className="absolute inset-x-6 bottom-0 top-12 rounded-[2rem] bg-accent-500" aria-hidden />
          <StorePhone />
          <div className="absolute right-0 top-20 hidden rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xl sm:block">
            <p className="text-xs text-slate-600">New online order</p>
            <p className="font-bold text-slate-900">#W-218 → Bill INV-1043</p>
          </div>
        </div>
      </div>
    </section>
  );
}
