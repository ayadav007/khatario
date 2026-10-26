import { buildMoreMenuSections } from '@/lib/more-navigation';
import { CONNECT_NAV_GROUPS } from '@/lib/navigation/connect-nav-items';

describe('buildMoreMenuSections — Payment Reminders follows the billing plan, not Connect', () => {
  function sections(caps: string[], enabledModules: Array<'billing' | 'connect'> = ['billing']) {
    const granted = new Set(['whatsapp', 'invoices', 'whatsapp_inbox', ...caps]);
    return buildMoreMenuSections({
      isSupplier: false,
      warehousesEnabled: false,
      hasCapability: (resource: string) => granted.has(resource),
      enabledModules,
    });
  }

  function reminders(caps: string[], enabledModules?: Array<'billing' | 'connect'>) {
    const sales = sections(caps, enabledModules).find((s) => s.title === 'Sales');
    return sales?.items.find((i) => i.href === '/payments/reminders');
  }

  it('is in Sales and unlocked on Starter and up for a Billing-only business', () => {
    const item = reminders(['whatsapp_auto_reminders']);
    expect(item?.isLocked).toBe(false);
    expect(item?.featureKey).toBe('whatsapp_auto_reminders');
  });

  it('ignores the Connect bot capability on its own', () => {
    expect(reminders(['whatsapp_bot'])?.isLocked).toBe(true);
  });

  it('is no longer in the Connect menu', () => {
    const connect = sections(['whatsapp_bot'], ['billing', 'connect']).find((s) => s.title === 'Connect');
    const hrefs = connect?.items.map((i) => i.href) ?? [];
    expect(hrefs).not.toContain('/whatsapp/reminders');
    expect(hrefs).not.toContain('/payments/reminders');
  });

  it('lists Connect items in the Sidebar group order', () => {
    const connect = sections(['whatsapp_bot'], ['billing', 'connect']).find((s) => s.title === 'Connect');
    const expected = [
      '/whatsapp/dashboard',
      ...CONNECT_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
      '/settings/whatsapp',
    ];
    expect(connect?.items.map((i) => i.href)).toEqual(expected);
  });
});
