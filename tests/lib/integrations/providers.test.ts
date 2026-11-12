import { INTEGRATION_CATALOG } from '@/lib/integrations/catalog';
import { getProvider } from '@/lib/integrations/providers';
import { clearShiprocketCache, verifyShiprocketLogin } from '@/lib/store/delivery/shiprocket';

const fetchMock = jest.fn();
const realFetch = global.fetch;

function reply(status: number, json: unknown) {
  return { ok: status < 400, status, json: async () => json } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  clearShiprocketCache();
});
afterAll(() => {
  global.fetch = realFetch;
});

const creds = { email: 'a@b.c', password: 'p' };

describe('verifyShiprocketLogin', () => {
  test('token in the response: ok, and nothing is cached', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { token: 't' }));
    expect(await verifyShiprocketLogin(creds)).toEqual({ ok: true });
    fetchMock.mockResolvedValueOnce(reply(401, {}));
    expect(await verifyShiprocketLogin(creds)).toEqual({ ok: false, reason: 'rejected' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('4xx without a token: rejected', async () => {
    fetchMock.mockResolvedValueOnce(reply(403, {}));
    expect(await verifyShiprocketLogin(creds)).toEqual({ ok: false, reason: 'rejected' });
  });

  test('200 without a token: rejected', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    expect(await verifyShiprocketLogin(creds)).toEqual({ ok: false, reason: 'rejected' });
  });

  test('5xx: unreachable', async () => {
    fetchMock.mockResolvedValueOnce(reply(503, {}));
    expect(await verifyShiprocketLogin(creds)).toEqual({ ok: false, reason: 'unreachable' });
  });

  test('fetch throws or times out: unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await verifyShiprocketLogin(creds)).toEqual({ ok: false, reason: 'unreachable' });
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    expect(await verifyShiprocketLogin(creds, { timeoutMs: 10 })).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('provider registry', () => {
  test('every catalogue plugin has a provider', () => {
    for (const e of INTEGRATION_CATALOG.filter((x) => x.plugin)) {
      expect(getProvider(e.plugin!.provider)).not.toBeNull();
    }
  });

  test('unknown provider is null', () => {
    expect(getProvider('nope')).toBeNull();
    expect(getProvider('toString')).toBeNull();
  });

  test('shiprocket verify maps reasons to the exact messages', async () => {
    const p = getProvider('shiprocket')!;
    const input = { config: { email: 'a@b.c' }, secrets: { password: 'p' } };
    fetchMock.mockResolvedValueOnce(reply(200, { token: 't' }));
    expect(await p.verify(input)).toEqual({ ok: true });
    fetchMock.mockResolvedValueOnce(reply(401, {}));
    expect(await p.verify(input)).toEqual({
      ok: false,
      reason: 'rejected',
      message:
        'Shiprocket did not accept this email and password. Use the API user from Shiprocket → Settings → API, not your main login.',
    });
    fetchMock.mockResolvedValueOnce(reply(503, {}));
    expect(await p.verify(input)).toEqual({
      ok: false,
      reason: 'unreachable',
      message: 'Could not reach Shiprocket. Nothing was saved; try again.',
    });
  });
});
