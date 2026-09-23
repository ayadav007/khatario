import {
  sanitizeStorePromoSheet,
  isStorePromoActive,
  shouldShowStorePromo,
  storePromoStorageKey,
  nextPromoSheetVersion,
} from '@/lib/store/promo-sheet';

describe('sanitizeStorePromoSheet', () => {
  it('defaults to off and clips unsafe fields', () => {
    const p = sanitizeStorePromoSheet({
      enabled: 'yes',
      title: 'x'.repeat(200),
      background_color: 'red',
      delay_ms: 99999,
      frequency: 'always',
    });
    expect(p.enabled).toBe(false);
    expect(p.title.length).toBe(80);
    expect(p.background_color).toBe('#ffffff');
    expect(p.delay_ms).toBe(8000);
    expect(p.frequency).toBe('once_per_day');
  });

  it('keeps a valid campaign', () => {
    const p = sanitizeStorePromoSheet({
      enabled: true,
      title: 'Festive sale',
      body: '10% off',
      button_color: '#0f0',
      frequency: 'until_dismissed',
      cta_action: 'whatsapp',
      delay_ms: 250,
    });
    expect(p.enabled).toBe(true);
    expect(p.button_color).toBe('#00ff00');
    expect(p.frequency).toBe('until_dismissed');
    expect(p.cta_action).toBe('whatsapp');
    expect(p.delay_ms).toBe(250);
  });
});

describe('isStorePromoActive', () => {
  it('requires content and schedule', () => {
    const base = sanitizeStorePromoSheet({ enabled: true, title: 'Hi' });
    expect(isStorePromoActive(base)).toBe(true);
    expect(isStorePromoActive({ ...base, enabled: false })).toBe(false);
    expect(
      isStorePromoActive({
        ...base,
        start_at: '2099-01-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});

describe('shouldShowStorePromo', () => {
  it('respects frequency', () => {
    expect(shouldShowStorePromo({ frequency: 'every_visit', stored: 'x' })).toBe(true);
    expect(shouldShowStorePromo({ frequency: 'until_dismissed', stored: '1' })).toBe(false);
    expect(
      shouldShowStorePromo({
        frequency: 'once_per_day',
        stored: String(Date.now() - 2 * 24 * 60 * 60 * 1000),
      }),
    ).toBe(true);
    expect(
      shouldShowStorePromo({
        frequency: 'once_per_day',
        stored: String(Date.now()),
      }),
    ).toBe(false);
  });

  it('keys by subdomain and version', () => {
    expect(storePromoStorageKey('shop', 'v2')).toBe('khatario-store-promo:shop:v2');
  });
});

describe('nextPromoSheetVersion', () => {
  it('keeps version when only version would change', () => {
    const a = sanitizeStorePromoSheet({ enabled: true, title: 'Sale', version: '10' });
    const b = sanitizeStorePromoSheet({ enabled: true, title: 'Sale', version: '99' });
    expect(nextPromoSheetVersion(a, b)).toBe(a.version);
  });

  it('bumps version when copy changes', () => {
    const a = sanitizeStorePromoSheet({ enabled: true, title: 'Sale', version: '10' });
    const b = sanitizeStorePromoSheet({ enabled: true, title: 'New sale', version: '10' });
    expect(nextPromoSheetVersion(a, b)).not.toBe(a.version);
  });
});
