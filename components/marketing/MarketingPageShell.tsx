import type { ReactNode } from 'react';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { LandingFooter } from '@/components/marketing/landing/LandingFooter';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';

export function MarketingPageShell({
  title,
  intro,
  eyebrow,
  children,
}: {
  title: string;
  intro?: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />
      <main>
        <section className="border-b border-slate-200/80 bg-white pb-14 pt-28 md:pb-16 md:pt-32">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <div className="max-w-3xl">
              {eyebrow && (
                <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                  {eyebrow}
                </p>
              )}
              <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">{title}</h1>
              {intro && <p className="mt-5 text-lg leading-relaxed text-slate-600 sm:text-xl">{intro}</p>}
            </div>
          </div>
        </section>
        {children}
      </main>
      <LandingFooter />
    </div>
  );
}
