import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, Mail } from 'lucide-react';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { LandingFooter } from '@/components/marketing/landing/LandingFooter';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { publicSiteUrl } from '@/lib/blog/site';
import { getPublicSupportConfig } from '@/lib/marketing-public-config';
import { KHATARIO_BRAND_DESCRIPTION, khatarioOrganizationJsonLd } from '@/lib/marketing/brand-structured-data';

const TITLE = 'About Khatario | GST Billing App for Indian Shops';
const DESCRIPTION =
  'Khatario is a GST billing app made in India for shops and small businesses: GST bills on WhatsApp, stock, udhaar, accounting and an online store. Free to start.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Khatario', images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/** Only what the product does today; keep in step with the home page and the guides. */
const WHAT_IT_DOES: { title: string; body: string; href: string }[] = [
  {
    title: 'GST billing',
    body: 'Make a GST bill in seconds, share it on WhatsApp and collect by UPI. Bills print in 13 languages.',
    href: '/guides',
  },
  {
    title: 'Stock',
    body: 'Stock goes up with every purchase and down with every sale, so you always know what is on the shelf.',
    href: '/solution/inventory',
  },
  {
    title: 'Accounts and GST reports',
    body: 'Books update from every bill, purchase and expense. GSTR-1 and GSTR-3B data are ready when you file.',
    href: '/solution/accounting',
  },
  {
    title: 'Online store',
    body: 'Put your catalogue online with a mobile-first store theme and take orders from your customers.',
    href: '/themes',
  },
];

export default function AboutPage() {
  const site = publicSiteUrl();
  const support = getPublicSupportConfig();
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      khatarioOrganizationJsonLd(site),
      {
        '@type': 'AboutPage',
        '@id': `${site}/about#webpage`,
        url: `${site}/about`,
        name: TITLE,
        description: DESCRIPTION,
        inLanguage: 'en-IN',
        about: { '@id': `${site}/#organization` },
        isPartOf: { '@id': `${site}/#website` },
      },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <MarketingSiteHeader />
      <main>
        <section className="border-b border-slate-200/80 bg-white pb-14 pt-28 md:pb-16 md:pt-32">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <div className="max-w-3xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                <BadgeCheck className="h-4 w-4 text-primary-600" aria-hidden />
                Made in India
              </p>
              <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">About Khatario</h1>
              <p className="mt-5 text-lg leading-relaxed text-slate-600 sm:text-xl">{KHATARIO_BRAND_DESCRIPTION}</p>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Khatario is built for shop owners who bill at the counter: kirana, medical, hardware, mobile, clothing
                and other small businesses. You can start on the free plan with unlimited GST bills and no card, and
                use the same account on your phone and your computer.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-14 md:py-16">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">What the Khatario billing app does</h2>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {WHAT_IT_DOES.map((item) => (
                <li key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-slate-600">{item.body}</p>
                  <Link href={item.href} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800">
                    Learn more <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="bg-white py-14 md:py-16">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <div className="max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Contact Khatario</h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Questions about your account, plans or switching from another billing app? Write to us or book a free
                demo and we will walk you through it.
              </p>
              {support.email && (
                <p className="mt-4 flex items-center gap-2 text-base text-slate-700">
                  <Mail className="h-5 w-5 text-slate-500" aria-hidden />
                  <a href={`mailto:${support.email}`} className="font-semibold text-primary-700 hover:text-primary-800">
                    {support.email}
                  </a>
                  <span className="text-slate-500">· {support.hours}</span>
                </p>
              )}
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
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
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
