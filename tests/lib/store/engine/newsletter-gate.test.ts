jest.mock('@/lib/store/engine/load-theme', () => ({ loadEngineTheme: jest.fn() }));
jest.mock('@/lib/store/engine/section-data', () => ({
  collectDataRequests: jest.fn(() => new Map()),
  resolveSectionData: jest.fn(),
}));

import { liveThemeHasEnabledSection, themeHasEnabledSectionOfType } from '@/lib/store/engine/page-loader';
import { loadEngineTheme } from '@/lib/store/engine/load-theme';
import { enquiryAccepted, isPreviewReferer } from '@/lib/store/enquiry';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { ThemeData } from '@/lib/store/engine/types';

const store = { business_id: 'b1', store_subdomain: 'ganesh' } as StoreBusinessContext;
const load = loadEngineTheme as jest.Mock;

const empty = { order: [], sections: {} };
function themeWith(templateKey: string, disabled: boolean): ThemeData {
  const tpl = {
    order: ['hero', 'news'],
    sections: {
      hero: { type: 'image-banner', settings: {}, blocks: {}, block_order: [] },
      news: { type: 'newsletter', settings: {}, blocks: {}, block_order: [], disabled },
    },
  };
  return {
    settings: {} as ThemeData['settings'],
    header_group: empty,
    footer_group: empty,
    templates: { home: empty, product: empty, catalog: empty, [templateKey]: tpl },
  };
}

/** The route's decision with the contact form off, for a newsletter signup from the live store. */
const newsletterAccepted = (fromPreview = false) =>
  enquiryAccepted({
    formEnabled: false,
    isNewsletter: true,
    fromPreview,
    liveNewsletterSection: () => liveThemeHasEnabledSection(store, 'newsletter'),
  });

describe('newsletter signups need a live newsletter section (I1)', () => {
  beforeEach(() => load.mockReset());

  it('refuses when the store has no engine theme and the contact form is off', async () => {
    load.mockResolvedValue(null);
    await expect(newsletterAccepted()).resolves.toBe(false);
    expect(load).toHaveBeenCalledWith(store, {});
  });

  it('accepts when the live theme has an enabled newsletter section', async () => {
    load.mockResolvedValue({ theme: { data: themeWith('home', false) }, preview: false });
    await expect(newsletterAccepted()).resolves.toBe(true);
  });

  it('accepts a section on a custom page', async () => {
    load.mockResolvedValue({ theme: { data: themeWith('page.about', false) }, preview: false });
    await expect(newsletterAccepted()).resolves.toBe(true);
  });

  it('refuses when the newsletter section is disabled', async () => {
    load.mockResolvedValue({ theme: { data: themeWith('home', true) }, preview: false });
    await expect(newsletterAccepted()).resolves.toBe(false);
  });

  it('refuses when the theme cannot be loaded', async () => {
    load.mockRejectedValue(new Error('db down'));
    await expect(newsletterAccepted()).resolves.toBe(false);
  });

  it('never counts a previewed theme', async () => {
    load.mockResolvedValue({ theme: { data: themeWith('home', false) }, preview: true });
    await expect(newsletterAccepted()).resolves.toBe(false);
  });

  it('refuses signups sent from a preview or the editor, even with a live section', async () => {
    load.mockResolvedValue({ theme: { data: themeWith('home', false) }, preview: false });
    await expect(newsletterAccepted(true)).resolves.toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the contact-form rule for other topics and for newsletter with the form on', async () => {
    const never = jest.fn(async () => true);
    await expect(enquiryAccepted({ formEnabled: false, isNewsletter: false, fromPreview: false, liveNewsletterSection: never })).resolves.toBe(false);
    await expect(enquiryAccepted({ formEnabled: true, isNewsletter: false, fromPreview: false, liveNewsletterSection: never })).resolves.toBe(true);
    await expect(enquiryAccepted({ formEnabled: true, isNewsletter: true, fromPreview: false, liveNewsletterSection: never })).resolves.toBe(true);
    expect(never).not.toHaveBeenCalled();
  });

  it('themeHasEnabledSectionOfType ignores other types and missing data', () => {
    expect(themeHasEnabledSectionOfType(themeWith('home', false), 'newsletter')).toBe(true);
    expect(themeHasEnabledSectionOfType(themeWith('home', false), 'video')).toBe(false);
    expect(themeHasEnabledSectionOfType(null, 'newsletter')).toBe(false);
  });

  it('isPreviewReferer spots preview and editor pages', () => {
    expect(isPreviewReferer('https://ganesh.khatario.com/?preview_theme=x&pt=y')).toBe(true);
    expect(isPreviewReferer('https://ganesh.khatario.com/pages/about?editor=1')).toBe(true);
    expect(isPreviewReferer('https://ganesh.khatario.com/pages/about')).toBe(false);
    expect(isPreviewReferer(null)).toBe(false);
    expect(isPreviewReferer('not a url')).toBe(false);
  });
});
