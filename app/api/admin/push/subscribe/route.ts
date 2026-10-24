import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { deleteAdminPushSubscription, saveAdminPushSubscription } from '@/lib/platform-push';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const endpoint = String(body.endpoint || '').trim();
    const p256dh = String(body.keys?.p256dh || body.p256dh || '').trim();
    const authKey = String(body.keys?.auth || body.auth || '').trim();
    if (!endpoint || !p256dh || !authKey) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }
    await saveAdminPushSubscription({
      adminId: auth.admin.id,
      endpoint,
      p256dh,
      auth: authKey,
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const endpoint = String(body.endpoint || '').trim();
    if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
    await deleteAdminPushSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
