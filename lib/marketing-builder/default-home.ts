import type { MarketingDocument } from '@/lib/marketing-builder/sanitize';

/**
 * Today's coded home page as a Site Builder document: the Khatario sections in their
 * current order. Blocks carry no content props here; the editor fills each block's
 * defaultProps on load, and renderers fall back to the same defaults.
 */
const HOME_SECTIONS = [
  'Hero',
  'SocialProof',
  'ProblemSolution',
  'Walkthrough',
  'KeyFeatures',
  'TemplateGallery',
  'WhoItsFor',
  'ConnectedSupply',
  'TrustStrip',
  'Pricing',
  'Faq',
  'FinalCta',
] as const;

export function buildDefaultHomeDocument(): MarketingDocument {
  return {
    root: { props: { title: '', description: '', ogImage: '', brandColor: 'teal', headingFont: 'default' } },
    content: HOME_SECTIONS.map((type) => ({ type, props: { id: `${type}-default` } })),
  };
}
