import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  sendEmployeePortalInvite,
  resetEmployeePortalPasswordOnly,
  type PortalInviteChannel,
} from '@/lib/employee-portal/invite';
import bcrypt from 'bcryptjs';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/employees/[id]/portal-invite
 * Generate a temporary portal password and send invite via email and/or WhatsApp.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    const businessId = getBusinessIdFromRequest(request);
    if (!userId || !businessId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'employees', 'update', {
        businessId,
        resourceId: params.id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const body = await request.json().catch(() => ({}));
    const sendInvite = body.send_invite !== false;
    const channelsRaw = String(body.channels ?? body.portal_invite_via ?? 'both');
    const channels: PortalInviteChannel =
      channelsRaw === 'email' || channelsRaw === 'whatsapp' ? channelsRaw : 'both';

    const result = sendInvite
      ? await sendEmployeePortalInvite({
          businessId,
          employeeId: params.id,
          channels,
        })
      : await resetEmployeePortalPasswordOnly({
          businessId,
          employeeId: params.id,
        });

    const hashRow = await queryOne<{ password_hash: string | null }>(
      `SELECT u.password_hash
       FROM users u
       INNER JOIN employees e ON e.id = u.id
       WHERE e.id = $1 AND e.business_id = $2`,
      [params.id, businessId]
    );
    const passwordSaved =
      Boolean(result.temporary_password?.trim()) &&
      Boolean(hashRow?.password_hash) &&
      (await bcrypt.compare(result.temporary_password, hashRow!.password_hash!));

    if (!passwordSaved) {
      return NextResponse.json(
        {
          error:
            'Temporary password could not be saved. Try again or contact support.',
        },
        { status: 500 }
      );
    }

    const delivered = result.email_sent || result.whatsapp_sent;
    return NextResponse.json({
      ok: true,
      invite: result,
      delivered,
      send_invite: sendInvite,
      message: sendInvite
        ? delivered
          ? 'Portal invite sent'
          : 'Password set but invite could not be delivered — share credentials manually.'
        : 'Temporary password set — share credentials with the employee manually.',
    });
  } catch (error: unknown) {
    console.error('[employees/portal-invite]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send portal invite' },
      { status: 500 }
    );
  }
}
