'use client';

import { clsx } from 'clsx';
import { FileText, MessageCircle, Store, Users, type LucideIcon } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

export type LandingSuiteContent = {
  kicker: string;
  heading: string;
  intro: string;
  products: { title: string; text: string; tag: string; href: string }[];
};

export const LANDING_SUITE_DEFAULTS: LandingSuiteContent = {
  kicker: 'One app for the whole shop',
  heading: 'Bill, sell online, bring customers back, run your staff',
  intro:
    'Other apps stop at the bill. In Khatario the same items, customers and stock run your online store, your WhatsApp offers and your staff attendance.',
  products: [
    { title: 'Billing & GST', text: 'GST bills, stock, accounts, UPI collection and GSTR files for your CA.', tag: 'Free plan', href: '#tour' },
    { title: 'Online store', text: 'Your items as a store with your name. Orders arrive as bills.', tag: 'Store themes', href: '#store' },
    { title: 'WhatsApp marketing', text: 'Festival offers, a shared inbox and AI replies on your own Meta account. No markup on messages.', tag: 'Khatario Connect', href: '#whatsapp' },
    { title: 'Staff & HR', text: 'Phone check-in that can’t be faked, payroll from attendance, leave.', tag: 'Free up to 30 staff', href: '#staff' },
  ],
};

const ICONS: LucideIcon[] = [FileText, Store, MessageCircle, Users];
const TINTS = ['bg-white/10 text-white', 'bg-accent-50 text-accent-700', 'bg-emerald-50 text-emerald-700', 'bg-sky-50 text-sky-800'];

export function LandingSuite(props: Partial<LandingSuiteContent> = {}) {
  const c = withDefaults(LANDING_SUITE_DEFAULTS, props);
  return (
    <section id="products" className="scroll-mt-24 bg-white py-20 2xl:py-28">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingSectionHead kicker={c.kicker} heading={c.heading} intro={c.intro} />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {c.products.map((p, i) => {
            const Icon = ICONS[i % ICONS.length];
            const first = i === 0;
            return (
              <LandingReveal key={p.title} delay={i * 70}>
                <a
                  href={p.href}
                  className={clsx(
                    'group flex h-full flex-col gap-3 rounded-2xl border p-6 transition hover:-translate-y-0.5 hover:shadow-lg',
                    first ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-200 bg-white text-slate-900',
                  )}
                >
                  <span className={clsx('grid h-12 w-12 place-items-center rounded-xl', TINTS[i % TINTS.length])}>
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
                  <span className="text-xl font-bold">{p.title}</span>
                  <span className={clsx('text-[15px] leading-relaxed', first ? 'text-primary-100' : 'text-slate-600')}>
                    {p.text}
                  </span>
                  {p.tag && (
                    <span
                      className={clsx(
                        'mt-auto self-start rounded-full px-3 py-1 text-xs font-bold',
                        first ? 'bg-accent-500 text-slate-950' : 'bg-slate-100 text-slate-800',
                      )}
                    >
                      {p.tag}
                    </span>
                  )}
                </a>
              </LandingReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
