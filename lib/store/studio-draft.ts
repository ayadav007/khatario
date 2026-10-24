import { sanitizeContactForm, sanitizeStoreTheme, type StoreCategoryStyle, type StoreContactForm, type StoreTheme } from './store-theme';
import { sanitizeStudioSections, type StudioSection } from './studio-sections';

/** Mirrors the Studio editor's page settings; kept here so the server can validate drafts. */
export interface StudioDraftPages {
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

/** Unpublished Studio work, auto-saved so it survives closing the editor. */
export interface StudioDraft {
  theme: StoreTheme;
  sections: StudioSection[];
  pages: StudioDraftPages;
}

/** Drafts are bounded well below Postgres jsonb limits; images are URLs, not inline data. */
export const STUDIO_DRAFT_MAX_BYTES = 1_500_000;

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export function sanitizeStudioDraft(raw: unknown): StudioDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const theme = sanitizeStoreTheme(src.theme);
  const p = src.pages && typeof src.pages === 'object' ? (src.pages as Record<string, unknown>) : {};
  // Page settings that live on the theme are normalised through the theme sanitiser.
  const pageTheme = sanitizeStoreTheme({
    ...theme,
    search_placeholder: p.searchPlaceholder,
    mobile_columns: p.mobileColumns,
    show_listing_add: p.showListingAdd,
    category_style: p.categoryStyle,
    category_images: p.categoryImages,
    sticky_buy_now: p.stickyBuyNow,
    whatsapp_url: p.whatsappUrl,
    instagram_url: p.instagramUrl,
  });
  const minOrder = Number(p.minOrder);
  return {
    theme,
    sections: sanitizeStudioSections(src.sections),
    pages: {
      searchPlaceholder: pageTheme.search_placeholder,
      mobileColumns: pageTheme.mobile_columns,
      showListingAdd: pageTheme.show_listing_add,
      categoryStyle: pageTheme.category_style,
      categoryImages: pageTheme.category_images,
      stickyBuyNow: pageTheme.sticky_buy_now,
      minOrder: Number.isFinite(minOrder) ? Math.min(10_000_000, Math.max(0, minOrder)) : 0,
      allowCod: p.allowCod !== false,
      aboutMd: text(p.aboutMd, 20000),
      contactMd: text(p.contactMd, 20000),
      whatsappUrl: typeof p.whatsappUrl === 'string' && p.whatsappUrl.trim() ? pageTheme.whatsapp_url : '',
      instagramUrl: typeof p.instagramUrl === 'string' && p.instagramUrl.trim() ? pageTheme.instagram_url : '',
      contactForm: sanitizeContactForm(p.contactForm),
    },
  };
}
