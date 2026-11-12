import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { LandingFooter } from '@/components/marketing/landing/LandingFooter';
import { FreeToolPageBody } from '@/components/tools/FreeToolPageBody';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { publicSiteUrl } from '@/lib/blog/site';
import { khatarioOrganizationJsonLd } from '@/lib/marketing/brand-structured-data';
import { splitLegalLinks } from '@/lib/marketing/legal/links';
import { FREE_TOOLS, getFreeTool, type FreeTool } from '@/lib/tools/catalogue';
import { RATES_CHECKED_ON } from '@/lib/tools/tds-rates';
import { ratesAsOfLine, toolIcon, toolPageJsonLd, toolPageMetadata } from '@/lib/tools/tool-page-seo';

export const dynamicParams = false;

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return FREE_TOOLS.map((t) => ({ slug: t.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const tool = getFreeTool(params.slug);
  return tool ? toolPageMetadata(tool) : {};
}

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

export default function FreeToolPage({ params }: Props) {
  const tool = getFreeTool(params.slug);
  if (!tool) notFound();

  const site = publicSiteUrl();
  const { '@context': context, '@graph': graph } = toolPageJsonLd(tool, site) as { '@context': string; '@graph': unknown[] };
  const structuredData = { '@context': context, '@graph': [khatarioOrganizationJsonLd(site), ...graph] };
  const related = tool.related.map((slug) => getFreeTool(slug)).filter((t): t is FreeTool => Boolean(t));

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <MarketingSiteHeader />
      <main className="pt-20">
        <section className="bg-slate-50 py-10 md:py-12">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
              <Link href="/free-tools" className="font-semibold text-primary-700 hover:text-primary-800">
                Free tools
              </Link>
              <span className="mx-2" aria-hidden>
                /
              </span>
              <span aria-current="page">{tool.title}</span>
            </nav>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{tool.title}</h1>
            <p className="mt-3 max-w-3xl text-lg leading-relaxed text-slate-600">{tool.shortDescription}</p>
            <div className="mt-8">
              <FreeToolPageBody slug={tool.slug} />
            </div>
          </div>
        </section>

        <section className="bg-white py-12 md:py-14">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <div className="max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">How it works</h2>
              <div className="mt-4 space-y-3 text-base leading-relaxed text-slate-600">
                {tool.howItWorks.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
              {tool.showsStatutoryRates && <p className="mt-4 text-sm font-semibold text-slate-700">{ratesAsOfLine(RATES_CHECKED_ON)}</p>}
              {tool.notes && (
                <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-600">{tool.notes}</p>
              )}
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-12 md:py-14">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <div className="max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Common questions</h2>
              <div className="mt-6 space-y-6">
                {tool.faqs.map((f) => (
                  <div key={f.question}>
                    <h3 className="text-lg font-semibold text-slate-900">{f.question}</h3>
                    <p className="mt-2 text-base leading-relaxed text-slate-600">
                      <AnswerText text={f.answer} />
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {related.length > 0 && (
          <section className="bg-white py-12 md:py-14">
            <div className={`${LANDING_PAGE_GUTTER} w-full`}>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">More free tools</h2>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((r) => {
                  const Icon = toolIcon(r.icon);
                  return (
                    <li key={r.slug}>
                      <Link
                        href={`/free-tools/${r.slug}`}
                        className="block h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-primary-300"
                      >
                        <Icon className="h-6 w-6 text-primary-600" aria-hidden />
                        <h3 className="mt-3 text-lg font-semibold text-slate-900">{r.title}</h3>
                        <p className="mt-2 text-base leading-relaxed text-slate-600">{r.shortDescription}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        <section className="bg-slate-50 py-14">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <div className="max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Do this inside Khatario with your own bills</h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Keep your bills, stock and customers in one place. Start on the free plan.
              </p>
              <Link
                href="/signup"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-8 py-3.5 text-base font-semibold text-white shadow-md transition hover:bg-primary-700"
              >
                Start free
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
