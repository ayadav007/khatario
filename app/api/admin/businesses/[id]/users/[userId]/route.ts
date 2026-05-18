import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { adminResetUserPassword, adminSetUserActive } from '@/lib/admin-business-ops';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } },
) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    if (body.action === 'reset_password') {
      const { temporaryPassword } = await adminResetUserPassword({
        businessId: params.id,
        userId: params.userId,
        adminId: auth.admin.id,
        newPassword: body.new_password,
      });
      return NextResponse.json({
        success: true,
        temporary_password: temporaryPassword,
        message: 'Password reset. Share this temporary password securely with the user.',
      });
    }

    if (body.action === 'set_active') {
      await adminSetUserActive({
        businessId: params.id,
        userId: params.userId,
        isActive: Boolean(body.is_active),
        adminId: auth.admin.id,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
