/**
 * The Shiprocket login token cache must not let one business reuse another business's session.
 * Two merchants may configure the same account email; only the one whose password is right
 * may obtain, or reuse, a token for it.
 */
import { clearShiprocketCache, createShiprocketClient, ShiprocketError } from '@/lib/store/delivery/shiprocket';

type Call = { path: string; body: Record<string, unknown> | null; auth: string | null };

function mockFetch() {
  const calls: Call[] = [];
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('https://apiv2.shiprocket.in/v1/external', '').split('?')[0];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ path, body, auth: headers.Authorization ?? null });
    if (path === '/auth/login') {
      if (body?.password === 'correct-horse') return { ok: true, status: 200, json: async () => ({ token: 'tok-A' }) } as Response;
      return { ok: false, status: 400, json: async () => ({ message: 'Invalid credentials' }) } as Response;
    }
    if (path === '/settings/company/pickup') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { shipping_address: [{ pickup_location: 'Shop A', is_primary_location: 1 }] } }),
      } as Response;
    }
    throw new Error(`unexpected call ${path}`);
  });
  global.fetch = fn as unknown as typeof fetch;
  return calls;
}

beforeEach(() => clearShiprocketCache());

it("a wrong password for the same email does not reuse the other business's token", async () => {
  const calls = mockFetch();
  const merchantA = createShiprocketClient({ email: 'ops@shared.in', password: 'correct-horse' });
  await merchantA.pickupLocation();
  expect(calls.filter((c) => c.path === '/auth/login')).toHaveLength(1);

  const merchantB = createShiprocketClient({ email: 'ops@shared.in', password: 'wrong' });
  await expect(merchantB.pickupLocation()).rejects.toBeInstanceOf(ShiprocketError);
  // B had to log in on its own (and failed); it never sent a request with A's token.
  expect(calls.filter((c) => c.path === '/auth/login')).toHaveLength(2);
  expect(calls.filter((c) => c.auth === 'Bearer tok-A')).toHaveLength(1);
});

it('the same credentials keep sharing one cached token', async () => {
  const calls = mockFetch();
  const first = createShiprocketClient({ email: 'ops@shared.in', password: 'correct-horse' });
  const second = createShiprocketClient({ email: 'ops@shared.in', password: 'correct-horse' });
  await first.pickupLocation();
  await second.pickupLocation();
  expect(calls.filter((c) => c.path === '/auth/login')).toHaveLength(1);
});

it('a wrong password does not read the cached pickup address either', async () => {
  const calls = mockFetch();
  await createShiprocketClient({ email: 'ops@shared.in', password: 'correct-horse' }).pickupLocation();
  const before = calls.length;
  await expect(createShiprocketClient({ email: 'ops@shared.in', password: 'wrong' }).pickupLocation()).rejects.toBeInstanceOf(ShiprocketError);
  expect(calls.slice(before).some((c) => c.path === '/settings/company/pickup')).toBe(false);
});
