export const LAYOUT_BLOCKS = ['Section', 'Columns', 'Grid', 'Card', 'Spacer', 'Divider'] as const;

export const CONTENT_BLOCKS = [
  'Heading',
  'Text',
  'Image',
  'Buttons',
  'Badge',
  'IconList',
  'Stats',
  'Screenshot',
  'Video',
  'Testimonial',
] as const;

export const KHATARIO_BLOCKS = [
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

export const BLOCK_TYPES = [...LAYOUT_BLOCKS, ...CONTENT_BLOCKS, ...KHATARIO_BLOCKS] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

const BLOCK_TYPE_SET = new Set<string>(BLOCK_TYPES);

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && BLOCK_TYPE_SET.has(value);
}

export const MARKETING_PAGE_SLUGS = ['home'] as const;
export type MarketingPageSlug = (typeof MARKETING_PAGE_SLUGS)[number];

export function isMarketingPageSlug(value: unknown): value is MarketingPageSlug {
  return typeof value === 'string' && (MARKETING_PAGE_SLUGS as readonly string[]).includes(value);
}
