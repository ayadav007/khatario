import { NextRequest, NextResponse } from 'next/server';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { registerPushDevice, revokePushDevice } from '@/lib/push/device-registry';

export const dynamic = 'force-dynamic';

type Body = {
  token?: unknown;
  app_id?: unknown;
  platform?: unknown;
  environment?: unknown;
  device_label?: unknown;
  app_version?: unknown;
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

async function customerOf(request: NextRequest, subdomain: string) {
  const store = await resolveStoreBySubdomain(subdomain);
  if (!store) return { error: NextResponse.json({ error: 'Store not found' }, { status: 404 }) };
  const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
  if (!session || session.businessId !== store.business_id) {
    return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  }
  return { customerId: session.customerId, businessId: store.business_id };
}

/**
 * POST /api/public/store/[subdomain]/push/devices  { token, app_id, ... }
 * Registers the signed-in store customer's device for this shop only. The audience is
 * `customer`; the customer and shop come from the store cookie, never from the body.
 */
export async function POST(request: NextRequest, { params }: { params: { subdomain: string } }) {
  const who = await customerOf(request, params.subdomain);
  if ('error' in who) return who.error;

  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const result = await registerPushDevice({
    audience: 'customer',
    customerId: who.customerId,
    businessId: who.businessId,
    appId: str(body.app_id, 80) ?? '',
    platform: str(body.platform, 16),
    token: typeof body.token === 'string' ? body.token.trim() : '',
    environment: str(body.environment, 16),
    deviceLabel: str(body.device_label, 120) ?? null,
    appVersion: str(body.app_version, 40) ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, device_id: result.deviceId });
}

/** DELETE /api/public/store/[subdomain]/push/devices  { token }: revoke on sign-out. */
export async function DELETE(request: NextRequest, { params }: { params: { subdomain: string } }) {
  const who = await customerOf(request, params.subdomain);
  if ('error' in who) return who.error;

  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  const revoked = await revokePushDevice(token, { audience: 'customer', customerId: who.customerId, businessId: who.businessId });
  return NextResponse.json({ ok: true, revoked });
}
