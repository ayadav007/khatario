'use client';

import { clsx } from 'clsx';
import type { ReactNode, RefObject } from 'react';
import { BookOpen, LayoutDashboard, Package, Receipt, ScanLine } from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { MarketingImg } from '@/components/marketing/builder/MarketingImg';
import { useInViewOnce } from '@/hooks/useInViewOnce';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type LandingFeatureBentoContent = {
  kicker: string;
  heading: string;
  subtext: string;
  dashboardTitle: string;
  dashboardText: string;
  dashboardImage: string;
  dashboardAlt: string;
  gstTitle: string;
  gstText: string;
  scanTitle: string;
  scanText: string;
  stockTitle: string;
  stockText: string;
  booksTitle: string;
  booksText: string;
};

export const LANDING_FEATURE_BENTO_DEFAULTS: LandingFeatureBentoContent = {
  kicker: 'Features',
  heading: 'One app, one set of numbers.',
  subtext: 'Billing, stock, purchases, payments, GST and proper books, so you stop keeping a second register.',
  dashboardTitle: 'Know your day before you open the shutter',
  dashboardText: 'Sales, collections, purchases and profit for the month on one screen.',
  dashboardImage: '/marketing/screens/dashboard.png',
  dashboardAlt: "Khatario dashboard showing this month's sales, collections, purchases and profit",
  gstTitle: 'GST without the month-end panic',
  gstText: 'Returns build themselves from your bills, and 2B is matched against your purchases.',
  scanTitle: 'Snap a supplier bill',
  scanText: 'Photograph a GST purchase bill. Items, HSN and tax are filled in for you to check.',
  stockTitle: 'Stock that moves with every bill',
  stockText: 'Batch and expiry, serial numbers, barcode labels, warehouses and dead-stock alerts.',
  booksTitle: 'Real books, not just bills',
  booksText: 'Ledger, bank reconciliation, TDS/TCS, P&L, balance sheet and cash flow your CA will recognise.',
};

const PILL = {
  ok: 'bg-green-100 text-green-700',
  warn: 'bg-accent-100 text-accent-700',
  info: 'bg-primary-50 text-primary-600',
} as const;

function StatusRow({ label, value, tone }: { label: string; value: string; tone: keyof typeof PILL }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm">
      <span className="text-slate-700">{label}</span>
      <span className={clsx('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', PILL[tone])}>{value}</span>
    </div>
  );
}

function Tile({
  icon,
  title,
  text,
  className,
  delay,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  className?: string;
  delay?: number;
  children?: ReactNode;
}) {
  return (
    <LandingReveal delay={delay} className={clsx('min-w-0', className)}>
      <article className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-3xl border border-slate-200 bg-white p-7 transition duration-300 hover:-translate-y-1.5 hover:border-primary-100 hover:shadow-xl motion-reduce:hover:translate-y-0">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-50 text-primary-600">{icon}</span>
        <h3 className="text-xl font-bold tracking-tight text-slate-900 2xl:text-2xl">{title}</h3>
        <p className="text-[15px] leading-relaxed text-slate-600">{text}</p>
        {children}
      </article>
    </LandingReveal>
  );
}

const BAR_HEIGHTS = [40, 65, 30, 85, 55, 95, 45, 70];

function StockBars() {
  const { ref, inView } = useInViewOnce({ threshold: 0.4 });
  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="mt-auto flex h-28 items-end gap-2 pt-3" aria-hidden>
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="flex-1 origin-bottom rounded-t-md bg-gradient-to-b from-green-400 to-green-600 transition-transform duration-1000 ease-out motion-reduce:transition-none"
          style={{ height: `${h}%`, transform: inView ? 'scaleY(1)' : 'scaleY(0.05)', transitionDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

export function LandingFeatureBento(props: Partial<LandingFeatureBentoContent> = {}) {
  const c = withDefaults(LANDING_FEATURE_BENTO_DEFAULTS, props);
  return (
    <section id="features" className="scroll-mt-24 bg-white py-20 2xl:py-28">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal className={LANDING_SECTION_INTRO}>
          {c.kicker && <p className="landing-kicker">{c.kicker}</p>}
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">{c.heading}</h2>
          {c.subtext && <p className={LANDING_INTRO_SUBTEXT}>{c.subtext}</p>}
        </LandingReveal>

        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-12 2xl:gap-6">
          <Tile className="lg:col-span-7" icon={<LayoutDashboard className="h-5 w-5" />} title={c.dashboardTitle} text={c.dashboardText}>
            {c.dashboardImage && (
              <div className="relative -mb-7 -mr-7 ml-4 mt-3 aspect-[16/10] overflow-hidden rounded-tl-2xl border border-slate-200 shadow-lg transition-transform duration-500 group-hover:-translate-x-1.5 group-hover:-translate-y-1.5 sm:ml-8">
                <MarketingImg src={c.dashboardImage} alt={c.dashboardAlt} fill sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover object-left-top" />
              </div>
            )}
          </Tile>
          <Tile className="lg:col-span-5" delay={80} icon={<Receipt className="h-5 w-5" />} title={c.gstTitle} text={c.gstText}>
            <div className="mt-auto space-y-2 pt-3">
              <StatusRow label="GSTR-1 · September" value="Ready to file" tone="ok" />
              <StatusRow label="GSTR-2B vs purchases" value="3 to check" tone="warn" />
              <StatusRow label="GSTR-3B due" value="20 Oct" tone="info" />
            </div>
          </Tile>
          <Tile className="lg:col-span-4" icon={<ScanLine className="h-5 w-5" />} title={c.scanTitle} text={c.scanText}>
            <div className="relative mt-auto overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-4" aria-hidden>
              <span className="landing-scan-beam pointer-events-none absolute inset-x-0 h-9 border-b-2 border-accent-500 bg-gradient-to-b from-transparent to-accent-500/30" />
              <div className="space-y-2">
                {[60, 100, 85, 70, 100].map((w, i) => (
                  <span key={i} className="block h-2 rounded bg-slate-200" style={{ width: `${w}%` }} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-bold', PILL.ok)}>12 items read</span>
                <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-bold', PILL.info)}>GSTIN matched</span>
              </div>
            </div>
          </Tile>
          <Tile className="lg:col-span-4" delay={80} icon={<Package className="h-5 w-5" />} title={c.stockTitle} text={c.stockText}>
            <StockBars />
          </Tile>
          <Tile className="lg:col-span-4" delay={160} icon={<BookOpen className="h-5 w-5" />} title={c.booksTitle} text={c.booksText}>
            <div className="mt-auto space-y-2 pt-3">
              <StatusRow label="Bank lines matched" value="142 / 147" tone="ok" />
              <StatusRow label="Trial balance" value="Balanced" tone="info" />
            </div>
          </Tile>
        </div>
      </div>
    </section>
  );
}
