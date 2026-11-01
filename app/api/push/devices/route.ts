import { NextRequest, NextResponse } from 'next/server';
import { requireNotificationSession } from '@/lib/notifications/notification-session';
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

/**
 * POST /api/push/devices  { token, app_id, platform?, environment?, device_label?, app_version? }
 * Registers (or refreshes) the signed-in business user's device. The audience is `business` and
 * the owner is the session user; nothing in the body can point the token at another account or
 * audience. Called after login and whenever FCM rotates the token.
 */
export async function POST(request: NextRequest) {
  const session = await requireNotificationSession(request);
  if (!session.ok) return session.response;

  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const result = await registerPushDevice({
    audience: 'business',
    userId: session.userId,
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

/**
 * DELETE /api/push/devices  { token }
 * Revokes the device on logout. Only a token owned by the session user is affected.
 */
export async function DELETE(request: NextRequest) {
  const session = await requireNotificationSession(request);
  if (!session.ok) return session.response;

  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  const revoked = await revokePushDevice(token, { audience: 'business', userId: session.userId });
  return NextResponse.json({ ok: true, revoked });
}
