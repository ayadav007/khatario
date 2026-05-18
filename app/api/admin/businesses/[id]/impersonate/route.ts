import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { createImpersonationToken } from '@/lib/admin-business-ops';
import { queryOne } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'super_admin', 'can_impersonate_business');
  if (!auth.ok) return auth.response;

  try {
    const business = await queryOne(`SELECT id FROM businesses WHERE id = $1`, [params.id]);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { token, expiresAt, userId } = await createImpersonationToken({
      adminId: auth.admin.id,
      businessId: params.id,
      userId: body.user_id,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const url = `${baseUrl}/auth/impersonate?token=${encodeURIComponent(token)}`;

    return NextResponse.json({
      url,
      expires_at: expiresAt.toISOString(),
      user_id: userId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
