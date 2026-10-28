import type { CSSProperties } from 'react';
import { chowkInkOn, chowkOnAccent, hexLuminance, sectionEnabled, storeCanvas, type StoreTheme } from './store-theme';
import type { StudioProductSource, StudioSection, StudioSectionType, StudioSettings } from './studio-sections';

export const STUDIO_FALLBACK_HERO =
  'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80';

export const STUDIO_EYEBROW: Partial<Record<StudioSectionType, string>> = {
  categories: 'SHOP BY CATEGORY',
  products: 'FEATURED PRODUCTS',
  banner: 'SPECIAL OFFER',
  testimonials: 'CUSTOMER LOVE',
};

/** Default label above a product section's heading, by where its products come from. */
const SOURCE_EYEBROW: Partial<Record<StudioProductSource, string>> = {
  new: 'JUST IN',
  bestsellers: 'CUSTOMER FAVOURITES',
  discounted: 'ON SALE',
  category: 'SHOP THE CATEGORY',
  price_max: 'VALUE PICKS',
};

export function studioEyebrow(type: StudioSectionType, value: string | undefined, source?: StudioProductSource): string {
  if (value !== undefined) return value;
  return (type === 'products' && source ? SOURCE_EYEBROW[source] : undefined) ?? STUDIO_EYEBROW[type] ?? '';
}

export interface StudioContext {
  businessName: string;
  tagline: string;
  heroUrl: string;
  categories: Array<{ id: string; name: string }>;
  /** Automatic announcement the pack shows when no custom text is set. */
  autoAnnouncement: string;
}

export function themeToStudioSections(theme: StoreTheme, ctx: StudioContext): StudioSection[] {
  const slide = theme.hero_slides[0];
  const band = theme.overlay_bands[0];
  const name = ctx.businessName || 'My store';
  const hasOffers = sectionEnabled(theme, 'offers');
  const navLinks = ['All Products', ...ctx.categories.slice(0, 6).map((c) => c.name), ...(hasOffers ? ['Offers'] : [])].join(', ');

  return [
    {
      id: 'announcement',
      type: 'announcement',
      name: 'Announcement Bar',
      enabled: !!theme.announcement || (theme.announcement_auto && !!ctx.autoAnnouncement),
      settings: {
        announceMode: !theme.announcement && theme.announcement_auto && ctx.autoAnnouncement ? 'auto' : 'custom',
        autoText: ctx.autoAnnouncement,
        text: theme.announcement || 'Free delivery on orders above ₹499',
        extra: '',
        link: theme.announcement_link,
        background: theme.announcement_bg || undefined,
        textColor: theme.announcement_fg || undefined,
        textAlign: theme.announcement_align,
        tone: 'solid',
      },
    },
    {
      id: 'header',
      type: 'header',
      name: 'Header',
      enabled: true,
      settings: {
        logo: name,
        tagline: ctx.tagline,
        showSearch: true,
        showNav: true,
        navLinks,
        highlightLink: hasOffers ? 'Offers' : '',
        iconsPosition: 'right',
        showAccount: true,
        showCart: true,
        showCartCount: true,
      },
    },
    {
      id: 'hero',
      type: 'hero',
      name: 'Hero',
      enabled: sectionEnabled(theme, 'hero'),
      settings: {
        layout: 'image-text',
        eyebrow: '',
        benefits: '',
        heading: slide?.title || ctx.tagline || `Welcome to ${name}`,
        description: slide?.subtitle || theme.hero_subtitle,
        buttonText: theme.hero_cta || 'Shop now',
        image: slide?.image_url || ctx.heroUrl || STUDIO_FALLBACK_HERO,
        align: 'left',
        height: 'medium',
        overlay: 20,
        slides: theme.hero_slides.slice(1, 6).map((sl) => ({
          image: sl.image_url,
          heading: sl.title,
          description: sl.subtitle,
          buttonText: theme.hero_cta || 'Shop now',
          link: '',
        })),
      },
    },
    {
      id: 'categories',
      type: 'categories',
      name: 'Categories',
      enabled: sectionEnabled(theme, 'categories'),
      settings: { title: 'Shop by category', columns: 6 },
    },
    {
      id: 'products',
      type: 'products',
      name: 'Products',
      enabled: sectionEnabled(theme, 'catalog'),
      settings: { title: 'Handpicked for you', columns: 5, showPrice: true },
    },
    {
      id: 'banner',
      type: 'banner',
      name: 'Promo Banner',
      enabled: sectionEnabled(theme, 'overlay'),
      settings: {
        title: band?.caption || 'Everyday essentials, better value',
        text: 'Save more when you shop your weekly favourites.',
        button: band?.cta || 'View offers',
        image: band?.image_url || '',
      },
    },
    {
      id: 'testimonials',
      type: 'testimonials',
      name: 'Testimonials',
      enabled: sectionEnabled(theme, 'testimonials'),
      settings: { title: 'What our customers say' },
    },
    {
      id: 'footer',
      type: 'footer',
      name: 'Footer',
      enabled: true,
      settings: { brand: name, tagline: ctx.tagline, links: 'Shop, About, Contact, Privacy' },
    },
  ];
}

/** Quick's starting layout: the same sections, arranged like a quick-delivery app home. */
function quickStartSections(base: StudioSection[]): StudioSection[] {
  const by = (type: StudioSection['type']) => base.find((s) => s.type === type)!;
  const hero = by('hero');
  const banner = by('banner');
  return [
    by('announcement'),
    { ...by('header'), settings: { ...by('header').settings, deliveryEta: '' } },
    { ...hero, settings: { ...hero.settings, layout: 'full', height: 'small', overlay: 35, align: 'left' } },
    { ...by('categories'), settings: { title: 'Shop by category', columns: 8 } },
    {
      id: 'quick-bestsellers',
      type: 'products',
      name: 'Bestsellers',
      enabled: true,
      settings: { title: 'Bestsellers', source: 'bestsellers', limit: 12, columns: 6, display: 'carousel', showPrice: true },
    },
    {
      id: 'quick-deals',
      type: 'products',
      name: 'Top Deals',
      enabled: true,
      settings: { title: 'Top deals', source: 'discounted', limit: 12, columns: 6, display: 'carousel', showPrice: true },
    },
    { ...banner, enabled: banner.enabled },
    { id: 'quick-usp', type: 'usp', name: 'Trust Badges', enabled: true, settings: {} },
    { ...by('products'), settings: { ...by('products').settings, title: 'All products', columns: 6 } },
    by('footer'),
  ];
}

/** The saved Studio layout, or one derived from the theme for stores that never opened Studio. */
export function resolveStudioSections(theme: StoreTheme, ctx: StudioContext): StudioSection[] {
  if (theme.studio_sections.length > 0) return theme.studio_sections;
  const base = themeToStudioSections(theme, ctx);
  return theme.pack === 'quick' ? quickStartSections(base) : base;
}

/** Colour tokens for Studio sections, so every surface stays readable in light, dim and dark. */
export function studioVars(accent: string, paper: string): CSSProperties {
  const dark = hexLuminance(paper) < 0.42;
  return {
    '--primary': accent,
    '--on-primary': chowkOnAccent(accent),
    '--paper': paper,
    '--text': chowkInkOn(paper),
    '--st-card': dark ? 'color-mix(in srgb, #fff 6%, var(--paper))' : '#ffffff',
    '--st-soft': dark ? 'color-mix(in srgb, #fff 4%, var(--paper))' : 'color-mix(in srgb, var(--primary) 5%, #f1ebe1)',
    '--st-tile': dark ? 'color-mix(in srgb, #fff 8%, var(--paper))' : 'color-mix(in srgb, var(--primary) 5%, #eee4d2)',
    '--st-banner': dark ? 'color-mix(in srgb, var(--primary) 24%, var(--paper))' : 'color-mix(in srgb, var(--primary) 12%, #e9dcc6)',
    '--st-foot': dark ? 'color-mix(in srgb, #000 40%, var(--paper))' : '#211b16',
    '--st-field': dark ? 'color-mix(in srgb, #fff 8%, var(--paper))' : '#ffffff',
  } as CSSProperties;
}

export function studioThemeVars(theme: StoreTheme): CSSProperties {
  return studioVars(theme.accent, storeCanvas(theme));
}

export type StudioLinkTarget =
  | { kind: 'products' }
  | { kind: 'offers' }
  | { kind: 'category'; id: string }
  | { kind: 'href'; href: string };

const PAGE_LINKS: Record<string, string> = {
  home: '/',
  about: '/about',
  'about us': '/about',
  contact: '/contact',
  'contact us': '/contact',
  privacy: '/privacy',
  'privacy policy': '/privacy',
  refund: '/refund',
  refunds: '/refund',
  returns: '/refund',
  terms: '/terms',
  wishlist: '/wishlist',
  account: '/account',
  orders: '/account',
  'my orders': '/account',
  'your orders': '/account',
  cart: '/cart',
};

/** Maps a free-text nav/footer label to where it should go on the live store. */
export function studioLinkTarget(label: string, categories: Array<{ id: string; name: string }>): StudioLinkTarget {
  const key = label.trim().toLowerCase();
  if (/^https?:\/\//.test(key) || key.startsWith('/')) return { kind: 'href', href: label.trim() };
  if (PAGE_LINKS[key]) return { kind: 'href', href: PAGE_LINKS[key] };
  if (key === 'offers' || key === 'deals' || key === 'sale') return { kind: 'offers' };
  const cat = categories.find((c) => c.name.trim().toLowerCase() === key);
  if (cat) return { kind: 'category', id: cat.id };
  return { kind: 'products' };
}

/** Sections a merchant can add from the Studio "Add section" menu, in menu order. */
export const ADDABLE_SECTIONS: Array<{ type: StudioSectionType; label: string; hint: string }> = [
  { type: 'products', label: 'Product row', hint: 'New arrivals, best sellers, a category…' },
  { type: 'banner', label: 'Promo banner', hint: 'Image, offer text and a button' },
  { type: 'usp', label: 'Trust badges', hint: 'Free delivery, COD, easy returns' },
  { type: 'marquee', label: 'Scrolling text', hint: 'A moving line of offers' },
  { type: 'richtext', label: 'Text block', hint: 'Heading and paragraph' },
];

/** A new section with sensible starting content. */
export function newStudioSection(type: StudioSectionType, id: string): StudioSection {
  switch (type) {
    case 'products':
      return {
        id,
        type,
        name: 'New Arrivals',
        enabled: true,
        settings: { title: 'New arrivals', source: 'new', limit: 8, columns: 4, display: 'carousel', showPrice: true },
      };
    case 'banner':
      return {
        id,
        type,
        name: 'Promo Banner',
        enabled: true,
        settings: { title: 'Festive sale is live', text: 'Up to 30% off on bestsellers this week.', button: 'Shop the sale', image: '' },
      };
    case 'usp':
      return { id, type, name: 'Trust Badges', enabled: true, settings: {} };
    case 'marquee':
      return {
        id,
        type,
        name: 'Scrolling Text',
        enabled: true,
        settings: { text: 'Free delivery above ₹499, Cash on delivery available, New arrivals every week', speed: 'normal' },
      };
    default:
      return { id, type: 'richtext', name: 'New Text Section', enabled: true, settings: { title: 'Your heading', text: 'Add your content here.' } };
  }
}

export const STUDIO_SOURCE_LABELS: Record<StudioProductSource, string> = {
  all: 'All products (with Load more)',
  featured: 'Featured products',
  new: 'New arrivals',
  bestsellers: 'Best sellers',
  discounted: 'On sale',
  category: 'One category',
  price_max: 'Under a price',
};

/** A product section that shows the whole catalog (the default for older layouts). */
export function isCatalogSection(section: StudioSection): boolean {
  return section.type === 'products' && (section.settings.source ?? 'all') === 'all';
}

/** Items API query for a sourced product section. */
export function studioProductParams(s: StudioSettings): URLSearchParams {
  const params = new URLSearchParams();
  params.set('limit', String(s.limit ?? 8));
  switch (s.source) {
    case 'featured':
      params.set('featured', '1');
      break;
    case 'new':
      params.set('sort', 'new');
      break;
    case 'bestsellers':
      params.set('sort', 'bestsellers');
      break;
    case 'discounted':
      params.set('discounted', '1');
      break;
    case 'category':
      if (s.categoryId) params.set('category_id', s.categoryId);
      break;
    case 'price_max':
      params.set('max_price', String(s.priceMax ?? 499));
      break;
    default:
      break;
  }
  return params;
}

export function splitList(value: string | undefined, fallback: string): string[] {
  return String(value || fallback)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
