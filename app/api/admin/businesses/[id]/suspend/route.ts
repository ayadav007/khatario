import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { setBusinessSuspended } from '@/lib/admin-business-ops';
import { queryOne } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  try {
    const business = await queryOne(`SELECT id FROM businesses WHERE id = $1`, [params.id]);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json();
    const suspended = Boolean(body.suspended);
    await setBusinessSuspended(params.id, suspended, body.reason ?? null, auth.admin.id);

    return NextResponse.json({ success: true, suspended });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
