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
    expect(items).not.toContain('Inbox & team');
  });

  it('shows connect inbox links only when connect is enabled', () => {
    const connectItems = labels(['connect']);
    expect(connectItems).toContain('Inbox & team');
    expect(connectItems).toContain('Agents');
    expect(connectItems).not.toContain('Templates & printing');

    const billingItems = labels(['billing']);
    expect(billingItems).toContain('Templates');
    expect(billingItems).not.toContain('Inbox & team');
  });
});
