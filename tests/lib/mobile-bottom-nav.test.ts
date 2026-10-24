import {
  allowedMiddleIds,
  defaultMiddleIds,
  displayedMiddle,
  validateMobileNavPrefs,
  type MobileNavContext,
} from '@/lib/mobile-bottom-nav';

function ctx(modules: string[], extras: Partial<MobileNavContext> = {}): MobileNavContext {
  return { modules, isConnectAgent: false, canViewInvoices: false, ...extras };
}

describe('mobile bottom nav', () => {
  it('keeps the previous default layouts', () => {
    expect(defaultMiddleIds(ctx(['billing']))).toEqual(['invoices', 'items', 'parties']);
    expect(defaultMiddleIds(ctx([]))).toEqual(['invoices', 'items', 'parties']);
    expect(defaultMiddleIds(ctx(['billing', 'connect', 'hr']))).toEqual(['invoices', 'chats', 'parties']);
    expect(defaultMiddleIds(ctx(['connect']))).toEqual(['chats', 'contacts']);
    expect(defaultMiddleIds(ctx(['hr']))).toEqual(['team', 'attendance']);
    expect(defaultMiddleIds(ctx(['hr', 'connect']))).toEqual(['team', 'attendance']);
    expect(defaultMiddleIds(ctx(['billing', 'connect'], { isConnectAgent: true }))).toEqual(['contacts', 'parties']);
    expect(
      defaultMiddleIds(ctx(['billing', 'connect'], { isConnectAgent: true, canViewInvoices: true })),
    ).toEqual(['contacts', 'orders']);
  });

  it('lets a billing account swap the middle tabs and choose 4', () => {
    const billing = ctx(['billing']);
    expect(allowedMiddleIds(billing)).toEqual(['invoices', 'items', 'parties']);
    const saved = validateMobileNavPrefs(billing, { slotCount: 4, middle: ['items', 'parties'] });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(displayedMiddle(billing, saved.prefs)).toEqual(['items', 'parties']);
    }
  });

  it('drops a shortcut the account can no longer open and fills from the default', () => {
    const billing = ctx(['billing']);
    expect(displayedMiddle(billing, { slotCount: 5, middle: ['chats', 'items', 'parties'] })).toEqual([
      'items',
      'parties',
      'invoices',
    ]);
  });

  it('refuses 5 tabs when only two shortcuts exist', () => {
    const hr = ctx(['hr']);
    const saved = validateMobileNavPrefs(hr, { slotCount: 5, middle: ['team', 'attendance', 'invoices'] });
    expect(saved.ok).toBe(false);
  });

  it('offers HR and Connect shortcuts together when both modules are on', () => {
    expect(allowedMiddleIds(ctx(['hr', 'connect']))).toEqual(['team', 'attendance', 'chats', 'contacts']);
    const saved = validateMobileNavPrefs(ctx(['hr', 'connect']), {
      slotCount: 5,
      middle: ['team', 'chats', 'contacts'],
    });
    expect(saved.ok).toBe(true);
  });
});
