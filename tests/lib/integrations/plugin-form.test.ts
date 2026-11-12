import { INTEGRATION_CATALOG, getPluginEntry } from '@/lib/integrations/catalog';
import type { ConnectionView } from '@/lib/integrations/service';
import { initialFormValues, buildSaveValues, cardAction } from '@/lib/integrations/plugin-form';

const SHIPROCKET = getPluginEntry('shiprocket')!;
const FIELDS = SHIPROCKET.plugin.fields;
const byId = (id: string) => INTEGRATION_CATALOG.find((e) => e.id === id)!;
const EMAIL = byId('email-smtp');
const DELHIVERY = byId('delhivery');
const VIEW: ConnectionView = {
  provider: 'shiprocket',
  connected: true,
  config: {},
  secretsSet: ['password'],
  webhookConfigured: true,
  lastVerifiedAt: null,
};

test('initial values: config filled, secrets blank', () => {
  expect(initialFormValues(FIELDS, { ...VIEW, config: { email: 'a@b.c' } })).toEqual({ email: 'a@b.c', password: '', webhook_token: '' });
  expect(initialFormValues(FIELDS, null)).toEqual({ email: '', password: '', webhook_token: '' });
});

test('save values: blank password and token are left out', () => {
  expect(buildSaveValues(FIELDS, { email: ' a@b.c ', password: '', webhook_token: '' })).toEqual({ email: 'a@b.c' });
  expect(buildSaveValues(FIELDS, { email: 'a@b.c', password: ' p ', webhook_token: 'T'.repeat(32) }))
    .toEqual({ email: 'a@b.c', password: ' p ', webhook_token: 'T'.repeat(32) });
});

test('plugin card: Connect when not connected, Manage when connected, both open the plugin page', () => {
  expect(cardAction(SHIPROCKET, { active: false, entitled: true, loading: false })).toEqual({ label: 'Connect', href: '/settings/integrations/shiprocket', disabled: false });
  expect(cardAction(SHIPROCKET, { active: true, entitled: true, loading: false })).toMatchObject({ label: 'Manage', href: '/settings/integrations/shiprocket' });
});

test('non-plugin cards behave as before', () => {
  expect(cardAction(EMAIL, { active: true, entitled: true, loading: false })).toMatchObject({ label: 'Access', href: '/settings/email' });
  expect(cardAction(DELHIVERY, { active: false, entitled: false, loading: false })).toMatchObject({ label: 'Coming soon', disabled: true });
});
