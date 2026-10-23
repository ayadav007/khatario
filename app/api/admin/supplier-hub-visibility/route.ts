import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { isSupplierHubVisible, setSupplierHubVisible } from '@/lib/supplier-hub-visibility';

export const dynamic = 'force-dynamic';

/** GET /api/admin/supplier-hub-visibility — platform show/hide switch. */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;
  const visible = await isSupplierHubVisible();
  return NextResponse.json({ visible });
}

/** PATCH /api/admin/supplier-hub-visibility — { visible: boolean } */
export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.visible !== 'boolean') {
    return NextResponse.json({ error: 'visible must be true or false' }, { status: 400 });
  }

  await setSupplierHubVisible(body.visible);
  return NextResponse.json({ visible: body.visible });
}
