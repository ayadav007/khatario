import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  try {
    const users = await db.queryRows(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.phone,
         u.is_active,
         u.is_primary_admin,
         u.last_active_at,
         u.created_at,
         ur.role_name,
         ur.role_key
       FROM users u
       LEFT JOIN user_roles ur ON u.role_id = ur.id
       WHERE u.business_id = $1
       ORDER BY u.is_primary_admin DESC, u.created_at ASC`,
      [params.id],
    );

    return NextResponse.json({ users });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
