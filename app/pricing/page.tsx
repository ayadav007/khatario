import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowRight } from 'lucide-react';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { LandingFooter } from '@/components/marketing/landing/LandingFooter';
import { PricingPageBody, PricingPlans } from '@/components/marketing/pricing/PricingPageBody';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { splitLegalLinks } from '@/lib/marketing/legal/links';
import {
  PRICING_BILLING_QUESTIONS,
  loadPricingCatalogOrNull,
  pricingFaqJsonLd,
} from '@/lib/marketing/pricing-page';

export const revalidate = 300;

const TITLE = 'Khatario Pricing | Free Plan and Paid Plans for Shops';
const DESCRIPTION =
  'See every Khatario plan for billing, staff and WhatsApp marketing. Start on the free plan and pay when the shop grows.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/pricing' },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Khatario', images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const LINK_CLASS = 'font-semibold text-primary-700 underline hover:text-primary-800';

function AnswerText({ text }: { text: string }) {
  return (
    <>
      {splitLegalLinks(text).map((part, i) =>
        typeof part === 'string' ? (
          <span key={i}>{part}</span>
        ) : (
          <Link key={i} href={part.href} className={LINK_CLASS}>
            {part.label}
          </Link>
        ),
      )}
    </>
  );
}

export default async function PricingPage() {
  const pricingCatalog = await loadPricingCatalogOrNull();
  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingFaqJsonLd(PRICING_BILLING_QUESTIONS)) }}
      />
      <MarketingSiteHeader />
      <main className="pt-20">
        <h1 className="sr-only">Khatario pricing</h1>
        <Suspense fallback={<PricingPlans pricingCatalog={pricingCatalog} initialProductLine="billing" />}>
          <PricingPageBody pricingCatalog={pricingCatalog} />
        </Suspense>

        <section className="bg-slate-50 py-14">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <div className="max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Billing questions</h2>
              <div className="mt-8 space-y-6">
                {PRICING_BILLING_QUESTIONS.map((q) => (
                  <div key={q.id}>
                    <h3 className="text-lg font-semibold text-slate-900">{q.question}</h3>
                    <p className="mt-2 text-base leading-relaxed text-slate-600">
                      <AnswerText text={q.answer} />
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white py-14">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-8 py-3.5 text-base font-semibold text-white shadow-md transition hover:bg-primary-700"
              >
                Start free
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
              <Link
                href="/book-demo"
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-8 py-3.5 text-base font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
              >
                Book a demo
              </Link>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
