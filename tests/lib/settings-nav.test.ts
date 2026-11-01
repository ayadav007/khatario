import { buildFlatSettingsGroups } from '@/lib/settings-module-registry';

describe('buildFlatSettingsGroups', () => {
  const hasFeature = () => true;

  function labels(modules: Array<'billing' | 'hr' | 'connect' | 'crm'>) {
    return buildFlatSettingsGroups(modules, { hasFeature }).flatMap((group) =>
      group.links.map((link) => link.label),
    );
  }

  it('lists shared settings once across billing and hr', () => {
    const items = labels(['billing', 'hr']);
    expect(items.filter((label) => label === 'Business profile')).toHaveLength(1);
    expect(items.filter((label) => label === 'Plan & billing')).toHaveLength(1);
    expect(items.filter((label) => label === 'Backup & restore')).toHaveLength(1);
    expect(items).toContain('Appearance');
    expect(items).not.toContain('UI features');
    expect(items).not.toContain('Holidays (legacy)');
    expect(items.filter((label) => label === 'Holidays')).toHaveLength(0);
    expect(items).toContain('Holiday lists');
    expect(items).toContain('Connection');
    expect(items).toContain('AI agent');
  });

  it('lists the same WhatsApp pages for billing and connect, in setup order', () => {
    const whatsapp = ['Connection', 'Reminders', 'Team & inbox', 'AI agent', 'Templates', 'Shop'];
    for (const mods of [['billing'], ['connect']] as const) {
      const items = labels([...mods]);
      expect(items.filter((label) => whatsapp.includes(label))).toEqual(whatsapp);
      expect(items).not.toContain('Agents');
      expect(items).not.toContain('Inbox & team');
    }
    expect(labels(['connect'])).not.toContain('Templates & printing');
  });
});
