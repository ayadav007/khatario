import { buildMoreMenuSections } from '@/lib/more-navigation';

describe('buildMoreMenuSections — Payment Reminders follows the billing plan, not Connect', () => {
  function reminders(caps: string[]) {
    const granted = new Set(['whatsapp', ...caps]);
    const sections = buildMoreMenuSections({
      isSupplier: false,
      warehousesEnabled: false,
      hasCapability: (resource: string) => granted.has(resource),
      enabledModules: ['billing', 'connect'],
    });
    const connect = sections.find((s) => s.title === 'Connect');
    return connect?.items.find((i) => i.href === '/whatsapp/reminders');
  }

  it('is unlocked on Starter and up without Connect', () => {
    const item = reminders(['whatsapp_auto_reminders']);
    expect(item?.isLocked).toBe(false);
    expect(item?.featureKey).toBe('whatsapp_auto_reminders');
  });

  it('ignores the Connect bot capability on its own', () => {
    expect(reminders(['whatsapp_bot'])?.isLocked).toBe(true);
  });
});
