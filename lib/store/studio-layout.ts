import type { CSSProperties } from 'react';
import { chowkInkOn, chowkOnAccent, hexLuminance, sectionEnabled, storeCanvas, type StoreTheme } from './store-theme';
import type { StudioSection, StudioSectionType } from './studio-sections';

export const STUDIO_FALLBACK_HERO =
  'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80';

export const STUDIO_EYEBROW: Partial<Record<StudioSectionType, string>> = {
  categories: 'SHOP BY CATEGORY',
  products: 'FEATURED PRODUCTS',
  banner: 'SPECIAL OFFER',
  testimonials: 'CUSTOMER LOVE',
};

export function studioEyebrow(type: StudioSectionType, value: string | undefined): string {
  return value ?? STUDIO_EYEBROW[type] ?? '';
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

/** The saved Studio layout, or one derived from the theme for stores that never opened Studio. */
export function resolveStudioSections(theme: StoreTheme, ctx: StudioContext): StudioSection[] {
  return theme.studio_sections.length > 0 ? theme.studio_sections : themeToStudioSections(theme, ctx);
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

export function splitList(value: string | undefined, fallback: string): string[] {
  return String(value || fallback)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
