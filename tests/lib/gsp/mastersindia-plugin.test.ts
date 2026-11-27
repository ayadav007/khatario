import { getPluginEntry } from '@/lib/integrations/catalog';
import { getProvider } from '@/lib/integrations/providers';
import * as client from '@/lib/gsp/mastersindia/client';

it('lists the plugin with a username and a password field', () => {
  const e = getPluginEntry('gst-masters-india')!;
  expect(e.plugin!.provider).toBe('mastersindia');
  expect(e.plugin!.fields.map((f) => [f.key, f.kind, f.required])).toEqual([['username', 'text', true], ['password', 'password', true]]);
  expect(e.featureKeys).toEqual(['e_invoice', 'eway_bill']);
});

it('verify maps a refused login to rejected and an outage to unreachable', async () => {
  const p = getProvider('mastersindia')!;
  const login = jest.spyOn(client, 'gspLogin');
  login.mockRejectedValueOnce(new client.GspError('auth', 'no'));
  expect(await p.verify({ config: { username: 'u' }, secrets: { password: 'p' } })).toMatchObject({ ok: false, reason: 'rejected' });
  login.mockRejectedValueOnce(new client.GspError('timeout', 'slow'));
  expect(await p.verify({ config: { username: 'u' }, secrets: { password: 'p' } })).toMatchObject({ ok: false, reason: 'unreachable' });
  login.mockRejectedValueOnce(new client.GspError('not_configured', 'MASTERSINDIA_BASE_URL is not set'));
  expect(await p.verify({ config: { username: 'u' }, secrets: { password: 'p' } })).toEqual({
    ok: false, reason: 'unreachable', message: 'E-way bill and e-invoice connections are not set up on this server yet.',
  });
  login.mockResolvedValueOnce('tok');
  expect(await p.verify({ config: { username: 'u' }, secrets: { password: 'p' } })).toEqual({ ok: true });
  expect(await p.countInFlight('any')).toBe(0);
});
