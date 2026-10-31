import type { SectionSchema, SettingSchema } from './schema-types';
import type { TemplateKind } from './types';
import { announcement } from './sections/announcement';
import { header } from './sections/header';
import { footer } from './sections/footer';
import { slideshow } from './sections/slideshow';
import { imageBanner } from './sections/image-banner';
import { imageWithText } from './sections/image-with-text';
import { richText } from './sections/rich-text';
import { multicolumn } from './sections/multicolumn';
import { marquee } from './sections/marquee';
import { featuredProducts } from './sections/featured-products';
import { productRail } from './sections/product-rail';
import { categoryGrid } from './sections/category-grid';
import { testimonials } from './sections/testimonials';
import { customHtml } from './sections/custom-html';
import { mainProduct } from './sections/main-product';
import { relatedProducts } from './sections/related-products';
import { recentlyViewed } from './sections/recently-viewed';
import { productReviews } from './sections/product-reviews';
import { catalogBanner } from './sections/catalog-banner';
import { mainCatalog } from './sections/main-catalog';
import { collectionList } from './sections/collection-list';
import { logoList } from './sections/logo-list';
import { video } from './sections/video';
import { faq } from './sections/faq';
import { newsletter } from './sections/newsletter';
import { countdown } from './sections/countdown';
import { spacer } from './sections/spacer';
import { promoCards } from './sections/promo-cards';
import { categoryShelves } from './sections/category-shelves';

/** Appended to every non-group section. Colour scheme, CSS class and custom CSS live on the Section itself. */
export const COMMON_SETTINGS: SettingSchema[] = [
  { id: 'spacing_top', type: 'range', label: 'Top spacing', min: 0, max: 96, step: 4, default: 32 },
  { id: 'spacing_bottom', type: 'range', label: 'Bottom spacing', min: 0, max: 96, step: 4, default: 32 },
  {
    id: 'spacing_left',
    type: 'range',
    label: 'Left spacing',
    min: 0,
    max: 96,
    step: 4,
    default: 0,
    info: "Once set, replaces a slideshow card's own gap on this side",
  },
  {
    id: 'spacing_right',
    type: 'range',
    label: 'Right spacing',
    min: 0,
    max: 96,
    step: 4,
    default: 0,
    info: "Once set, replaces a slideshow card's own gap on this side",
  },
  { id: 'full_width', type: 'checkbox', label: 'Full width', default: false },
];

const GROUP_TEMPLATES: TemplateKind[] = ['header', 'footer'];

function withCommon(schema: SectionSchema): SectionSchema {
  if (schema.templates.every((t) => GROUP_TEMPLATES.includes(t))) return schema;
  return { ...schema, settings: [...schema.settings, ...COMMON_SETTINGS] };
}

const ALL: SectionSchema[] = [
  announcement,
  header,
  footer,
  slideshow,
  imageBanner,
  imageWithText,
  richText,
  multicolumn,
  marquee,
  featuredProducts,
  productRail,
  categoryGrid,
  testimonials,
  customHtml,
  mainProduct,
  relatedProducts,
  recentlyViewed,
  productReviews,
  catalogBanner,
  mainCatalog,
  collectionList,
  logoList,
  video,
  faq,
  newsletter,
  countdown,
  spacer,
  promoCards,
  categoryShelves,
].map(withCommon);

export const SECTION_SCHEMAS: Record<string, SectionSchema> = Object.fromEntries(ALL.map((s) => [s.type, s]));

export function getSectionSchema(type: string): SectionSchema | null {
  return Object.prototype.hasOwnProperty.call(SECTION_SCHEMAS, type) ? SECTION_SCHEMAS[type] : null;
}

export function sectionsForTemplate(kind: TemplateKind): SectionSchema[] {
  return ALL.filter((s) => s.templates.includes(kind));
}
