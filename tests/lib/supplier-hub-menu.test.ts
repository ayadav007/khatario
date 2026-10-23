import { buildMoreMenuSections } from '@/lib/more-navigation';

describe('Supplier Hub menu visibility', () => {
  const ctx = {
    isSupplier: true,
    warehousesEnabled: false,
    hasCapability: () => true,
    enabledModules: ['billing'] as Array<'billing'>,
  };

  it('keeps the supplier list when Supplier Hub is hidden', () => {
    const sections = buildMoreMenuSections({ ...ctx, supplierHubVisible: false });
    const purchases = sections.find((section) => section.title === 'Purchases');
    const hrefs = purchases?.items.map((item) => item.href) ?? [];
    expect(hrefs).toContain('/suppliers');
    expect(hrefs).not.toContain('/suppliers/hub');
    expect(hrefs).not.toContain('/purchases/incoming');
    expect(hrefs).not.toContain('/purchases/requests');
    expect(sections.find((section) => section.title === 'Supplier')).toBeUndefined();
  });

  it('shows Supplier Hub when the switch is on', () => {
    const sections = buildMoreMenuSections({ ...ctx, supplierHubVisible: true });
    const purchases = sections.find((section) => section.title === 'Purchases');
    expect(purchases?.items.map((item) => item.href)).toContain('/suppliers/hub');
    expect(sections.find((section) => section.title === 'Supplier')).toBeTruthy();
  });
});
