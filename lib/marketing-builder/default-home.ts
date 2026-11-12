import type { MarketingDocument } from '@/lib/marketing-builder/sanitize';

/**
 * Today's coded home page as a Site Builder document: the Khatario sections in their
 * current order (same as `LandingDefaultSections`). Blocks carry no content props here;
 * the editor fills each block's defaultProps on load, and renderers fall back to the same defaults.
 * Older sections (SocialProof, Walkthrough, FeatureBento, WhatsAppBand, PrintLanguages, StaffApp,
 * ProblemSolution, KeyFeatures, WhoItsFor, ConnectedSupply, TrustStrip) stay available in the
 * editor but are not on the default page. The editor's Reset loads this list.
 */
export const HOME_SECTIONS = [
  'Hero',
  'Suite',
  'Industries',
  'ProductTour',
  'AiTools',
  'FreeTools',
  'TemplateGallery',
  'OnlineStore',
  'WhatsAppMarketing',
  'StaffManagement',
  'SwitchHelp',
  'Testimonials',
  'Everywhere',
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
