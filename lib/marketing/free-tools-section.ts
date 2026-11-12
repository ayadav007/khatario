import { getFreeTool, type FreeTool } from '@/lib/tools/catalogue';

export type LandingFreeToolsContent = { heading: string; intro: string; toolSlugs: { slug: string }[] };

export const LANDING_FREE_TOOLS_DEFAULTS: LandingFreeToolsContent = {
  heading: 'Free tools for your shop',
  intro: 'Calculators, checkers and an invoice maker. Free, no sign-up.',
  toolSlugs: [
    { slug: 'invoice-maker' },
    { slug: 'gst-calculator' },
    { slug: 'gstin-validator' },
    { slug: 'hsn-finder' },
    { slug: 'emi-calculator' },
    { slug: 'price-margin-calculator' },
  ],
};

const MAX_CARDS = 6;

/**
 * Catalogue tools for the given slugs, in order. Unknown and repeated slugs are dropped; at most six.
 * Anything that is not an array (bad saved builder content) counts as an empty list.
 */
export function resolveFreeToolCards(slugs: { slug: string }[]): FreeTool[] {
  const cards: FreeTool[] = [];
  if (!Array.isArray(slugs)) return cards;
  const seen = new Set<string>();
  for (const s of slugs) {
    const tool = getFreeTool(String(s?.slug ?? '').trim());
    if (!tool || seen.has(tool.slug)) continue;
    seen.add(tool.slug);
    cards.push(tool);
    if (cards.length === MAX_CARDS) break;
  }
  return cards;
}
