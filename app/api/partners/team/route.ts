import { NextRequest, NextResponse } from 'next/server';
import { requirePartnerRequest } from '@/lib/partners/request-auth';
import { addPartnerMember, listPartnerUsers, setPartnerUserActive } from '@/lib/partners/team';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;
  const users = await listPartnerUsers(auth.session.partner_id);
  return NextResponse.json({
    users,
    canManage: auth.session.role === 'owner',
    partnerType: auth.session.partner.partner_type,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.session.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can add team members' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const user = await addPartnerMember({
      partnerId: auth.session.partner_id,
      name: String(body.name || ''),
      email: String(body.email || ''),
      phone: body.phone ?? null,
      password: String(body.password || ''),
      role: 'member',
    });
    return NextResponse.json({ success: true, user }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.session.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can manage team members' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const userId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!userId || typeof body.is_active !== 'boolean') {
      return NextResponse.json({ error: 'user_id and is_active required' }, { status: 400 });
    }
    const ok = await setPartnerUserActive(auth.session.partner_id, userId, body.is_active);
    if (!ok) {
      return NextResponse.json(
        { error: 'User not found or cannot deactivate owner' },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
