import type { ComponentType } from 'react';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { SectionData } from '@/lib/store/engine/section-data';
import type { Section, ThemeData } from '@/lib/store/engine/types';
import { Announcement } from './sections/Announcement';
import { Header } from './sections/Header';
import { Footer } from './sections/Footer';
import { Slideshow } from './sections/Slideshow';
import { ImageBanner } from './sections/ImageBanner';
import { ImageWithText } from './sections/ImageWithText';
import { RichText } from './sections/RichText';
import { Multicolumn } from './sections/Multicolumn';
import { Marquee } from './sections/Marquee';
import { ProductGrid } from './sections/ProductGrid';
import { CategoryGrid } from './sections/CategoryGrid';
import { Testimonials } from './sections/Testimonials';
import { CustomHtml } from './sections/CustomHtml';
import { MainProduct } from './sections/MainProduct';
import { RelatedProducts } from './sections/RelatedProducts';
import { RecentlyViewed } from './sections/RecentlyViewed';
import { ProductReviews } from './sections/ProductReviews';

/** What the page's URL names: the product on `/products/[id]`, the category on the catalog. */
export interface EngineRoute {
  productId?: string;
  categoryId?: string;
  categoryName?: string;
}

export interface EngineSectionProps {
  id: string;
  section: Section;
  data?: SectionData;
  store: StoreBusinessContext;
  theme: ThemeData;
  route?: EngineRoute;
}

/**
 * Section type to its storefront component. These are server components: they map settings
 * (and sanitise HTML) on the server and hand plain props to the client Studio components.
 */
export const SECTION_COMPONENTS: Record<string, ComponentType<EngineSectionProps>> = {
  announcement: Announcement,
  header: Header,
  footer: Footer,
  slideshow: Slideshow,
  'image-banner': ImageBanner,
  'image-with-text': ImageWithText,
  'rich-text': RichText,
  multicolumn: Multicolumn,
  marquee: Marquee,
  'featured-products': ProductGrid,
  'product-rail': ProductGrid,
  'category-grid': CategoryGrid,
  testimonials: Testimonials,
  'custom-html': CustomHtml,
  'main-product': MainProduct,
  'related-products': RelatedProducts,
  'recently-viewed': RecentlyViewed,
  'product-reviews': ProductReviews,
};
