import {
  sanitizeContactForm,
  type StoreCategoryStyle,
  type StoreContactForm,
  type StoreHomepageSectionId,
  type StoreTestimonial,
  type StoreTheme,
} from '@/lib/store/store-theme';
import { sanitizeStudioSections, type StudioSection, type StudioSectionType } from '@/lib/store/studio-sections';
import { STUDIO_FALLBACK_HERO } from '@/lib/store/studio-layout';

export type { StudioSection, StudioSectionType, StudioSettings } from '@/lib/store/studio-sections';
export { STUDIO_FALLBACK_HERO, themeToStudioSections, resolveStudioSections, type StudioContext } from '@/lib/store/studio-layout';

/** Studio sections that also write through to a storefront homepage section (used by Grocery and Khatario). */
const HOMEPAGE_LINK: Partial<Record<StudioSectionType, StoreHomepageSectionId>> = {
  hero: 'hero',
  categories: 'categories',
  products: 'catalog',
  banner: 'overlay',
  testimonials: 'testimonials',
};

export function isSavedSection(type: StudioSectionType): boolean {
  return type === 'announcement' || type === 'header' || type in HOMEPAGE_LINK;
}

/**
 * Writes the Studio layout onto the theme. The full section list is stored for the Studio pack;
 * the mapped fields keep Grocery and Khatario in sync with the same edits.
 */
export function applyStudioToTheme(
  theme: StoreTheme,
  sections: StudioSection[],
): { theme: StoreTheme; tagline: string | null; heroImage: string | null } {
  const byType = (t: StudioSectionType) => sections.find((s) => s.type === t);
  const next: StoreTheme = { ...theme, studio_sections: sanitizeStudioSections(sections) };

  const announce = byType('announcement');
  if (announce) {
    const a = announce.settings;
    const auto = a.announceMode === 'auto' && !!a.autoText;
    next.announcement =
      announce.enabled && !auto ? [a.text, a.extra].map((v) => v?.trim()).filter(Boolean).join(' · ') : '';
    next.announcement_auto = announce.enabled;
    next.announcement_link = a.link?.trim() ?? '';
    next.announcement_bg = a.background ?? '';
    next.announcement_fg = a.textColor ?? '';
    next.announcement_align = a.textAlign ?? 'center';
  }

  const enabledFor = new Map<StoreHomepageSectionId, boolean>();
  for (const [type, id] of Object.entries(HOMEPAGE_LINK) as Array<[StudioSectionType, StoreHomepageSectionId]>) {
    enabledFor.set(id, !!byType(type)?.enabled);
  }
  next.homepage_sections = theme.homepage_sections.map((s) =>
    enabledFor.has(s.id) ? { ...s, enabled: enabledFor.get(s.id)! } : s,
  );
  next.show_hero = enabledFor.get('hero') ?? theme.show_hero;

  const hero = byType('hero');
  let heroImage: string | null = null;
  if (hero) {
    const s = hero.settings;
    const image = s.image && s.image !== STUDIO_FALLBACK_HERO ? s.image : '';
    const slides = [...theme.hero_slides];
    slides[0] = {
      viewport: slides[0]?.viewport ?? 'both',
      image_url: image,
      title: s.heading?.trim() ?? '',
      subtitle: s.description?.trim() ?? '',
    };
    next.hero_slides = slides;
    next.hero_subtitle = s.description?.trim() ?? '';
    next.hero_cta = s.buttonText?.trim() || theme.hero_cta;
    heroImage = image || null;
  }

  const banner = byType('banner');
  if (banner) {
    const bands = [...theme.overlay_bands];
    bands[0] = {
      image_url: banner.settings.image || bands[0]?.image_url || '',
      caption: banner.settings.title?.trim() ?? '',
      cta: banner.settings.button?.trim() ?? '',
    };
    next.overlay_bands = bands;
  }

  const header = byType('header');
  return { theme: next, tagline: header ? header.settings.tagline?.trim() || null : null, heroImage };
}

export type StudioPageId =
  | 'home'
  | 'products'
  | 'collections'
  | 'product'
  | 'cart'
  | 'checkout'
  | 'about'
  | 'contact';

/** Store-wide settings edited from the non-home Studio pages. Every field here is saved on Publish. */
export interface StudioPagesState {
  searchPlaceholder: string;
  mobileColumns: 2 | 3;
  showListingAdd: boolean;
  categoryStyle: StoreCategoryStyle;
  categoryImages: Record<string, string>;
  stickyBuyNow: boolean;
  minOrder: number;
  allowCod: boolean;
  aboutMd: string;
  contactMd: string;
  whatsappUrl: string;
  instagramUrl: string;
  contactForm: StoreContactForm;
}

export interface StudioPageSection {
  id: string;
  name: string;
}

export const STUDIO_PAGES: Array<{ id: StudioPageId; label: string; icon: string; path: string; sections: StudioPageSection[] }> = [
  { id: 'home', label: 'Home', icon: '⌂', path: '/', sections: [] },
  {
    id: 'products',
    label: 'Products',
    icon: '▣',
    path: '/',
    sections: [
      { id: 'search', name: 'Search bar' },
      { id: 'grid', name: 'Product grid' },
    ],
  },
  { id: 'collections', label: 'Collections', icon: '▤', path: '/', sections: [{ id: 'grid', name: 'Category tiles' }] },
  {
    id: 'product',
    label: 'Product Page',
    icon: '◫',
    path: '/products/:id',
    sections: [
      { id: 'details', name: 'Product details' },
      { id: 'buy', name: 'Buy buttons' },
    ],
  },
  {
    id: 'cart',
    label: 'Cart',
    icon: '🛒',
    path: '/cart',
    sections: [
      { id: 'items', name: 'Cart items' },
      { id: 'summary', name: 'Order summary' },
    ],
  },
  {
    id: 'checkout',
    label: 'Checkout',
    icon: '▣',
    path: '/checkout',
    sections: [
      { id: 'address', name: 'Delivery details' },
      { id: 'payment', name: 'Payment options' },
    ],
  },
  { id: 'about', label: 'About', icon: 'ⓘ', path: '/about', sections: [{ id: 'content', name: 'About content' }] },
  {
    id: 'contact',
    label: 'Contact',
    icon: '✉',
    path: '/contact',
    sections: [
      { id: 'content', name: 'Contact details' },
      { id: 'form', name: 'Contact form' },
      { id: 'social', name: 'Social links' },
    ],
  },
];

/** Pages whose preview on the live store only reflects published values (not the unsaved draft). */
export const PUBLISHED_ONLY_PAGES: StudioPageId[] = ['cart', 'checkout', 'about', 'contact'];

export function pagesFromSettings(
  theme: StoreTheme,
  settings: {
    store_min_order_amount?: number | null;
    store_allow_cod?: boolean;
    store_about_md?: string | null;
    store_contact_md?: string | null;
  },
): StudioPagesState {
  return {
    searchPlaceholder: theme.search_placeholder,
    mobileColumns: theme.mobile_columns === 3 ? 3 : 2,
    showListingAdd: theme.show_listing_add,
    categoryStyle: theme.category_style,
    categoryImages: { ...theme.category_images },
    stickyBuyNow: theme.sticky_buy_now,
    minOrder: Number(settings.store_min_order_amount) || 0,
    allowCod: settings.store_allow_cod !== false,
    aboutMd: settings.store_about_md ?? '',
    contactMd: settings.store_contact_md ?? '',
    whatsappUrl: theme.whatsapp_url,
    instagramUrl: theme.instagram_url,
    contactForm: { ...theme.contact_form },
  };
}

export function applyPagesToTheme(theme: StoreTheme, pages: StudioPagesState): StoreTheme {
  return {
    ...theme,
    search_placeholder: pages.searchPlaceholder.trim(),
    mobile_columns: pages.mobileColumns,
    show_listing_add: pages.showListingAdd,
    category_style: pages.categoryStyle,
    category_images: pages.categoryImages,
    sticky_buy_now: pages.stickyBuyNow,
    whatsapp_url: pages.whatsappUrl.trim(),
    instagram_url: pages.instagramUrl.trim(),
    contact_form: sanitizeContactForm(pages.contactForm),
  };
}

/** Full draft theme (home sections + page settings) for previews and publishing. */
export function buildStudioTheme(
  theme: StoreTheme,
  sections: StudioSection[],
  pages: StudioPagesState,
): { theme: StoreTheme; tagline: string | null; heroImage: string | null } {
  const home = applyStudioToTheme(theme, sections);
  return { ...home, theme: applyPagesToTheme(home.theme, pages) };
}

export const SAMPLE_TESTIMONIALS: StoreTestimonial[] = [
  { name: 'Priya, Bangalore', text: 'Fresh products and very easy ordering.', photo_url: '' },
  { name: 'Rahul, Pune', text: 'The store feels like a real local shop.', photo_url: '' },
  { name: 'Meera, Chennai', text: 'Delivery was quick and the prices were clear.', photo_url: '' },
];
