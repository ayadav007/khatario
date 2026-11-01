import { phoneKitEnabled, shortSearchHint } from '@/lib/store/phone-kit';
import { sanitizeStoreTheme } from '@/lib/store/store-theme';
import { sanitizeStudioDraft } from '@/lib/store/studio-draft';
import { applyPagesToTheme, pagesFromSettings } from '@/components/store/admin/theme-studio/studio-map';

describe('phone kit setting', () => {
  it('is on for existing and new stores unless switched off', () => {
    expect(sanitizeStoreTheme({}).phone_kit).toBe(true);
    expect(sanitizeStoreTheme({ preset: 'grocery' }).phone_kit).toBe(true);
    expect(sanitizeStoreTheme({ phone_kit: false }).phone_kit).toBe(false);
  });

  it('is always on for Quick', () => {
    expect(phoneKitEnabled({ pack: 'quick', phone_kit: false })).toBe(true);
    expect(phoneKitEnabled({ pack: 'studio', phone_kit: false })).toBe(false);
    expect(phoneKitEnabled({ pack: 'khatario', phone_kit: true })).toBe(true);
  });

  it('round-trips through the Studio page settings', () => {
    const theme = sanitizeStoreTheme({ phone_kit: false });
    const pages = pagesFromSettings(theme, {});
    expect(pages.phoneKit).toBe(false);
    expect(applyPagesToTheme(theme, { ...pages, phoneKit: true }).phone_kit).toBe(true);
  });

  it('keeps the theme value for drafts saved before the toggle existed', () => {
    expect(sanitizeStudioDraft({ theme: { phone_kit: false }, pages: {} })?.pages.phoneKit).toBe(false);
    expect(sanitizeStudioDraft({ theme: {}, pages: { phoneKit: false } })?.pages.phoneKit).toBe(false);
  });
});

describe('shortSearchHint', () => {
  it('cuts long hints at the first comma', () => {
    expect(shortSearchHint('Search for products, brands and categories…')).toBe('Search for products…');
    expect(shortSearchHint('Search for items…')).toBe('Search for items…');
    expect(shortSearchHint('Find fresh fruit and vegetables from local farms near you')).toBe('Search…');
  });
});
