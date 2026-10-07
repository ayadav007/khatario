import { buildMoreMenuSections } from '@/lib/more-navigation';
import { SALES_NAV_ITEMS } from '@/lib/navigation/sales-nav-items';

describe('buildMoreMenuSections — Connect agent sales parity', () => {
  const agentCaps = new Set(['customers', 'items', 'invoices', 'whatsapp_inbox']);

  function ctx(overrides?: {
    enabledModules?: Array<'billing' | 'hr' | 'connect' | 'crm'>;
    useCheckCapability?: boolean;
  }) {
    const hasCapability = (resource: string) => agentCaps.has(resource);
    return {
      isSupplier: false,
      warehousesEnabled: false,
      hasCapability,
      checkCapability: overrides?.useCheckCapability
        ? (resource: string) => ({
            allowed: agentCaps.has(resource),
            denialReason: null as string | null,
          })
        : undefined,
      enabledModules: overrides?.enabledModules ?? (['billing', 'connect'] as Array<
        'billing' | 'hr' | 'connect' | 'crm'
      >),
    };
  }

  it('includes Orders & Delivery and other invoice lookups when billing is enabled', () => {
    const sections = buildMoreMenuSections(ctx({ useCheckCapability: true }));
    const sales = sections.find((s) => s.title === 'Sales');
    expect(sales).toBeTruthy();
    const hrefs = sales!.items.map((i) => i.href);
    expect(hrefs).toContain('/orders');
    expect(hrefs).toContain('/invoices');
    expect(hrefs).toContain('/customers');
    expect(hrefs).toContain('/estimates');
    expect(hrefs).toContain('/sales-orders');
    expect(hrefs).toContain('/delivery-challans');
    expect(hrefs).not.toContain('/credit-notes');
    expect(hrefs).not.toContain('/work-orders');
  });

  it('still surfaces Sales lookups for connect-only accounts with invoice view', () => {
    const sections = buildMoreMenuSections(
      ctx({ enabledModules: ['connect'], useCheckCapability: true }),
    );
    const sales = sections.find((s) => s.title === 'Sales');
    expect(sales).toBeTruthy();
    expect(sales!.items.map((i) => i.href)).toContain('/orders');
  });

  it('keeps SALES_NAV_ITEMS as the shared Sales list source', () => {
    expect(SALES_NAV_ITEMS.some((i) => i.href === '/orders')).toBe(true);
  });
});
