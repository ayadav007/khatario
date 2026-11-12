import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { MarketingPageShell } from '@/components/marketing/MarketingPageShell';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { publicSiteUrl } from '@/lib/blog/site';
import { khatarioOrganizationJsonLd } from '@/lib/marketing/brand-structured-data';
import { FREE_TOOLS, type ToolCategory } from '@/lib/tools/catalogue';
import { hubJsonLd, hubMetadata, toolIcon } from '@/lib/tools/tool-page-seo';

export const metadata = hubMetadata();

const CATEGORIES: ToolCategory[] = ['GST and tax', 'Money', 'Business', 'Images'];

export default function FreeToolsHubPage() {
  const site = publicSiteUrl();
  const { '@context': context, ...hub } = hubJsonLd(FREE_TOOLS, site);
  const structuredData = { '@context': context, '@graph': [khatarioOrganizationJsonLd(site), hub] };

  return (
    <MarketingPageShell title="Free business tools" intro="Free calculators and checkers for Indian shops. No sign-up needed.">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

      {CATEGORIES.map((category, index) => {
        const tools = FREE_TOOLS.filter((t) => t.category === category);
        if (tools.length === 0) return null;
        return (
          <section key={category} className={`${index % 2 === 0 ? 'bg-slate-50' : 'bg-white'} py-12 md:py-14`}>
            <div className={`${LANDING_PAGE_GUTTER} w-full`}>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{category}</h2>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => {
                  const Icon = toolIcon(tool.icon);
                  return (
                    <li key={tool.slug}>
                      <Link
                        href={`/free-tools/${tool.slug}`}
                        className="block h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-primary-300"
                      >
                        <Icon className="h-6 w-6 text-primary-600" aria-hidden />
                        <h3 className="mt-3 text-lg font-semibold text-slate-900">{tool.title}</h3>
                        <p className="mt-2 text-base leading-relaxed text-slate-600">{tool.shortDescription}</p>
                        <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-700">
                          Open tool <ArrowRight className="h-4 w-4" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        );
      })}

      <section className="bg-white py-14">
        <div className={`${LANDING_PAGE_GUTTER} w-full`}>
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Billing for your whole shop</h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Khatario keeps your bills, stock and customers in one place. Start on the free plan.
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
    </MarketingPageShell>
  );
}
