import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import {
  LANDING_FREE_TOOLS_DEFAULTS,
  resolveFreeToolCards,
  type LandingFreeToolsContent,
} from '@/lib/marketing/free-tools-section';
import { toolIcon } from '@/lib/tools/tool-page-seo';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

export type { LandingFreeToolsContent };
export { LANDING_FREE_TOOLS_DEFAULTS, resolveFreeToolCards };

export function LandingFreeTools(props: Partial<LandingFreeToolsContent> = {}) {
  const c = withDefaults(LANDING_FREE_TOOLS_DEFAULTS, props);
  const cards = resolveFreeToolCards(c.toolSlugs);
  return (
    <section id="free-tools" className="scroll-mt-24 bg-slate-50 py-20 2xl:py-28">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingSectionHead heading={c.heading} intro={c.intro} />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((tool) => {
            const Icon = toolIcon(tool.icon);
            return (
              <Link
                key={tool.slug}
                href={`/free-tools/${tool.slug}`}
                className="group flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-primary-300 hover:shadow-md"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-bold text-slate-900">{tool.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-slate-600">{tool.shortDescription}</span>
                </span>
              </Link>
            );
          })}
        </div>
        <Link
          href="/free-tools"
          className="mt-8 inline-flex items-center gap-2 font-semibold text-primary-700 hover:text-primary-800"
        >
          See all free tools
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
