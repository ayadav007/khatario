import {
  INTEGRATION_CATALOG,
  getCategoryLabel,
  getPluginEntry,
  normalizeCategoryParam,
} from '@/lib/integrations/catalog';
import { generateWebhookToken } from '@/lib/integrations/webhook-token';

test('shipping category exists and is a valid URL param', () => {
  expect(getCategoryLabel('shipping')).toBe('Shipping');
  expect(normalizeCategoryParam('shipping')).toBe('shipping');
});

test('Shiprocket is a live plugin with the three fields', () => {
  const e = getPluginEntry('shiprocket')!;
  expect(e.category).toBe('shipping');
  expect(e.comingSoon).toBeFalsy();
  expect(e.plugin.provider).toBe('shiprocket');
  expect(e.plugin.fields.map((f) => [f.key, f.kind, f.required])).toEqual([
    ['email', 'email', true],
    ['password', 'password', true],
    ['webhook_token', 'webhook_token', false],
  ]);
  expect(e.plugin.fields[0].label).toBe('API user email');
});

test('planned couriers are coming-soon cards without a plugin block', () => {
  for (const id of ['delhivery', 'nimbuspost', 'ithink-logistics', 'porter', 'borzo']) {
    const e = INTEGRATION_CATALOG.find((x) => x.id === id)!;
    expect(e.category).toBe('shipping');
    expect(e.comingSoon).toBe(true);
    expect(e.plugin).toBeUndefined();
    expect(getPluginEntry(id)).toBeNull();
  }
});

test('every plugin has unique field keys and at most one webhook_token', () => {
  for (const e of INTEGRATION_CATALOG.filter((x) => x.plugin)) {
    const keys = e.plugin!.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(e.plugin!.fields.filter((f) => f.kind === 'webhook_token').length).toBeLessThanOrEqual(1);
  }
});

test('entries without a plugin block are unchanged', () => {
  expect(INTEGRATION_CATALOG.find((x) => x.id === 'email-smtp')!.configureHref).toBe('/settings/email');
});

test('generateWebhookToken gives 32 letters and digits, different each time', () => {
  const t = generateWebhookToken();
  expect(t).toMatch(/^[A-Za-z0-9]{32}$/);
  expect(generateWebhookToken()).not.toBe(t);
});
